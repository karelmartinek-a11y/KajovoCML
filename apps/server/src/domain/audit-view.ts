import { z } from "zod";
import { redact } from "../security/secrets.js";

const auditQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  eventType: z.string().trim().max(160).optional(),
  actorType: z.string().trim().max(80).optional(),
  actorId: z.string().trim().max(200).optional(),
  objectType: z.string().trim().max(120).optional(),
  objectId: z.string().trim().max(200).optional(),
  correlationId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strip();

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function encodeAuditCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}

export function decodeAuditCursor(value: string | undefined): number | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { id?: unknown };
    return Number.isSafeInteger(parsed.id) && Number(parsed.id) > 0 ? Number(parsed.id) : null;
  } catch {
    return null;
  }
}

export function parseAuditQuery(input: unknown): AuditQuery & { cursorId: number | null } {
  const parsed = auditQuerySchema.parse(input);
  const cursorId = decodeAuditCursor(parsed.cursor);
  if (parsed.cursor && cursorId === null) throw Object.assign(new Error("audit_cursor_invalid"), { statusCode: 400 });
  if (parsed.from && parsed.to && new Date(parsed.from).getTime() > new Date(parsed.to).getTime()) {
    throw Object.assign(new Error("audit_time_range_invalid"), { statusCode: 400 });
  }
  return { ...parsed, cursorId };
}

export function buildAuditWhere(query: AuditQuery & { cursorId?: number | null }, direction: "DESC" | "ASC" = "DESC"): { sql: string; values: unknown[] } {
  const clauses = ["1=1"];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (query.cursorId) add(direction === "DESC" ? "id < ?" : "id > ?", query.cursorId);
  if (query.eventType && query.eventType !== "all") add("event_type = ?", query.eventType);
  if (query.actorType && query.actorType !== "all") add("actor_type = ?", query.actorType);
  if (query.actorId) add("actor_id = ?", query.actorId);
  if (query.objectType && query.objectType !== "all") add("object_type = ?", query.objectType);
  if (query.objectId) add("object_id = ?", query.objectId);
  if (query.correlationId) add("correlation_id = ?::uuid", query.correlationId);
  if (query.from) add("created_at >= ?::timestamptz", query.from);
  if (query.to) add("created_at <= ?::timestamptz", query.to);
  return { sql: clauses.join(" and "), values };
}

export function sanitizeAuditRow(row: Record<string, unknown>, includePayload = true): Record<string, unknown> {
  const sanitized = {
    id: Number(row.id),
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_id: row.actor_id ?? null,
    object_type: row.object_type ?? null,
    object_id: row.object_id ?? null,
    correlation_id: row.correlation_id,
    created_at: row.created_at,
    chain: {
      sequence: row.chain_sequence === null || row.chain_sequence === undefined ? null : Number(row.chain_sequence),
      previousHash: row.prev_hash_hex ?? null,
      eventHash: row.event_hash_hex ?? null
    }
  };
  return includePayload
    ? { ...sanitized, before_json: redact(row.before_json ?? null), after_json: redact(row.after_json ?? null) }
    : sanitized;
}
