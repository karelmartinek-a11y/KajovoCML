import { describe, expect, it } from "vitest";
import { buildAuditWhere, decodeAuditCursor, encodeAuditCursor, parseAuditQuery, sanitizeAuditRow } from "./audit-view.js";

describe("audit query contract", () => {
  it("round-trips opaque stable cursors and rejects malformed cursors", () => {
    const cursor = encodeAuditCursor(42);
    expect(decodeAuditCursor(cursor)).toBe(42);
    expect(() => parseAuditQuery({ cursor: "not-a-cursor" })).toThrow("audit_cursor_invalid");
  });

  it("builds parameterized filters for the complete API surface", () => {
    const query = parseAuditQuery({
      eventType: "admin.updated",
      actorType: "admin",
      actorId: "actor-1",
      objectType: "admin_account",
      objectId: "object-1",
      correlationId: "00000000-0000-0000-0000-000000000001",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.000Z"
    });
    const built = buildAuditWhere(query);
    expect(built.sql).toContain("created_at >= $7::timestamptz");
    expect(built.values).toHaveLength(8);
  });

  it("redacts historical secrets again on read", () => {
    expect(sanitizeAuditRow({ id: 1, before_json: { password: "secret" }, after_json: { token: "secret" } })).toMatchObject({
      before_json: { password: "[REDACTED]" },
      after_json: { token: "[REDACTED]" }
    });
    expect(sanitizeAuditRow({ id: 1, before_json: { password: "secret" }, after_json: { token: "secret" } }, false)).not.toHaveProperty("before_json");
  });
});
