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
  return "connect" in value;
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
  const previous = await client.query(
    "select event_hash from audit_event order by id desc limit 1 for update"
  );
  const prevHash = previous.rows[0]?.event_hash ? previous.rows[0].event_hash as Buffer : null;
  const eventHash = hashAuditEvent(prevHash ? prevHash.toString("hex") : null, {
    eventType: event.eventType,
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    objectType: event.objectType ?? null,
    objectId: event.objectId ?? null,
    before,
    after,
    correlationId: event.correlationId
  });
  await client.query(
    `insert into audit_event
      (event_type, actor_type, actor_id, object_type, object_id, before_json, after_json, correlation_id, prev_hash, event_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      event.eventType,
      event.actorType,
      event.actorId ?? null,
      event.objectType ?? null,
      event.objectId ?? null,
      JSON.stringify(before),
      JSON.stringify(after),
      event.correlationId,
      prevHash,
      eventHash
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
  const result = await db.query(
    `select id, event_type, actor_type, actor_id, object_type, object_id, before_json, after_json, correlation_id, prev_hash, event_hash
       from audit_event
      order by id asc`
  );
  const eventCount = Number(result.rowCount ?? result.rows.length);
  let prevHashHex: string | null = null;
  let latestEventId: number | null = null;
  for (const row of result.rows) {
    latestEventId = Number(row.id);
    const actualPrevHash = row.prev_hash ? (row.prev_hash as Buffer).toString("hex") : null;
    if (actualPrevHash !== prevHashHex) {
      return { valid: false, eventCount, latestEventId, brokenEventId: latestEventId };
    }
    const expectedHash = hashAuditEvent(prevHashHex, {
      eventType: String(row.event_type),
      actorType: String(row.actor_type),
      actorId: row.actor_id ? String(row.actor_id) : null,
      objectType: row.object_type ? String(row.object_type) : null,
      objectId: row.object_id ? String(row.object_id) : null,
      before: row.before_json ?? null,
      after: row.after_json ?? null,
      correlationId: String(row.correlation_id)
    }).toString("hex");
    const actualHash = (row.event_hash as Buffer).toString("hex");
    if (actualHash !== expectedHash) {
      return { valid: false, eventCount, latestEventId, brokenEventId: latestEventId };
    }
    prevHashHex = actualHash;
  }
  return { valid: true, eventCount, latestEventId, brokenEventId: null };
}
