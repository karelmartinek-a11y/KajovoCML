import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { addTxtRow, cleanupDnsOperation, cleanupDnsOperationByOwnership, commitDnsOperation, createWedosDnsOperation, markPropagated } from "./wedos-dns-operation.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";

type FakeRow = { ID: string; name: string; ttl: number; rdtype: string; rdata: string; changed_date: string; author_comment: string };

class FakeWedosApi {
  readonly rows: FakeRow[] = [{
    ID: "FOREIGN-1", name: "_acme-challenge", ttl: 300, rdtype: "TXT", rdata: "unrelated-value",
    changed_date: "2026-08-22 10:00:00", author_comment: "owner-managed-record"
  }];
  addCalls = 0;
  deleteCalls: string[] = [];
  commitCalls = 0;

  async rowsList() { return { code: 1000, result: "OK", clTRID: "test", svTRID: "server", command: "dns-rows-list", outcome: "OK" as const, data: { row: this.rows } }; }
  async rowAdd(_zone: string, name: string, rdata: string, authorComment: string, ttl: number) {
    this.addCalls += 1;
    this.rows.push({ ID: `OWNED-${this.addCalls}`, name, ttl, rdtype: "TXT", rdata, changed_date: "2026-08-22 10:00:00", author_comment: authorComment });
    return { code: 1000, result: "OK", clTRID: "test", svTRID: "server", command: "dns-row-add", outcome: "OK" as const, data: null };
  }
  async rowDelete(_zone: string, id: string) {
    this.deleteCalls.push(id);
    const index = this.rows.findIndex((row) => row.ID === id);
    if (index >= 0) this.rows.splice(index, 1);
    return { code: 1000, result: "OK", clTRID: "test", svTRID: "server", command: "dns-row-delete", outcome: "OK" as const, data: null };
  }
  async domainCommit() {
    this.commitCalls += 1;
    return { code: 1000, result: "OK", clTRID: "test", svTRID: "server", command: "dns-domain-commit", outcome: "OK" as const, data: null };
  }
}

describe.skipIf(!enabled)("WEDOS DNS operation ledger PostgreSQL contract", () => {
  let db: Db;
  let config: AppConfig;
  const operationIds: string[] = [];

  beforeAll(() => {
    config = loadConfig(process.env);
    db = createDb(config);
  });

  afterAll(async () => {
    if (!db) return;
    if (operationIds.length) await db.query("delete from wedos_dns_operation where id=any($1::uuid[])", [operationIds]);
    await db.end();
  });

  it("runs add, exact ownership, commit, propagation, cleanup and terminal idempotency", async () => {
    const api = new FakeWedosApi();
    const visible: boolean[] = [];
    const value = `kcml-test-${randomUUID()}`;
    const created = await createWedosDnsOperation(db, { purpose: "PREFLIGHT_TEST", zone: "hcasc.cz", recordName: "_kcml-wapi-test", value });
    operationIds.push(created.id);
    await addTxtRow(db, created.id, value, api);
    await commitDnsOperation(db, created.id, value, api);
    const propagated = await markPropagated(db, created.id, value, api, async (_zone, _record, _value, expectedPresent) => { visible.push(expectedPresent); });
    expect(propagated).toMatchObject({ id: created.id, state: "PROPAGATED", valueDigest: expect.stringMatching(/^sha256:/) });
    expect(api.rows).toHaveLength(2);
    const cleaned = await cleanupDnsOperation(db, created.id, value, api, async (_zone, _record, _value, expectedPresent) => { visible.push(expectedPresent); });
    expect(cleaned.state).toBe("CLEANUP_PROPAGATED");
    expect(api.rows).toEqual([expect.objectContaining({ ID: "FOREIGN-1" })]);
    expect(api.deleteCalls).toEqual(["OWNED-1"]);
    expect(visible).toEqual([true, false]);
    const terminal = await cleanupDnsOperation(db, created.id, value, api);
    expect(terminal.state).toBe("CLEANUP_PROPAGATED");
    expect(api.deleteCalls).toHaveLength(1);
  });

  it("serializes duplicate add recovery through the operation advisory lock", async () => {
    const api = new FakeWedosApi();
    const value = `kcml-concurrent-${randomUUID()}`;
    const created = await createWedosDnsOperation(db, { purpose: "PREFLIGHT_TEST", zone: "hcasc.cz", recordName: "_kcml-wapi-test", value });
    operationIds.push(created.id);
    await Promise.all([addTxtRow(db, created.id, value, api), addTxtRow(db, created.id, value, api)]);
    expect(api.addCalls).toBe(1);
    const row = await db.query("select state,wedos_row_id,attempt_count from wedos_dns_operation where id=$1", [created.id]);
    expect(row.rows[0]).toMatchObject({ state: "ROW_ADDED", wedos_row_id: "OWNED-1" });
    expect(Number(row.rows[0].attempt_count)).toBe(1);
  });

  it("rejects a cleanup value that does not match the stored digest", async () => {
    const api = new FakeWedosApi();
    const created = await createWedosDnsOperation(db, { purpose: "PREFLIGHT_TEST", zone: "hcasc.cz", recordName: "_kcml-wapi-test", value: "expected-value" });
    operationIds.push(created.id);
    await expect(addTxtRow(db, created.id, "wrong-value", api)).rejects.toThrow("wedos_dns_value_digest_mismatch");
    const row = await db.query("select state,last_safe_error_code from wedos_dns_operation where id=$1", [created.id]);
    expect(row.rows[0]).toMatchObject({ state: "CREATED", last_safe_error_code: "wedos_dns_value_digest_mismatch" });
  });

  it("recovers an interrupted row-added operation from exact WEDOS ownership", async () => {
    const api = new FakeWedosApi();
    const value = `kcml-recovery-${randomUUID()}`;
    const created = await createWedosDnsOperation(db, { purpose: "PREFLIGHT_TEST", zone: "hcasc.cz", recordName: "_kcml-wapi-recovery", value });
    operationIds.push(created.id);
    await addTxtRow(db, created.id, value, api);
    const recovered = await cleanupDnsOperationByOwnership(db, created.id, api, async () => undefined);
    expect(recovered).toMatchObject({ id: created.id, state: "CLEANUP_PROPAGATED" });
    expect(api.deleteCalls).toEqual(["OWNED-1"]);
    expect(api.rows).toEqual([expect.objectContaining({ ID: "FOREIGN-1" })]);
  });
});
