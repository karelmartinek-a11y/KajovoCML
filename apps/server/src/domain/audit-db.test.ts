import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { appendAudit, verifyAuditChain } from "./audit.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";

describe.skipIf(!enabled)("audit PostgreSQL serialization", () => {
  let db: Db;

  beforeAll(() => {
    db = createDb(loadConfig(process.env));
  });

  beforeEach(async () => {
    await db.query("truncate table audit_event restart identity cascade");
    await db.query("update audit_head set last_sequence=0,event_hash=null,updated_at=now() where singleton=true");
  });

  afterAll(async () => db.end());

  it("serializes 100 concurrent appends into one verifiable chain", async () => {
    await Promise.all(Array.from({ length: 100 }, (_, index) => appendAudit(db, {
      eventType: "audit.concurrent.test",
      actorType: "system",
      objectType: "concurrency_slot",
      objectId: String(index),
      after: { index },
      correlationId: randomUUID()
    })));

    await expect(verifyAuditChain(db)).resolves.toEqual({
      valid: true,
      eventCount: 100,
      latestEventId: 100,
      brokenEventId: null
    });
    const shape = await db.query(
      `select count(*)::int as count,
              count(distinct chain_sequence)::int as sequences,
              min(chain_sequence)::int as first_sequence,
              max(chain_sequence)::int as last_sequence,
              count(*) filter (where prev_hash is null)::int as roots
         from audit_event`
    );
    expect(shape.rows[0]).toMatchObject({ count: 100, sequences: 100, first_sequence: 1, last_sequence: 100, roots: 1 });
  });

  it("rejects ordinary mutation and detects a migrator-level historical change", async () => {
    await appendAudit(db, {
      eventType: "audit.tamper.test",
      actorType: "system",
      correlationId: randomUUID()
    });
    await expect(db.query("update audit_event set event_type='tampered' where id=1")).rejects.toThrow("append-only");

    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query("alter table audit_event disable trigger audit_event_append_only_update");
      await client.query("update audit_event set event_type='tampered' where id=1");
      await client.query("alter table audit_event enable trigger audit_event_append_only_update");
      const verification = await client.query("select * from verify_audit_chain()");
      expect(verification.rows[0]).toMatchObject({ valid: false, event_count: "1", broken_event_id: "1" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
