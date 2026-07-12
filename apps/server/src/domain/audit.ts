import type pg from "pg";
import type { Db } from "../db.js";
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

export async function appendAudit(clientOrDb: pg.PoolClient | Db, event: AuditInput): Promise<void> {
  await clientOrDb.query(
    `insert into audit_event
      (event_type, actor_type, actor_id, object_type, object_id, before_json, after_json, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      event.eventType,
      event.actorType,
      event.actorId ?? null,
      event.objectType ?? null,
      event.objectId ?? null,
      JSON.stringify(redact(event.before ?? null)),
      JSON.stringify(redact(event.after ?? null)),
      event.correlationId
    ]
  );
}
