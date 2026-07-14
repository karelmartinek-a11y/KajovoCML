import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { Db } from "../db.js";
import { appendAudit, verifyAuditChain } from "./audit.js";

describe("audit hash chain", () => {
  it("stores a chained hash for appended events", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("select event_hash from audit_event order by id desc limit 1")) {
        return { rowCount: rows.length ? 1 : 0, rows: rows.length ? [{ event_hash: rows[rows.length - 1]?.event_hash }] : [] };
      }
      if (sql.includes("insert into audit_event")) {
        rows.push({
          id: rows.length + 1,
          event_type: params?.[0],
          actor_type: params?.[1],
          actor_id: params?.[2],
          object_type: params?.[3],
          object_id: params?.[4],
          before_json: JSON.parse(String(params?.[5])),
          after_json: JSON.parse(String(params?.[6])),
          correlation_id: params?.[7],
          prev_hash: params?.[8] ?? null,
          event_hash: params?.[9]
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("select id, event_type")) {
        return { rowCount: rows.length, rows };
      }
      return { rowCount: 0, rows: [] };
    });
    const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Db;

    await appendAudit(db, { eventType: "first", actorType: "admin", correlationId: "00000000-0000-0000-0000-000000000001" });
    await appendAudit(db, { eventType: "second", actorType: "admin", correlationId: "00000000-0000-0000-0000-000000000002" });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.prev_hash).toBeNull();
    expect(Buffer.isBuffer(rows[0]?.event_hash)).toBe(true);
    expect(rows[1]?.prev_hash).toEqual(rows[0]?.event_hash);

    await expect(verifyAuditChain(db)).resolves.toMatchObject({ valid: true, eventCount: 2, brokenEventId: null });
  });

  it("appends through an existing pool client without opening a nested transaction", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select event_hash from audit_event order by id desc limit 1")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into audit_event")) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const client = { query, release: vi.fn(), connect: vi.fn() } as unknown as pg.PoolClient;

    await appendAudit(client, {
      eventType: "client.append",
      actorType: "admin",
      correlationId: "00000000-0000-0000-0000-000000000003"
    });

    expect(query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into audit_event"))).toBe(true);
  });
});
