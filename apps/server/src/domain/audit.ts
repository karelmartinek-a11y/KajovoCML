import { createHash } from "node:crypto";
import type pg from "pg";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { redact } from "../security/secrets.js";

export type AuditInput = {
  eventType: string;
  actorType: string;
  actorId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  before?: unknown;
  after?: unknown;
  correlationId: string;
};

type AuditHashPayload = {
  eventType: string;
  actorType: string;
  actorId: string | null;
  objectType: string | null;
  objectId: string | null;
  before: unknown;
  after: unknown;
  correlationId: string;
};

function isDb(value: pg.PoolClient | Db): value is Db {
  return "connect" in value && !("release" in value);
}

export function hashAuditEvent(prevHashHex: string | null, payload: AuditHashPayload): Buffer {
  return createHash("sha256")
    .update(JSON.stringify({
      prevHash: prevHashHex,
      ...payload
    }))
    .digest();
}

async function appendAuditWithClient(client: pg.PoolClient, event: AuditInput): Promise<void> {
  const before = redact(event.before ?? null);
  const after = redact(event.after ?? null);
  await client.query(
    "select append_audit_event($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::uuid)",
    [
      event.eventType,
      event.actorType,
      event.actorId ?? null,
      event.objectType ?? null,
      event.objectId ?? null,
      JSON.stringify(before),
      JSON.stringify(after),
      event.correlationId
    ]
  );
}

export async function appendAudit(clientOrDb: pg.PoolClient | Db, event: AuditInput): Promise<void> {
  if (isDb(clientOrDb)) {
    await tx(clientOrDb, async (client) => appendAuditWithClient(client, event));
    return;
  }
  await appendAuditWithClient(clientOrDb, event);
}

export async function verifyAuditChain(db: Db): Promise<{
  valid: boolean;
  eventCount: number;
  latestEventId: number | null;
  brokenEventId: number | null;
}> {
  const result = await db.query("select * from verify_audit_chain()");
  const row = result.rows[0];
  if (!row) return { valid: false, eventCount: 0, latestEventId: null, brokenEventId: null };
  return {
    valid: Boolean(row.valid),
    eventCount: Number(row.event_count),
    latestEventId: row.latest_event_id === null ? null : Number(row.latest_event_id),
    brokenEventId: row.broken_event_id === null ? null : Number(row.broken_event_id)
  };
}
