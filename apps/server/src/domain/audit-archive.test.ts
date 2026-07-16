import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db.js";
import { archivePendingAuditEvents } from "./audit-archive.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

function archiveDb(payload: unknown) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("update audit_archive_outbox outbox")) {
      return { rowCount: 1, rows: [{ event_id: 17, payload }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    db: { query, connect: vi.fn(async () => client) } as unknown as Db,
    calls
  };
}

describe("audit archive outbox", () => {
  it("writes redacted JSONL and checkpoints the leased event", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kcml-audit-"));
    temporaryPaths.push(directory);
    const target = path.join(directory, "archive.jsonl");
    const { db, calls } = archiveDb({
      eventType: "admin.changed",
      before: { password: "must-not-leak" },
      after: { nested: { accessToken: "must-not-leak-either" }, harmless: "visible" }
    });

    await expect(archivePendingAuditEvents(db, target)).resolves.toBe(1);
    const archived = JSON.parse((await readFile(target, "utf8")).trim()) as Record<string, unknown>;
    expect(archived).toMatchObject({ outboxEventId: 17 });
    expect(JSON.stringify(archived)).not.toContain("must-not-leak");
    expect(JSON.stringify(archived)).toContain("[REDACTED]");
    expect(calls.some((call) => call.sql.includes("set state='ARCHIVED'"))).toBe(true);
  });

  it("returns the lease to the retry queue when the archive cannot be written", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kcml-audit-failure-"));
    temporaryPaths.push(directory);
    const { db, calls } = archiveDb({ eventType: "test" });

    await expect(archivePendingAuditEvents(db, directory)).rejects.toThrow();
    expect(calls.some((call) => call.sql.includes("set state='PENDING'") && call.sql.includes("next_attempt_at"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("set state='ARCHIVED'"))).toBe(false);
  });
});
