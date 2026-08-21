import { createHash } from "node:crypto";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import type pg from "pg";

type SqlExecutor = Db | pg.PoolClient;

export type DiscussionRole = "OWNER" | "ASSISTANT" | "SYSTEM";
export type GenerationSpec = {
  objective: string;
  resultSummary: string;
  behavioralRequirements: string[];
  inputsAndOutputs: { inputs: string[]; outputs: string[] };
  externalSystems: string[];
  businessRules: string[];
  explicitOwnerDecisions: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  verifiedFacts: string[];
  openQuestions: string[];
  browserAutomations: unknown[];
};

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
}

export function canonicalJson(value: unknown): string { return JSON.stringify(sorted(value)); }
export function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }

function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function asSpec(value: unknown, prompt: string): GenerationSpec {
  const current = value && typeof value === "object" ? value as Partial<GenerationSpec> : {};
  return {
    objective: text(current.objective, prompt), resultSummary: text(current.resultSummary),
    behavioralRequirements: Array.isArray(current.behavioralRequirements) ? current.behavioralRequirements.filter((item): item is string => typeof item === "string") : [prompt],
    inputsAndOutputs: current.inputsAndOutputs ?? { inputs: [], outputs: [] },
    externalSystems: Array.isArray(current.externalSystems) ? current.externalSystems.filter((item): item is string => typeof item === "string") : [],
    businessRules: Array.isArray(current.businessRules) ? current.businessRules.filter((item): item is string => typeof item === "string") : [],
    explicitOwnerDecisions: Array.isArray(current.explicitOwnerDecisions) ? current.explicitOwnerDecisions.filter((item): item is string => typeof item === "string") : [],
    constraints: Array.isArray(current.constraints) ? current.constraints.filter((item): item is string => typeof item === "string") : [],
    acceptanceCriteria: Array.isArray(current.acceptanceCriteria) ? current.acceptanceCriteria.filter((item): item is string => typeof item === "string") : [],
    verifiedFacts: Array.isArray(current.verifiedFacts) ? current.verifiedFacts.filter((item): item is string => typeof item === "string") : [],
    openQuestions: Array.isArray(current.openQuestions) ? current.openQuestions.filter((item): item is string => typeof item === "string") : [],
    browserAutomations: Array.isArray(current.browserAutomations) ? current.browserAutomations : []
  };
}

export async function appendDiscussionEvent(db: SqlExecutor, jobId: string, type: string, payload: Record<string, unknown> = {}): Promise<number> {
  const result = await db.query("insert into generation_event(job_id,type,payload) values ($1,$2,$3::jsonb) returning sequence", [jobId, type, JSON.stringify(payload)]);
  return Number(result.rows[0].sequence);
}

export async function createDiscussionMessage(db: SqlExecutor, jobId: string, role: DiscussionRole, content: string, turnId: string | null, idempotencyKey?: string) {
  if (idempotencyKey) {
    const existing = await db.query("select id,sequence,role,status,content,turn_id,created_at from generation_job_message where job_id=$1 and idempotency_key=$2", [jobId, idempotencyKey]);
    if (existing.rowCount) {
      const row = existing.rows[0];
      return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
    }
  }
  const result = await db.query(
    `insert into generation_job_message(job_id,role,content,turn_id,idempotency_key)
     values ($1,$2,$3,$4,$5) on conflict (job_id,idempotency_key) do update set content=excluded.content
     returning id,sequence,role,status,content,turn_id,created_at`,
    [jobId, role, content, turnId, idempotencyKey ?? null]
  );
  const row = result.rows[0];
  await appendDiscussionEvent(db, jobId, "message.created", { messageId: row.id, sequence: Number(row.sequence), role, turnId, content });
  return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
}

export async function getDiscussionMessages(db: SqlExecutor, jobId: string) {
  const result = await db.query("select id,sequence,role,status,content,turn_id,created_at from generation_job_message where job_id=$1 order by sequence", [jobId]);
  return result.rows.map((row) => ({ id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() }));
}

export async function getCurrentSpec(db: SqlExecutor, jobId: string) {
  const result = await db.query("select id,revision,spec,canonical_json,digest,source_turn_id,created_at from generation_spec_revision where job_id=$1 order by revision desc limit 1", [jobId]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: String(row.id), revision: Number(row.revision), spec: row.spec as GenerationSpec, canonicalJson: String(row.canonical_json), digest: String(row.digest), sourceTurnId: row.source_turn_id ? String(row.source_turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
}

export async function createSpecRevision(db: SqlExecutor, jobId: string, spec: GenerationSpec, turnId: string) {
  const canonical = canonicalJson(spec); const specDigest = digest(spec);
  const result = await db.query(
    `insert into generation_spec_revision(job_id,revision,spec,canonical_json,digest,source_turn_id)
     values ($1,(select coalesce(max(revision),0)+1 from generation_spec_revision where job_id=$1),$2::jsonb,$3,$4,$5)
     on conflict (job_id,digest) do nothing
     returning id,revision,spec,canonical_json,digest,source_turn_id,created_at`,
    [jobId, JSON.stringify(spec), canonical, specDigest, turnId]
  );
  const row = result.rows[0] ?? (await getCurrentSpec(db, jobId));
  if (!row) throw new Error("generation_spec_revision_not_created");
  const revision = { id: String(row.id), revision: Number(row.revision), spec: row.spec as GenerationSpec, canonicalJson: String(row.canonical_json), digest: String(row.digest), sourceTurnId: row.source_turn_id ? String(row.source_turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
  await db.query("update generation_job set current_spec_revision_id=$2,discussion_version=discussion_version+1,updated_at=now() where id=$1 and state='DISCUSSING'", [jobId, revision.id]);
  await appendDiscussionEvent(db, jobId, "spec.revision.created", { revisionId: revision.id, revision: revision.revision, digest: revision.digest });
  return revision;
}

async function responseText(apiKey: string, model: string, input: string, history: Array<{ role: string; content: string }>, signal?: AbortSignal): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: [...history, { role: "user", content: input }], store: false }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`openai_responses_${response.status}`);
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Array<{ type?: string; text?: string }> }).content : []).filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("\n");
}

export async function runDiscussionTurn(db: Db, config: AppServerConfig, jobId: string, ownerId: string, content: string, apiKey: string, idempotencyKey?: string) {
  return tx(db, async (client) => {
    const job = await client.query("select state,approved_spec_revision_id from generation_job where id=$1 and owner_admin_id=$2 for update", [jobId, ownerId]);
    if (!job.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    if (String(job.rows[0].state) !== "DISCUSSING") throw Object.assign(new Error("generation_discussion_closed"), { statusCode: 409 });
    if (job.rows[0].approved_spec_revision_id) throw Object.assign(new Error("generation_spec_frozen"), { statusCode: 409 });
    const active = await client.query("select 1 from generation_discussion_turn where job_id=$1 and status in ('QUEUED','RUNNING') limit 1", [jobId]);
    if (active.rowCount) throw Object.assign(new Error("generation_turn_already_active"), { statusCode: 409 });
    const turn = await client.query("insert into generation_discussion_turn(job_id,input_message_id,status) values ($1,gen_random_uuid(),'QUEUED') returning id", [jobId]);
    const turnId = String(turn.rows[0].id);
    const message = await createDiscussionMessage(client, jobId, "OWNER", content, turnId, idempotencyKey);
    await client.query("update generation_discussion_turn set input_message_id=$2,status='RUNNING',started_at=now() where id=$1", [turnId, message.id]);
    await appendDiscussionEvent(client, jobId, "turn.started", { turnId });
    return { turnId, messageId: String(message.id) };
  }).then(async ({ turnId }) => {
    const history = (await getDiscussionMessages(db, jobId)).filter((message) => message.role !== "SYSTEM").slice(-41, -1).map((message) => ({ role: message.role === "OWNER" ? "user" : "assistant", content: message.content }));
    const assistant = await responseText(apiKey, config.GENERATION_OPENAI_MODEL, content, history);
    const existing = await getCurrentSpec(db, jobId);
    const spec = asSpec(existing?.spec, content);
    spec.objective = content;
    spec.resultSummary = assistant.slice(0, 2000);
    if (!spec.behavioralRequirements.includes(content)) spec.behavioralRequirements = [...spec.behavioralRequirements, content].slice(-50);
    await createDiscussionMessage(db, jobId, "ASSISTANT", assistant, turnId);
    const revision = await createSpecRevision(db, jobId, spec, turnId);
    await db.query("update generation_discussion_turn set status='COMPLETED',completed_at=now() where id=$1 and status='RUNNING'", [turnId]);
    await appendDiscussionEvent(db, jobId, "turn.completed", { turnId, revisionId: revision.id });
    return { turnId, revision, assistant };
  });
}

export async function approveSpec(db: Db, jobId: string, ownerId: string, revisionId: string, expectedDigest: string) {
  const result = await tx(db, async (client) => {
    const row = await client.query("select state,current_spec_revision_id from generation_job where id=$1 and owner_admin_id=$2 for update", [jobId, ownerId]);
    if (!row.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    const spec = await client.query("select id,digest from generation_spec_revision where id=$1 and job_id=$2", [revisionId, jobId]);
    if (!spec.rowCount || String(spec.rows[0].digest) !== expectedDigest || String(row.rows[0].current_spec_revision_id) !== revisionId) throw Object.assign(new Error("GENERATION_SPEC_STALE"), { statusCode: 409 });
    if (String(row.rows[0].state) !== "DISCUSSING") throw Object.assign(new Error("generation_spec_not_approvable"), { statusCode: 409 });
    await client.query("update generation_job set approved_spec_revision_id=$2,approved_spec_digest=$3,state='ANALYZING',updated_at=now() where id=$1 and state='DISCUSSING'", [jobId, revisionId, expectedDigest]);
    return { revisionId, digest: expectedDigest };
  });
  await appendDiscussionEvent(db, jobId, "generation.state.changed", { state: "ANALYZING", approvedSpec: result });
  return result;
}
