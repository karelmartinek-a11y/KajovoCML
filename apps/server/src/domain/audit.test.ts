import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { Db } from "../db.js";
import { appendAudit, verifyAuditChain } from "./audit.js";

describe("database-owned audit hash chain", () => {
  it("appends only through the serialized database function", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("append_audit_event")) return { rowCount: 1, rows: [{ append_audit_event: 1 }] };
      if (sql === "select * from verify_audit_chain()") {
        return { rowCount: 1, rows: [{ valid: true, event_count: 2, latest_event_id: 2, broken_event_id: null }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Db;

    await appendAudit(db, { eventType: "first", actorType: "admin", correlationId: "00000000-0000-0000-0000-000000000001" });
    await appendAudit(db, { eventType: "second", actorType: "admin", correlationId: "00000000-0000-0000-0000-000000000002" });

    const appends = query.mock.calls.filter(([sql]) => String(sql).includes("append_audit_event"));
    expect(appends).toHaveLength(2);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into audit_event"))).toBe(false);
    await expect(verifyAuditChain(db)).resolves.toEqual({ valid: true, eventCount: 2, latestEventId: 2, brokenEventId: null });
  });

  it("appends through an existing pool client without opening a nested transaction", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("append_audit_event")
      ? { rowCount: 1, rows: [{ append_audit_event: 1 }] }
      : { rowCount: 0, rows: [] });
    const client = { query, release: vi.fn() } as unknown as pg.PoolClient;

    await appendAudit(client, {
      eventType: "client.append",
      actorType: "admin",
      correlationId: "00000000-0000-0000-0000-000000000003"
    });

    expect(query.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("append_audit_event"))).toBe(true);
  });
});
