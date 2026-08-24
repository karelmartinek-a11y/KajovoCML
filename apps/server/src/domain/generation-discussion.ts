import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import type pg from "pg";
import { streamResponse, type ResponsesStreamEvent } from "../generation/openai-responses.js";
import { lookupCmlCapabilities, readCmlCapabilityContract, type CapabilityCandidate } from "./capability-discovery.js";

type SqlExecutor = Db | pg.PoolClient;

function isPoolExecutor(executor: SqlExecutor): executor is Db {
  return typeof (executor as pg.PoolClient).release !== "function";
}

export type DiscussionRole = "OWNER" | "ASSISTANT" | "SYSTEM";
const textList = z.array(z.string().trim().min(1).max(10_000)).max(200);
const browserAutomationStepSchema = z.object({
  sequence: z.number().int().nonnegative(), purpose: z.string().trim().min(1),
  action: z.enum(["NAVIGATE", "CLICK", "FILL", "FILL_SECRET", "SELECT", "CHECK", "UNCHECK", "PRESS", "UPLOAD", "DOWNLOAD", "WAIT_FOR", "ASSERT", "EXTRACT", "BRANCH", "REPEAT_BOUNDED"]),
  locator: z.record(z.string(), z.unknown()).nullable(), inputBinding: z.record(z.string(), z.unknown()).nullable(), precondition: z.record(z.string(), z.unknown()).nullable(),
  waitCondition: z.record(z.string(), z.unknown()).nullable(), postcondition: z.record(z.string(), z.unknown()).nullable(),
  sideEffectClass: z.enum(["READ_ONLY", "LOCAL_INPUT", "AUTHENTICATION", "MUTATION_IDEMPOTENT", "MUTATION_NON_IDEMPOTENT", "DESTRUCTIVE"]),
  retryClass: z.enum(["SAFE_RETRY", "RECHECK_BEFORE_RETRY", "NO_AUTO_RETRY"]), timeoutMs: z.number().int().positive().optional(), maxIterations: z.number().int().positive().optional()
}).strict();
const browserAutomationRequirementSchema = z.object({
  id: z.string().trim().min(1), name: z.string().trim().min(1), purpose: z.string().trim().min(1),
  invocation: z.object({ type: z.enum(["MCP_TOOL", "INTERNAL_FUNCTION"]), executionMode: z.enum(["SYNC", "ASYNC", "AUTO"]), businessToolName: z.string().trim().min(1), asyncCompanionTools: z.boolean() }).strict(),
  runtime: z.object({ engine: z.literal("KCML_PLAYWRIGHT_PLATFORM"), contractVersion: z.string().trim().min(1) }).strict(),
  navigationPolicy: z.object({ entryOrigins: textList, allowedOrigins: textList, authOrigins: textList, redirectOrigins: textList, downloadOrigins: textList, denyPrivateNetwork: z.boolean() }).strict(),
  browserContext: z.object({ locale: z.string().optional(), timezoneId: z.string().optional(), viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(), userAgentPolicy: z.enum(["PLAYWRIGHT_DEFAULT", "PINNED"]) }).strict(),
  inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()),
  authentication: z.object({ mode: z.enum(["NONE", "LOGIN_EACH_RUN", "REUSABLE_SESSION_STATE", "HYBRID"]), accountKey: z.string().optional(), secretBindings: z.array(z.object({ name: z.string().trim().min(1), purpose: z.string().trim().min(1), required: z.boolean() }).strict()), challengePolicy: z.enum(["PAUSE_FOR_OWNER", "FAIL"]) }).strict(),
  workflow: z.array(browserAutomationStepSchema).min(1).max(200), successCriteria: z.array(z.record(z.string(), z.unknown())), failureCriteria: z.array(z.record(z.string(), z.unknown())),
  idempotency: z.object({ strategy: z.enum(["READ_ONLY", "CALLER_KEY", "PRECONDITION_POSTCONDITION", "NO_BLIND_RETRY"]), keyInputPaths: textList.optional() }).strict(),
  concurrency: z.object({ keyTemplate: z.string().trim().min(1), maxConcurrent: z.number().int().positive() }).strict(),
  execution: z.object({ queueTimeoutMs: z.number().int().positive(), runTimeoutMs: z.number().int().positive(), stepDefaultTimeoutMs: z.number().int().positive(), maxSteps: z.number().int().positive() }).strict(),
  artifacts: z.object({ allowUpload: z.boolean(), allowDownload: z.boolean(), maxUploadBytes: z.number().int().positive().optional(), maxDownloadBytes: z.number().int().positive().optional(), allowedMimeTypes: textList.optional(), retentionHours: z.number().int().positive() }).strict(),
  monitoring: z.object({ driftDetection: z.boolean(), recordFailedStepEvidence: z.boolean(), repairOnContractDrift: z.boolean() }).strict(), teachingEvidenceIds: textList
}).strict();
const capabilityReuseReferenceSchema = z.object({ componentId: z.string().uuid(), revisionId: z.string().uuid(), toolContractId: z.string().uuid(), contractDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict();
const capabilityDecisionSchema = z.object({
  requirementDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/), decision: z.enum(["FULL_REUSE", "PARTIAL_REUSE", "NEW_CAPABILITY_REQUIRED"]),
  reuse: z.array(capabilityReuseReferenceSchema).max(50), reusableBehavior: textList, missingDelta: textList, permissionDelta: textList
}).strict();
export const generationSpecificationSchema = z.object({
  objective: z.string().trim().min(1).max(20_000), resultSummary: z.string().trim().min(1).max(20_000), behavioralRequirements: textList,
  inputsAndOutputs: textList, externalSystems: textList, businessRules: textList, explicitOwnerDecisions: textList, constraints: textList,
  acceptanceCriteria: textList, verifiedFacts: textList, openQuestions: textList, browserAutomations: z.array(browserAutomationRequirementSchema).max(50),
  capabilityDecisions: z.array(capabilityDecisionSchema).max(100).optional()
}).strict();
export type GenerationSpec = z.infer<typeof generationSpecificationSchema>;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
}

export function canonicalJson(value: unknown): string { return JSON.stringify(sorted(value)); }
export function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }

export function renderSpecificationMarkdown(spec: GenerationSpec): string {
  const section = (title: string, values: string[]) => `## ${title}\n${values.length ? values.map((value) => `- ${value}`).join("\n") : "- —"}`;
  return ["# Generation specification", `## Objective\n${spec.objective}`, `## Result summary\n${spec.resultSummary}`,
    section("Behavioral requirements", spec.behavioralRequirements), section("Inputs and outputs", spec.inputsAndOutputs), section("External systems", spec.externalSystems),
    section("Business rules", spec.businessRules), section("Explicit OWNER decisions", spec.explicitOwnerDecisions), section("Constraints", spec.constraints),
    section("Acceptance criteria", spec.acceptanceCriteria), section("Verified facts", spec.verifiedFacts), section("Open questions", spec.openQuestions),
    `## Capability decisions\n${(spec.capabilityDecisions ?? []).length ? (spec.capabilityDecisions ?? []).map((decision) => `- ${decision.decision}: reuse ${decision.reuse.map((item) => item.componentId).join(", ") || "—"}; missing delta ${decision.missingDelta.join("; ") || "—"}`).join("\n") : "- —"}`,
    `## Browser automations\n${spec.browserAutomations.length ? spec.browserAutomations.map((automation) => `- ${automation.name}: ${automation.purpose}`).join("\n") : "- —"}`].join("\n\n");
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
      if (String(row.content) !== content || String(row.role) !== role) throw Object.assign(new Error("generation_message_idempotency_conflict"), { statusCode: 409 });
      return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
    }
  }
  const result = await db.query(
    `insert into generation_job_message(job_id,role,content,turn_id,idempotency_key)
     values ($1,$2,$3,$4,$5) on conflict (job_id,idempotency_key) do nothing
     returning id,sequence,role,status,content,turn_id,created_at`,
    [jobId, role, content, turnId, idempotencyKey ?? null]
  );
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("generation_message_idempotency_conflict"), { statusCode: 409 });
  await appendDiscussionEvent(db, jobId, "discussion.message.created", { messageId: row.id, sequence: Number(row.sequence), role, turnId, content });
  return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
}

export type DiscussionLease = { owner: string; token: string };
type DiscussionMessageRecord = { id: string; sequence: number; role: string; status: string; content: string; turnId: string | null; createdAt: string };

function leaseLostError(): Error & { interrupted: boolean } {
  return Object.assign(new Error("discussion_lease_lost"), { interrupted: true });
}

async function assertDiscussionLease(db: SqlExecutor, turnId: string, lease: DiscussionLease): Promise<void> {
  const result = await db.query(
    `select 1 from generation_discussion_turn
      where id=$1 and status in ('RUNNING','INTERRUPT_REQUESTED')
        and lease_owner=$2 and lease_token=$3 and lease_until>now()`,
    [turnId, lease.owner, lease.token]
  );
  if (!result.rowCount) throw leaseLostError();
}

export async function createLeasedAssistantMessage(db: SqlExecutor, jobId: string, turnId: string, lease: DiscussionLease): Promise<DiscussionMessageRecord> {
  if (isPoolExecutor(db)) return tx<DiscussionMessageRecord>(db, (client) => createLeasedAssistantMessage(client, jobId, turnId, lease));
  const existing = await db.query("select id,sequence,role,status,content,turn_id,created_at from generation_job_message where job_id=$1 and idempotency_key=$2", [jobId, `assistant:${turnId}`]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
  }
  const result = await db.query(
    `insert into generation_job_message(job_id,role,content,turn_id,idempotency_key,status)
     select $1,'ASSISTANT','',$2,$3,'STREAMING'
      where exists (select 1 from generation_discussion_turn where id=$2 and job_id=$1
                    and status in ('RUNNING','INTERRUPT_REQUESTED') and lease_owner=$4 and lease_token=$5 and lease_until>now())
     on conflict (job_id,idempotency_key) do nothing
     returning id,sequence,role,status,content,turn_id,created_at`,
    [jobId, turnId, `assistant:${turnId}`, lease.owner, lease.token]
  );
  if (!result.rowCount) {
    const retry = await db.query("select id,sequence,role,status,content,turn_id,created_at from generation_job_message where job_id=$1 and idempotency_key=$2", [jobId, `assistant:${turnId}`]);
    if (!retry.rowCount) throw leaseLostError();
    const row = retry.rows[0];
    return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
  }
  const row = result.rows[0];
  await appendDiscussionEvent(db, jobId, "discussion.message.created", { messageId: row.id, sequence: Number(row.sequence), role: "ASSISTANT", turnId });
  return { id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() };
}

async function markLeasedAssistantStreaming(db: Db, turnId: string, messageId: string, model: string, lease: DiscussionLease): Promise<void> {
  await tx(db, async (client) => {
    const turn = await client.query(
      `select 1 from generation_discussion_turn
        where id=$1 and status in ('RUNNING','INTERRUPT_REQUESTED')
          and lease_owner=$2 and lease_token=$3 and lease_until>now() for update`,
      [turnId, lease.owner, lease.token]
    );
    if (!turn.rowCount) throw leaseLostError();
    const message = await client.query(
      "update generation_job_message set status='STREAMING',model=$2 where id=$1 and turn_id=$3 and role='ASSISTANT' and status in ('STREAMING','INTERRUPTED') returning id",
      [messageId, model, turnId]
    );
    if (!message.rowCount) throw leaseLostError();
  });
}

async function persistLeasedProviderResponse(db: Db, turnId: string, responseId: string, lease: DiscussionLease): Promise<void> {
  await tx(db, async (client) => {
    const turn = await client.query(
      `select 1 from generation_discussion_turn
        where id=$1 and status in ('RUNNING','INTERRUPT_REQUESTED')
          and lease_owner=$2 and lease_token=$3 and lease_until>now() for update`,
      [turnId, lease.owner, lease.token]
    );
    if (!turn.rowCount) throw leaseLostError();
    await client.query("update generation_discussion_turn set provider_response_id=$2 where id=$1", [turnId, responseId]);
  });
}

async function persistLeasedDelta(db: Db, jobId: string, turnId: string, messageId: string, content: string, delta: string, lease: DiscussionLease): Promise<void> {
  await tx(db, async (client) => {
    const turn = await client.query(
      `select 1 from generation_discussion_turn
        where id=$1 and status in ('RUNNING','INTERRUPT_REQUESTED')
          and lease_owner=$2 and lease_token=$3 and lease_until>now() for update`,
      [turnId, lease.owner, lease.token]
    );
    if (!turn.rowCount) throw leaseLostError();
    const updated = await client.query("update generation_job_message set content=$2 where id=$1 and turn_id=$3 and status='STREAMING' returning id", [messageId, content, turnId]);
    if (!updated.rowCount) throw leaseLostError();
    await appendDiscussionEvent(client, jobId, "discussion.message.delta", { messageId, delta });
  });
}

async function appendLeasedDiscussionEvent(db: Db, jobId: string, turnId: string, lease: DiscussionLease, type: string, payload: Record<string, unknown> = {}): Promise<number> {
  return tx(db, async (client) => {
    const turn = await client.query(
      `select 1 from generation_discussion_turn
        where id=$1 and status in ('RUNNING','INTERRUPT_REQUESTED')
          and lease_owner=$2 and lease_token=$3 and lease_until>now() for update`,
      [turnId, lease.owner, lease.token]
    );
    if (!turn.rowCount) throw leaseLostError();
    return appendDiscussionEvent(client, jobId, type, payload);
  });
}

async function finalizeLeasedDiscussionTurn(db: Db, input: {
  jobId: string; turnId: string; messageId: string; lease: DiscussionLease; status: "COMPLETED" | "INTERRUPTED" | "FAILED";
  content: string; providerResponseId?: string | null; errorCode?: string | null;
}): Promise<boolean> {
  return tx(db, async (client) => {
    const turn = await client.query("select status,lease_owner,lease_token from generation_discussion_turn where id=$1 for update", [input.turnId]);
    const row = turn.rows[0];
    if (!row || !["RUNNING", "INTERRUPT_REQUESTED"].includes(String(row.status)) || String(row.lease_owner) !== input.lease.owner || String(row.lease_token) !== input.lease.token) return false;
    await client.query(
      `update generation_job_message set content=$2,status=$3,provider_response_id=$4,
          interrupted_at=case when $3='INTERRUPTED' then now() else null end,
          completed_at=case when $3 in ('COMPLETED','FAILED') then now() else null end
        where id=$1 and turn_id=$5 and status in ('STREAMING','INTERRUPTED')`,
      [input.messageId, input.content, input.status, input.providerResponseId ?? null, input.turnId]
    );
    await client.query(
      `update generation_discussion_turn set status=$2,provider_response_id=$3,error_code=$4,
          interrupted_at=case when $2='INTERRUPTED' then now() else interrupted_at end,
          completed_at=now(),lease_owner=null,lease_token=null,lease_until=null
        where id=$1`,
      [input.turnId, input.status, input.providerResponseId ?? null, input.errorCode ?? null]
    );
    const messageEvent = input.status === "COMPLETED" ? "discussion.message.completed" : input.status === "INTERRUPTED" ? "discussion.message.interrupted" : "discussion.message.failed";
    const turnEvent = input.status === "COMPLETED" ? "discussion.turn.completed" : input.status === "INTERRUPTED" ? "discussion.turn.interrupted" : "discussion.turn.failed";
    await appendDiscussionEvent(client, input.jobId, messageEvent, { messageId: input.messageId, content: input.content });
    await appendDiscussionEvent(client, input.jobId, turnEvent, { turnId: input.turnId, messageId: input.messageId, providerResponseId: input.providerResponseId ?? undefined, errorCode: input.errorCode ?? undefined });
    return true;
  });
}

export async function getDiscussionMessages(db: SqlExecutor, jobId: string) {
  const result = await db.query("select id,sequence,role,status,content,turn_id,created_at from generation_job_message where job_id=$1 order by sequence", [jobId]);
  return result.rows.map((row) => ({ id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() }));
}

export async function getCurrentSpec(db: SqlExecutor, jobId: string) {
  const result = await db.query("select id,revision,spec,canonical_json,digest,source_turn_id,rendered_markdown,created_at from generation_spec_revision where job_id=$1 order by revision desc limit 1", [jobId]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: String(row.id), revision: Number(row.revision), spec: row.spec as GenerationSpec, canonicalJson: String(row.canonical_json), digest: String(row.digest), sourceTurnId: row.source_turn_id ? String(row.source_turn_id) : null, renderedMarkdown: String(row.rendered_markdown ?? ""), createdAt: new Date(row.created_at).toISOString() };
}

export type GenerationSpecRevision = Readonly<{
  id: string; revision: number; spec: GenerationSpec; canonicalJson: string; digest: string;
  sourceTurnId: string | null; renderedMarkdown: string; createdAt: string; created: boolean;
}>;

export async function createSpecRevision(db: SqlExecutor, jobId: string, input: unknown, turnId: string, lease?: DiscussionLease): Promise<GenerationSpecRevision> {
  if (isPoolExecutor(db)) return tx<GenerationSpecRevision>(db, (client) => createSpecRevisionLocked(client, jobId, input, turnId, lease));
  return createSpecRevisionLocked(db, jobId, input, turnId, lease);
}

/** The parent job row is the per-job monotonic revision allocator. */
async function createSpecRevisionLocked(db: SqlExecutor, jobId: string, input: unknown, turnId: string, lease?: DiscussionLease): Promise<GenerationSpecRevision> {
  const spec = generationSpecificationSchema.parse(input);
  const canonical = canonicalJson(spec); const specDigest = digest(spec); const renderedMarkdown = renderSpecificationMarkdown(spec);
  const job = await db.query("select id,state from generation_job where id=$1 for update", [jobId]);
  if (!job.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  if (String(job.rows[0].state) !== "DISCUSSING") throw Object.assign(new Error("generation_discussion_closed"), { statusCode: 409 });
  if (lease) {
    const turn = await db.query(
      `select 1 from generation_discussion_turn
        where id=$1 and job_id=$2 and status in ('RUNNING','INTERRUPT_REQUESTED')
          and lease_owner=$3 and lease_token=$4 and lease_until>now() for update`,
      [turnId, jobId, lease.owner, lease.token]
    );
    if (!turn.rowCount) throw leaseLostError();
  }
  const current = await getCurrentSpec(db, jobId);
  if (current?.digest === specDigest) return { ...current, created: false };
  const existing = await db.query(
    "select id,revision,spec,canonical_json,digest,source_turn_id,rendered_markdown,created_at from generation_spec_revision where job_id=$1 and digest=$2 order by revision limit 1",
    [jobId, specDigest]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    const revision = { id: String(row.id), revision: Number(row.revision), spec: row.spec as GenerationSpec, canonicalJson: String(row.canonical_json), digest: String(row.digest), sourceTurnId: row.source_turn_id ? String(row.source_turn_id) : null, renderedMarkdown: String(row.rendered_markdown), createdAt: new Date(row.created_at).toISOString() };
    await db.query("update generation_job set current_spec_revision_id=$2,current_spec_job_id=$1,updated_at=now() where id=$1 and state='DISCUSSING'", [jobId, revision.id]);
    await appendDiscussionEvent(db, jobId, "spec.revision.reused", { revisionId: revision.id, revision: revision.revision, digest: revision.digest });
    return { ...revision, created: false };
  }
  const result = await db.query(
    `insert into generation_spec_revision(job_id,revision,spec,canonical_json,digest,source_turn_id,source_job_id,rendered_markdown)
     values ($1,(select coalesce(max(revision),0)+1 from generation_spec_revision where job_id=$1),$2::jsonb,$3,$4,$5,$1,$6)
     returning id,revision,spec,canonical_json,digest,source_turn_id,rendered_markdown,created_at`,
    [jobId, JSON.stringify(spec), canonical, specDigest, turnId, renderedMarkdown]
  );
  const row = result.rows[0];
  if (!row) throw new Error("generation_spec_revision_not_created");
  const revision = { id: String(row.id), revision: Number(row.revision), spec: row.spec as GenerationSpec, canonicalJson: String(row.canonical_json), digest: String(row.digest), sourceTurnId: row.source_turn_id ? String(row.source_turn_id) : null, renderedMarkdown: String(row.rendered_markdown), createdAt: new Date(row.created_at).toISOString() };
  await db.query("update generation_job set current_spec_revision_id=$2,current_spec_job_id=$1,discussion_version=discussion_version+1,updated_at=now() where id=$1 and state='DISCUSSING'", [jobId, revision.id]);
  await appendDiscussionEvent(db, jobId, "spec.revision.created", { revisionId: revision.id, revision: revision.revision, digest: revision.digest });
  return { ...revision, created: true };
}

const nullableObject = { type: ["object", "null"], additionalProperties: true };
const stringArray = { type: "array", items: { type: "string" } };
const browserAutomationToolSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string" }, name: { type: "string" }, purpose: { type: "string" },
    invocation: { type: "object", additionalProperties: false, properties: {
      type: { type: "string", enum: ["MCP_TOOL", "INTERNAL_FUNCTION"] }, executionMode: { type: "string", enum: ["SYNC", "ASYNC", "AUTO"] }, businessToolName: { type: "string" }, asyncCompanionTools: { type: "boolean" }
    }, required: ["type", "executionMode", "businessToolName", "asyncCompanionTools"] },
    runtime: { type: "object", additionalProperties: false, properties: { engine: { type: "string", enum: ["KCML_PLAYWRIGHT_PLATFORM"] }, contractVersion: { type: "string" } }, required: ["engine", "contractVersion"] },
    navigationPolicy: { type: "object", additionalProperties: false, properties: { entryOrigins: stringArray, allowedOrigins: stringArray, authOrigins: stringArray, redirectOrigins: stringArray, downloadOrigins: stringArray, denyPrivateNetwork: { type: "boolean" } }, required: ["entryOrigins", "allowedOrigins", "authOrigins", "redirectOrigins", "downloadOrigins", "denyPrivateNetwork"] },
    browserContext: { type: "object", additionalProperties: false, properties: { locale: { type: "string" }, timezoneId: { type: "string" }, viewport: { type: "object", additionalProperties: false, properties: { width: { type: "integer" }, height: { type: "integer" } }, required: ["width", "height"] }, userAgentPolicy: { type: "string", enum: ["PLAYWRIGHT_DEFAULT", "PINNED"] } }, required: ["userAgentPolicy"] },
    inputSchema: { type: "object", additionalProperties: true }, outputSchema: { type: "object", additionalProperties: true },
    authentication: { type: "object", additionalProperties: false, properties: { mode: { type: "string", enum: ["NONE", "LOGIN_EACH_RUN", "REUSABLE_SESSION_STATE", "HYBRID"] }, accountKey: { type: "string" }, secretBindings: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, purpose: { type: "string" }, required: { type: "boolean" } }, required: ["name", "purpose", "required"] } }, challengePolicy: { type: "string", enum: ["PAUSE_FOR_OWNER", "FAIL"] } }, required: ["mode", "secretBindings", "challengePolicy"] },
    workflow: { type: "array", items: { type: "object", additionalProperties: false, properties: { sequence: { type: "integer" }, purpose: { type: "string" }, action: { type: "string", enum: ["NAVIGATE", "CLICK", "FILL", "FILL_SECRET", "SELECT", "CHECK", "UNCHECK", "PRESS", "UPLOAD", "DOWNLOAD", "WAIT_FOR", "ASSERT", "EXTRACT", "BRANCH", "REPEAT_BOUNDED"] }, locator: nullableObject, inputBinding: nullableObject, precondition: nullableObject, waitCondition: nullableObject, postcondition: nullableObject, sideEffectClass: { type: "string", enum: ["READ_ONLY", "LOCAL_INPUT", "AUTHENTICATION", "MUTATION_IDEMPOTENT", "MUTATION_NON_IDEMPOTENT", "DESTRUCTIVE"] }, retryClass: { type: "string", enum: ["SAFE_RETRY", "RECHECK_BEFORE_RETRY", "NO_AUTO_RETRY"] }, timeoutMs: { type: "integer" }, maxIterations: { type: "integer" } }, required: ["sequence", "purpose", "action", "locator", "inputBinding", "precondition", "waitCondition", "postcondition", "sideEffectClass", "retryClass"] } },
    successCriteria: { type: "array", items: { type: "object", additionalProperties: true } }, failureCriteria: { type: "array", items: { type: "object", additionalProperties: true } },
    idempotency: { type: "object", additionalProperties: false, properties: { strategy: { type: "string", enum: ["READ_ONLY", "CALLER_KEY", "PRECONDITION_POSTCONDITION", "NO_BLIND_RETRY"] }, keyInputPaths: stringArray }, required: ["strategy"] },
    concurrency: { type: "object", additionalProperties: false, properties: { keyTemplate: { type: "string" }, maxConcurrent: { type: "integer" } }, required: ["keyTemplate", "maxConcurrent"] },
    execution: { type: "object", additionalProperties: false, properties: { queueTimeoutMs: { type: "integer" }, runTimeoutMs: { type: "integer" }, stepDefaultTimeoutMs: { type: "integer" }, maxSteps: { type: "integer" } }, required: ["queueTimeoutMs", "runTimeoutMs", "stepDefaultTimeoutMs", "maxSteps"] },
    artifacts: { type: "object", additionalProperties: false, properties: { allowUpload: { type: "boolean" }, allowDownload: { type: "boolean" }, maxUploadBytes: { type: "integer" }, maxDownloadBytes: { type: "integer" }, allowedMimeTypes: stringArray, retentionHours: { type: "integer" } }, required: ["allowUpload", "allowDownload", "retentionHours"] },
    monitoring: { type: "object", additionalProperties: false, properties: { driftDetection: { type: "boolean" }, recordFailedStepEvidence: { type: "boolean" }, repairOnContractDrift: { type: "boolean" } }, required: ["driftDetection", "recordFailedStepEvidence", "repairOnContractDrift"] },
    teachingEvidenceIds: stringArray
  }, required: ["id", "name", "purpose", "invocation", "runtime", "navigationPolicy", "browserContext", "inputSchema", "outputSchema", "authentication", "workflow", "successCriteria", "failureCriteria", "idempotency", "concurrency", "execution", "artifacts", "monitoring", "teachingEvidenceIds"]
};
const proposeGenerationSpecificationTool = {
  type: "function", name: "propose_generation_specification",
  description: "Persist a complete immutable GenerationSpecification revision when the OWNER request is sufficiently resolved. Call only after asking every necessary OWNER follow-up question.",
  // GenerationSpecification deliberately contains arbitrary JSON schemas for typed
  // automation I/O.  Those open sub-schemas are outside the provider's strict subset;
  // Zod below is therefore the canonical server-side validation boundary.
  strict: false,
  parameters: {
    type: "object", additionalProperties: false,
    properties: {
      objective: { type: "string" }, resultSummary: { type: "string" }, behavioralRequirements: stringArray,
      inputsAndOutputs: stringArray, externalSystems: stringArray, businessRules: stringArray, explicitOwnerDecisions: stringArray,
      constraints: stringArray, acceptanceCriteria: stringArray, verifiedFacts: stringArray, openQuestions: stringArray,
      browserAutomations: { type: "array", items: browserAutomationToolSchema },
      capabilityDecisions: { type: "array", items: { type: "object", additionalProperties: false, properties: { requirementDigest: { type: "string" }, decision: { type: "string", enum: ["FULL_REUSE", "PARTIAL_REUSE", "NEW_CAPABILITY_REQUIRED"] }, reuse: { type: "array", items: { type: "object", additionalProperties: false, properties: { componentId: { type: "string" }, revisionId: { type: "string" }, toolContractId: { type: "string" }, contractDigest: { type: "string" } }, required: ["componentId", "revisionId", "toolContractId", "contractDigest"] } }, reusableBehavior: stringArray, missingDelta: stringArray, permissionDelta: stringArray }, required: ["requirementDigest", "decision", "reuse", "reusableBehavior", "missingDelta", "permissionDelta"] } }
    },
    required: ["objective", "resultSummary", "behavioralRequirements", "inputsAndOutputs", "externalSystems", "businessRules", "explicitOwnerDecisions", "constraints", "acceptanceCriteria", "verifiedFacts", "openQuestions", "browserAutomations", "capabilityDecisions"]
  }
};
const lookupCmlCapabilitiesTool = { type: "function", name: "lookup_cml_capabilities", strict: true, description: "Search the canonical active CML component/revision/tool contracts before deciding whether new capability is needed.", parameters: { type: "object", additionalProperties: false, properties: { requirement: { type: "string" }, keywords: stringArray }, required: ["requirement", "keywords"] } };
const readCmlCapabilityContractTool = { type: "function", name: "read_cml_capability_contract", strict: true, description: "Read the exact current safe contract of a candidate returned by lookup_cml_capabilities.", parameters: { type: "object", additionalProperties: false, properties: { componentId: { type: "string" } }, required: ["componentId"] } };

const discussionInstructions = `Jsi KajovoCML AI v persistentní OWNER diskusi. Odpovídej OWNERovi normálním srozumitelným českým textem po částech; nikdy nevracej JSON, JSON envelope ani markdownový blok obsahující interní strukturu. Neodhaluj chain of thought. Než navrhneš novou nebo změněnou GenerationSpecification, vždy zavolej lookup_cml_capabilities pro aktuální OWNER požadavek; pokud vrátí kandidáty relevantní pro rozhodnutí, načti jejich přesný contract přes read_cml_capability_contract. Teprve potom zavolej propose_generation_specification s capabilityDecisions a přesnými canonical references. Pokud zůstávají open questions, tool nevolej a polož konkrétní další otázku. Browser automation návrhy smí používat pouze KCML_PLAYWRIGHT_PLATFORM a declarativní manifest, nikdy generovaný browser runtime source.`;

export async function queueDiscussionTurn(db: Db, jobId: string, ownerId: string, content: string, idempotencyKey?: string) {
  return tx(db, async (client) => {
    const job = await client.query("select state,approved_spec_revision_id from generation_job where id=$1 and owner_admin_id=$2 for update", [jobId, ownerId]);
    if (!job.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    if (String(job.rows[0].state) !== "DISCUSSING" || job.rows[0].approved_spec_revision_id) throw Object.assign(new Error("generation_discussion_closed"), { statusCode: 409 });
    if (idempotencyKey) {
      const existing = await client.query("select id,content,turn_id from generation_job_message where job_id=$1 and idempotency_key=$2", [jobId, idempotencyKey]);
      if (existing.rowCount) {
        if (String(existing.rows[0].content) !== content) throw Object.assign(new Error("generation_message_idempotency_conflict"), { statusCode: 409 });
        return { messageId: String(existing.rows[0].id), turnId: existing.rows[0].turn_id ? String(existing.rows[0].turn_id) : null, idempotent: true };
      }
    }
    const message = await createDiscussionMessage(client, jobId, "OWNER", content, null, idempotencyKey);
    const activeTurns = await client.query("select id,status from generation_discussion_turn where job_id=$1 and status in ('QUEUED','RUNNING','INTERRUPT_REQUESTED') order by created_at for update", [jobId]);
    for (const active of activeTurns.rows) {
      if (String(active.status) === "QUEUED") {
        await client.query("update generation_discussion_turn set status='INTERRUPTED',interrupted_at=now(),completed_at=now(),lease_owner=null,lease_until=null where id=$1", [active.id]);
        await appendDiscussionEvent(client, jobId, "discussion.turn.interrupted", { turnId: String(active.id), byMessageId: message.id, beforeStart: true });
      } else if (String(active.status) === "RUNNING") {
        await client.query("update generation_discussion_turn set status='INTERRUPT_REQUESTED',interrupt_requested_at=now() where id=$1", [active.id]);
        await appendDiscussionEvent(client, jobId, "discussion.turn.interrupt_requested", { turnId: String(active.id), byMessageId: message.id });
      }
    }
    const turn = await client.query("insert into generation_discussion_turn(job_id,input_message_id,status) values ($1,$2,'QUEUED') returning id", [jobId, message.id]);
    const turnId = String(turn.rows[0].id);
    await client.query("update generation_job_message set turn_id=$2 where id=$1", [message.id, turnId]);
    await appendDiscussionEvent(client, jobId, "discussion.turn.queued", { turnId, messageId: message.id });
    return { messageId: message.id, turnId, idempotent: false };
  });
}

export const runDiscussionTurn = queueDiscussionTurn;

type PendingFunctionCall = { callId: string; itemId?: string; name: string; arguments: string };
export type CapabilityTurnEvidence = {
  /** Digest of the persisted OWNER message that this turn is answering. */
  requirementDigest: string;
  inputMessageId: string;
  candidateIds: Set<string>;
  inspected: Map<string, CapabilityCandidate>;
  lookupEventSequence: number;
  /** Digest of the model's search query; useful for audit, never authority. */
  lookupQueryDigest?: string;
};
export type DiscussionTextStreamState = Readonly<{ content: string; pendingPrefix: string; rejectedStructuredOutput: boolean }>;

function behaviorBackedByCandidate(candidate: CapabilityCandidate, behavior: string): boolean {
  const stopWords = new Set(["a", "an", "and", "the", "for", "from", "into", "with", "use", "existing", "capability", "path"]);
  const requested = behavior.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length >= 3 && !stopWords.has(word)) ?? [];
  if (!requested.length) return false;
  const available = [candidate.code, candidate.displayName, candidate.purpose, ...candidate.capabilities, ...candidate.tools.flatMap((tool) => [tool.name, tool.title, tool.description])]
    .join(" ").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return requested.every((word) => available.some((item) => item.startsWith(word) || word.startsWith(item)));
}

export function validateCapabilityProposal(specInput: unknown, evidence: CapabilityTurnEvidence | null, expectedInput?: { messageId: string; requirementDigest: string }): string | null {
  if (!evidence) return "CAPABILITY_LOOKUP_REQUIRED";
  if (!evidence.inputMessageId || !/^sha256:[0-9a-f]{64}$/.test(evidence.requirementDigest)) return "CAPABILITY_LOOKUP_REQUIRED";
  if (!Number.isInteger(evidence.lookupEventSequence) || evidence.lookupEventSequence < 1) return "CAPABILITY_LOOKUP_REQUIRED";
  if (expectedInput && (evidence.inputMessageId !== expectedInput.messageId || evidence.requirementDigest !== expectedInput.requirementDigest)) return "CAPABILITY_LOOKUP_REQUIRED";
  const parsedSpec = generationSpecificationSchema.safeParse(specInput);
  if (!parsedSpec.success) {
    const issues = parsedSpec.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "$"}:${issue.code}`).join(",");
    return `generation_specification_invalid:${issues}`;
  }
  const spec = parsedSpec.data;
  const decisions = spec.capabilityDecisions ?? [];
  if (!decisions.length || decisions.some((decision) => decision.requirementDigest !== evidence.requirementDigest)) return "CAPABILITY_LOOKUP_REQUIRED";
  if (evidence.candidateIds.size && !evidence.inspected.size) return "CAPABILITY_CONTRACT_INSPECTION_REQUIRED";
  for (const decision of decisions) {
    if (decision.decision === "NEW_CAPABILITY_REQUIRED" && (decision.reuse.length || !decision.missingDelta.length)) return "CAPABILITY_DECISION_INVALID";
    if (decision.decision === "FULL_REUSE" && (!decision.reuse.length || !decision.reusableBehavior.length || decision.missingDelta.length)) return "CAPABILITY_DECISION_INVALID";
    if (decision.decision === "PARTIAL_REUSE" && (!decision.reuse.length || !decision.reusableBehavior.length || !decision.missingDelta.length)) return "CAPABILITY_DECISION_INVALID";
    if (decision.decision === "NEW_CAPABILITY_REQUIRED" && evidence.candidateIds.size && evidence.inspected.size < evidence.candidateIds.size) return "CAPABILITY_CONTRACT_INSPECTION_REQUIRED";
    for (const reference of decision.reuse) {
      const candidate = evidence.inspected.get(reference.componentId);
      const tool = candidate?.tools.find((item) => item.contractId === reference.toolContractId);
      if (!candidate || !tool || candidate.revisionId !== reference.revisionId || tool.contractDigest !== reference.contractDigest) return "CAPABILITY_REFERENCE_INVALID";
      if (candidate.runtimeEligibility !== "ELIGIBLE") return decision.decision === "FULL_REUSE" ? "CAPABILITY_FULL_REUSE_INELIGIBLE" : "CAPABILITY_REUSE_INELIGIBLE";
    }
    if (["FULL_REUSE", "PARTIAL_REUSE"].includes(decision.decision)) {
      const reusedCandidates = decision.reuse.map((reference) => evidence.inspected.get(reference.componentId)).filter((candidate): candidate is CapabilityCandidate => Boolean(candidate));
      if (!decision.reusableBehavior.every((behavior) => reusedCandidates.some((candidate) => behaviorBackedByCandidate(candidate, behavior)))) return "CAPABILITY_BEHAVIOR_NOT_BACKED_BY_CONTRACT";
    }
  }
  return null;
}

async function capabilityReferencesStillCurrent(db: SqlExecutor, spec: GenerationSpec): Promise<boolean> {
  for (const decision of spec.capabilityDecisions ?? []) for (const reference of decision.reuse) {
    const current = await readCmlCapabilityContract(db, reference.componentId);
    const tool = current?.tools.find((item) => item.contractId === reference.toolContractId);
    if (!current || current.revisionId !== reference.revisionId || !tool || tool.contractDigest !== reference.contractDigest || current.runtimeEligibility !== "ELIGIBLE") return false;
  }
  return true;
}

const invalidOwnerText = "Odpověď modelu nebyla v požadovaném textovém formátu. Pokračujte prosím upřesněním požadavku.";

export function createDiscussionTextStream(): DiscussionTextStreamState {
  return { content: "", pendingPrefix: "", rejectedStructuredOutput: false };
}

/**
 * Keep normal Responses text genuinely streamed, while holding only the small
 * ambiguous prefix needed to reject a legacy raw-JSON envelope before it can
 * reach the OWNER.  GenerationSpecification is accepted only via the server
 * function tool below; this function deliberately never parses model JSON.
 */
export function appendDiscussionTextDelta(state: DiscussionTextStreamState, delta: string): Readonly<{ state: DiscussionTextStreamState; visibleDelta: string }> {
  if (state.rejectedStructuredOutput || !delta) return { state, visibleDelta: "" };
  const pendingPrefix = `${state.pendingPrefix}${delta}`;
  const trimmed = pendingPrefix.trimStart();
  const lower = trimmed.toLowerCase();
  const ambiguousFence = "```json".startsWith(lower);
  const structured = trimmed.startsWith("{") || trimmed.startsWith("[") || lower.startsWith("```json");
  if (structured) return { state: { content: state.content, pendingPrefix: "", rejectedStructuredOutput: true }, visibleDelta: "" };
  if (!trimmed || ambiguousFence) return { state: { ...state, pendingPrefix }, visibleDelta: "" };
  return { state: { content: `${state.content}${pendingPrefix}`, pendingPrefix: "", rejectedStructuredOutput: false }, visibleDelta: pendingPrefix };
}

export function finishDiscussionTextStream(state: DiscussionTextStreamState): Readonly<{ content: string; visibleDelta: string }> {
  if (state.rejectedStructuredOutput) return { content: invalidOwnerText, visibleDelta: "" };
  return { content: `${state.content}${state.pendingPrefix}`, visibleDelta: state.pendingPrefix };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function eventResponseId(event: ResponsesStreamEvent): string | null {
  const response = recordValue(event.response);
  return typeof response?.id === "string" ? response.id : typeof event.id === "string" && event.type === "response.created" ? event.id : null;
}

function upsertFunctionCall(calls: Map<string, PendingFunctionCall>, input: { callId?: unknown; itemId?: unknown; name?: unknown; arguments?: unknown; append?: string }): string | null {
  const callId = typeof input.callId === "string" && input.callId ? input.callId : null;
  if (!callId) return null;
  const existing = calls.get(callId) ?? { callId, name: "", arguments: "" };
  if (typeof input.itemId === "string" && input.itemId) existing.itemId = input.itemId;
  if (typeof input.name === "string" && input.name) existing.name = input.name;
  if (typeof input.arguments === "string") existing.arguments = input.arguments;
  if (input.append) existing.arguments += input.append;
  calls.set(callId, existing);
  return callId;
}

function functionCallFromItem(item: Record<string, unknown>): PendingFunctionCall | null {
  if (item.type !== "function_call" || typeof item.call_id !== "string") return null;
  return { callId: item.call_id, itemId: typeof item.id === "string" ? item.id : undefined, name: typeof item.name === "string" ? item.name : "", arguments: typeof item.arguments === "string" ? item.arguments : "" };
}

/**
 * Requeue an abandoned discussion turn only after its durable lease expired.
 * A successor created by OWNER steer wins over the abandoned turn; in that
 * case the old turn is terminalized instead of violating the one-pending-turn
 * index.  The old lease token is always cleared, so late provider frames from
 * the dead worker cannot mutate messages, events, specs, or terminal state.
 */
export async function recoverExpiredDiscussionTurns(db: Db): Promise<number> {
  return tx(db, async (client) => {
    const expired = await client.query(
      `select turn.id,turn.job_id,turn.status,job.state job_state
         from generation_discussion_turn turn
         join generation_job job on job.id=turn.job_id
        where turn.status in ('RUNNING','INTERRUPT_REQUESTED')
          and turn.lease_until is not null
          and turn.lease_until<now()
        order by turn.lease_until
        for update of turn skip locked`,
    );
    let recovered = 0;
    for (const row of expired.rows) {
      if (String(row.job_state) !== "DISCUSSING") {
        const message = await client.query(
          `update generation_job_message
              set status='INTERRUPTED',interrupted_at=coalesce(interrupted_at,now())
            where turn_id=$1 and role='ASSISTANT' and status='STREAMING'
          returning id`,
          [row.id]
        );
        await client.query(
          `update generation_discussion_turn
              set status='INTERRUPTED',error_code='discussion_lease_expired_job_terminal',
                  interrupted_at=coalesce(interrupted_at,now()),completed_at=coalesce(completed_at,now()),
                  lease_owner=null,lease_token=null,lease_until=null,heartbeat_at=null
            where id=$1`,
          [row.id]
        );
        if (message.rowCount) await appendDiscussionEvent(client, String(row.job_id), "discussion.message.interrupted", { messageId: String(message.rows[0].id), turnId: String(row.id), recovered: true });
        await appendDiscussionEvent(client, String(row.job_id), "discussion.turn.interrupted", { turnId: String(row.id), recovered: true, jobState: String(row.job_state) });
        recovered += 1;
        continue;
      }
      const successor = await client.query(
        "select id from generation_discussion_turn where job_id=$1 and status='QUEUED' and id<>$2 for update",
        [row.job_id, row.id]
      );
      if (successor.rowCount) {
        const message = await client.query(
          `update generation_job_message
              set status='INTERRUPTED',interrupted_at=coalesce(interrupted_at,now())
            where turn_id=$1 and role='ASSISTANT' and status='STREAMING'
          returning id`,
          [row.id]
        );
        await client.query(
          `update generation_discussion_turn
              set status='INTERRUPTED',error_code='discussion_lease_expired_superseded',
                  interrupted_at=coalesce(interrupted_at,now()),completed_at=coalesce(completed_at,now()),
                  lease_owner=null,lease_token=null,lease_until=null,heartbeat_at=null
            where id=$1`,
          [row.id]
        );
        if (message.rowCount) await appendDiscussionEvent(client, String(row.job_id), "discussion.message.interrupted", { messageId: String(message.rows[0].id), turnId: String(row.id), recovered: true });
        await appendDiscussionEvent(client, String(row.job_id), "discussion.turn.interrupted", { turnId: String(row.id), recovered: true, successorTurnId: String(successor.rows[0].id) });
      } else {
        await client.query(
          `update generation_discussion_turn
              set status='QUEUED',error_code='discussion_lease_expired',
                  lease_owner=null,lease_token=null,lease_until=null,heartbeat_at=null,
                  started_at=coalesce(started_at,now())
            where id=$1`,
          [row.id]
        );
        await appendDiscussionEvent(client, String(row.job_id), "discussion.turn.requeued", { turnId: String(row.id), recovered: true });
      }
      recovered += 1;
    }
    return recovered;
  });
}

export async function processNextDiscussionTurn(db: Db, config: AppServerConfig, workerId: string, apiKey: string): Promise<boolean> {
  await recoverExpiredDiscussionTurns(db);
  const claimed = await tx(db, async (client) => {
    const result = await client.query(`select turn.id,turn.job_id,turn.input_message_id
      from generation_discussion_turn turn join generation_job job on job.id=turn.job_id
     where turn.status='QUEUED' and job.state='DISCUSSING' and (turn.lease_until is null or turn.lease_until<now())
       and not exists (
         select 1 from generation_discussion_turn active
          where active.job_id=turn.job_id and active.id<>turn.id
            and active.status in ('RUNNING','INTERRUPT_REQUESTED')
       )
     order by turn.created_at for update skip locked limit 1`);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const leaseToken = randomUUID();
    await client.query("update generation_discussion_turn set status='RUNNING',lease_owner=$2,lease_token=$3,lease_until=now()+interval '180 seconds',started_at=now(),heartbeat_at=now() where id=$1", [row.id, workerId, leaseToken]);
    await appendDiscussionEvent(client, String(row.job_id), "discussion.turn.started", { turnId: String(row.id) });
    return { turnId: String(row.id), jobId: String(row.job_id), inputMessageId: String(row.input_message_id), leaseToken };
  });
  if (!claimed) return false;
  let assistantId: string | null = null; let textStream = createDiscussionTextStream(); let accumulated = ""; let interruptedBySteer = false; let leaseLost = false;
  const lease: DiscussionLease = { owner: workerId, token: claimed.leaseToken };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const heartbeat = setInterval(() => {
    void db.query(
      "update generation_discussion_turn set heartbeat_at=now(),lease_until=now()+interval '180 seconds' where id=$1 and status='RUNNING' and lease_owner=$2 and lease_token=$3 and lease_until>now() returning id",
      [claimed.turnId, workerId, claimed.leaseToken]
    ).then(async (renewed) => {
      if (!renewed.rowCount) { leaseLost = true; controller.abort(); return; }
      const current = await db.query("select status from generation_discussion_turn where id=$1", [claimed.turnId]);
      if (String(current.rows[0]?.status) === "INTERRUPT_REQUESTED") { interruptedBySteer = true; controller.abort(); }
    }).catch(() => undefined);
  }, 30_000);
  try {
    const inputMessage = await db.query("select content from generation_job_message where id=$1 and job_id=$2 and role='OWNER'", [claimed.inputMessageId, claimed.jobId]);
    if (!inputMessage.rowCount) throw new Error("discussion_owner_input_missing");
    const ownerRequirementDigest = digest({ requirement: String(inputMessage.rows[0].content).trim() });
    const assistant = await createLeasedAssistantMessage(db, claimed.jobId, claimed.turnId, lease);
    assistantId = assistant.id;
    await markLeasedAssistantStreaming(db, claimed.turnId, assistantId, config.GENERATION_OPENAI_MODEL, lease);
    const history = (await getDiscussionMessages(db, claimed.jobId)).filter((message) => message.id !== assistantId).slice(-40).map((message) => ({ role: message.role === "OWNER" ? "user" : "assistant", content: message.content }));
    let inputPayload: unknown = history;
    let previousResponseId: string | null = null;
    let providerResponseId: string | null = null;
    let completedResponse = false;
    let capabilityEvidence: CapabilityTurnEvidence | null = null;
    let unresolvedProposalError: string | null = null;
    for (let modelTurn = 0; modelTurn < 8 && !completedResponse; modelTurn += 1) {
      const calls = new Map<string, PendingFunctionCall>();
      const itemToCall = new Map<string, string>();
      const requestBody: Record<string, unknown> = {
        model: config.GENERATION_OPENAI_MODEL,
        store: true,
        instructions: discussionInstructions,
        input: inputPayload,
        tools: [{ type: "web_search" }, lookupCmlCapabilitiesTool, readCmlCapabilityContractTool, proposeGenerationSpecificationTool]
      };
      if (previousResponseId) requestBody.previous_response_id = previousResponseId;
      for await (const frame of streamResponse(apiKey, requestBody, controller.signal)) {
        await assertDiscussionLease(db, claimed.turnId, lease);
        const interrupted = await db.query("select turn.status,job.state job_state from generation_discussion_turn turn join generation_job job on job.id=turn.job_id where turn.id=$1", [claimed.turnId]);
        if (String(interrupted.rows[0]?.status) === "INTERRUPT_REQUESTED" || String(interrupted.rows[0]?.job_state) === "CANCELLED") { interruptedBySteer = true; controller.abort(); throw Object.assign(new Error("discussion_interrupted"), { interrupted: true }); }
        providerResponseId = eventResponseId(frame) ?? providerResponseId;
        if (providerResponseId) await persistLeasedProviderResponse(db, claimed.turnId, providerResponseId, lease);
        if (frame.type === "response.output_text.delta" && typeof frame.delta === "string") {
          const nextText = appendDiscussionTextDelta(textStream, frame.delta);
          textStream = nextText.state;
          if (nextText.visibleDelta) {
            accumulated = textStream.content;
            await persistLeasedDelta(db, claimed.jobId, claimed.turnId, assistantId, accumulated, nextText.visibleDelta, lease);
          }
        } else if (frame.type === "response.output_item.added" || frame.type === "response.output_item.done") {
          const item = recordValue(frame.item);
          const call = item ? functionCallFromItem(item) : null;
          if (call) { calls.set(call.callId, call); if (call.itemId) itemToCall.set(call.itemId, call.callId); }
        } else if (frame.type === "response.function_call_arguments.delta") {
          let callId = typeof frame.call_id === "string" ? frame.call_id : undefined;
          if (!callId && typeof frame.item_id === "string") callId = itemToCall.get(frame.item_id);
          upsertFunctionCall(calls, { callId, itemId: frame.item_id, append: typeof frame.delta === "string" ? frame.delta : "" });
        } else if (frame.type === "response.function_call_arguments.done") {
          let callId = typeof frame.call_id === "string" ? frame.call_id : undefined;
          if (!callId && typeof frame.item_id === "string") callId = itemToCall.get(frame.item_id);
          upsertFunctionCall(calls, { callId, itemId: frame.item_id, name: frame.name, arguments: frame.arguments });
        }
      }
      if (!calls.size) {
        if (unresolvedProposalError) {
          if (!providerResponseId) throw new Error("openai_responses_missing_id");
          previousResponseId = providerResponseId;
          inputPayload = `The specification proposal is still not accepted. Correct it and call propose_generation_specification again in this same turn. Safe validation error: ${unresolvedProposalError}`;
          continue;
        }
        completedResponse = true;
        break;
      }
      const toolOutputs: Array<Record<string, unknown>> = [];
      for (const call of calls.values()) {
        if (call.name === "lookup_cml_capabilities") {
          await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.started", { turnId: claimed.turnId, toolName: call.name });
          try {
            const args = JSON.parse(call.arguments) as { requirement?: unknown; keywords?: unknown };
            if (typeof args.requirement !== "string" || !args.requirement.trim() || !Array.isArray(args.keywords) || !args.keywords.every((value) => typeof value === "string")) throw new Error("capability_lookup_invalid_arguments");
            const candidates = await lookupCmlCapabilities(db, { requirement: args.requirement, keywords: args.keywords });
            const lookupQueryDigest = digest({ requirement: args.requirement.trim(), keywords: args.keywords.map((value) => value.trim()).filter(Boolean).sort() });
            const sequence = await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.completed", { turnId: claimed.turnId, inputMessageId: claimed.inputMessageId, toolName: call.name, requirementDigest: ownerRequirementDigest, lookupQueryDigest, candidateIds: candidates.map((candidate) => candidate.componentId), candidateCount: candidates.length });
            capabilityEvidence = { requirementDigest: ownerRequirementDigest, inputMessageId: claimed.inputMessageId, candidateIds: new Set(candidates.map((candidate) => candidate.componentId)), inspected: new Map(), lookupEventSequence: sequence, lookupQueryDigest };
            toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: true, requirementDigest: ownerRequirementDigest, candidates }) });
          } catch (error) { const errorCode = error instanceof Error ? error.message.slice(0, 300) : "capability_lookup_failed"; toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: false, error: errorCode }) }); await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.failed", { turnId: claimed.turnId, toolName: call.name, errorCode }); }
          continue;
        }
        if (call.name === "read_cml_capability_contract") {
          await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.started", { turnId: claimed.turnId, toolName: call.name });
          try {
            const args = JSON.parse(call.arguments) as { componentId?: unknown };
            if (!capabilityEvidence) throw new Error("CAPABILITY_LOOKUP_REQUIRED");
            if (typeof args.componentId !== "string" || !capabilityEvidence.candidateIds.has(args.componentId)) throw new Error("CAPABILITY_CONTRACT_NOT_A_LOOKUP_CANDIDATE");
            const contract = await readCmlCapabilityContract(db, args.componentId);
            if (!contract) throw new Error("CAPABILITY_CONTRACT_NOT_FOUND");
            capabilityEvidence.inspected.set(contract.componentId, contract);
            await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.completed", { turnId: claimed.turnId, inputMessageId: claimed.inputMessageId, toolName: call.name, componentId: contract.componentId, revisionId: contract.revisionId, manifestDigest: contract.manifestDigest, contractIds: contract.tools.map((tool) => tool.contractId), contractDigests: contract.tools.map((tool) => tool.contractDigest), runtimeEligibility: contract.runtimeEligibility });
            toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: true, contract }) });
          } catch (error) { const errorCode = error instanceof Error ? error.message.slice(0, 300) : "capability_contract_read_failed"; toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: false, error: errorCode }) }); await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.failed", { turnId: claimed.turnId, toolName: call.name, errorCode }); }
          continue;
        }
        if (call.name !== "propose_generation_specification") {
          toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: false, error: "unsupported_discussion_tool" }) });
          continue;
        }
        await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.started", { turnId: claimed.turnId, toolName: call.name });
        try {
          const parsed = JSON.parse(call.arguments) as unknown;
          const capabilityError = validateCapabilityProposal(parsed, capabilityEvidence, { messageId: claimed.inputMessageId, requirementDigest: ownerRequirementDigest });
          if (capabilityError) throw new Error(capabilityError);
          await assertDiscussionLease(db, claimed.turnId, lease);
          const revision = await createSpecRevision(db, claimed.jobId, parsed, claimed.turnId, lease);
          unresolvedProposalError = null;
          toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: true, revisionId: revision.id, revision: revision.revision, digest: revision.digest }) });
          await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.completed", { turnId: claimed.turnId, toolName: call.name, revisionId: revision.id, revision: revision.revision, digest: revision.digest, revisionCreated: revision.created });
        } catch (error) {
          const errorCode = error instanceof Error ? error.message.slice(0, 300) : "generation_specification_invalid";
          unresolvedProposalError = errorCode;
          toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ ok: false, error: errorCode }) });
          await appendLeasedDiscussionEvent(db, claimed.jobId, claimed.turnId, lease, "discussion.tool.failed", { turnId: claimed.turnId, toolName: call.name, errorCode });
        }
      }
      if (!providerResponseId) throw new Error("openai_responses_missing_id");
      previousResponseId = providerResponseId;
      inputPayload = toolOutputs;
    }
    if (!completedResponse) throw new Error("discussion_model_turn_limit");
    const terminal = await db.query("select job.state job_state,turn.status turn_status from generation_job job join generation_discussion_turn turn on turn.job_id=job.id where turn.id=$1", [claimed.turnId]);
    if (String(terminal.rows[0]?.job_state) !== "DISCUSSING" || String(terminal.rows[0]?.turn_status) !== "RUNNING") throw Object.assign(new Error("discussion_interrupted"), { interrupted: true });
    const finishedText = finishDiscussionTextStream(textStream);
    accumulated = finishedText.content;
    if (finishedText.visibleDelta) await persistLeasedDelta(db, claimed.jobId, claimed.turnId, assistantId, accumulated, finishedText.visibleDelta, lease);
    const finalized = await finalizeLeasedDiscussionTurn(db, { jobId: claimed.jobId, turnId: claimed.turnId, messageId: assistantId, lease, status: "COMPLETED", content: accumulated, providerResponseId });
    if (!finalized) throw leaseLostError();
  } catch (error) {
    const interrupted = interruptedBySteer || Boolean((error as { interrupted?: boolean }).interrupted);
    if (assistantId && !leaseLost) {
      await finalizeLeasedDiscussionTurn(db, { jobId: claimed.jobId, turnId: claimed.turnId, messageId: assistantId, lease, status: interrupted ? "INTERRUPTED" : "FAILED", content: accumulated, errorCode: interrupted ? null : error instanceof Error ? error.message.slice(0, 300) : "discussion_failed" }).catch(() => false);
    }
  } finally { clearInterval(heartbeat); clearTimeout(timeout); }
  return true;
}

export async function approveSpec(db: Db, jobId: string, ownerId: string, revisionId: string, expectedDigest: string) {
  const result = await tx(db, async (client) => {
    const row = await client.query("select state,current_spec_revision_id,approved_spec_revision_id from generation_job where id=$1 and owner_admin_id=$2 for update", [jobId, ownerId]);
    if (!row.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    if (row.rows[0].approved_spec_revision_id) {
      if (String(row.rows[0].approved_spec_revision_id) === revisionId) return { revisionId, digest: expectedDigest, idempotent: true };
      throw Object.assign(new Error("GENERATION_SPEC_STALE"), { statusCode: 409 });
    }
    const spec = await client.query("select id,digest,spec,canonical_json from generation_spec_revision where id=$1 and job_id=$2", [revisionId, jobId]);
    if (!spec.rowCount || String(row.rows[0].current_spec_revision_id) !== revisionId) throw Object.assign(new Error("GENERATION_SPEC_STALE"), { statusCode: 409 });
    const validated = generationSpecificationSchema.parse(spec.rows[0].spec);
    if (digest(validated) !== expectedDigest || String(spec.rows[0].digest) !== expectedDigest || canonicalJson(validated) !== String(spec.rows[0].canonical_json)) throw Object.assign(new Error("GENERATION_SPEC_DIGEST_INVALID"), { statusCode: 409 });
    if (!(await capabilityReferencesStillCurrent(client, validated))) {
      await client.query("update generation_job set blocker_code='CAPABILITY_CONTRACT_STALE',updated_at=now() where id=$1 and state='DISCUSSING'", [jobId]);
      throw Object.assign(new Error("CAPABILITY_CONTRACT_STALE"), { statusCode: 409 });
    }
    if (validated.openQuestions.length) throw Object.assign(new Error("GENERATION_SPEC_OPEN_QUESTIONS"), { statusCode: 409 });
    const activeTurn = await client.query("select 1 from generation_discussion_turn where job_id=$1 and status in ('QUEUED','RUNNING','INTERRUPT_REQUESTED') limit 1", [jobId]);
    if (activeTurn.rowCount) throw Object.assign(new Error("GENERATION_TURN_ACTIVE"), { statusCode: 409 });
    const unrepresentedOwnerInput = await client.query(
      `select 1
         from generation_job_message message
         left join generation_discussion_turn message_turn on message_turn.input_message_id=message.id
         join generation_discussion_turn source_turn on source_turn.id=$2
        where message.job_id=$1 and message.role='OWNER' and message.sequence > (
          select source_message.sequence from generation_job_message source_message where source_message.id=source_turn.input_message_id
        ) and coalesce(message_turn.status,'QUEUED') <> 'COMPLETED'
        limit 1`,
      [jobId, spec.rows[0].source_turn_id]
    );
    if (unrepresentedOwnerInput.rowCount) throw Object.assign(new Error("GENERATION_OWNER_INPUT_UNREPRESENTED"), { statusCode: 409 });
    if (String(row.rows[0].state) !== "DISCUSSING") throw Object.assign(new Error("generation_spec_not_approvable"), { statusCode: 409 });
    await client.query("update generation_job set approved_spec_revision_id=$2,approved_spec_job_id=$1,approved_spec_digest=$3,authority_kind='OWNER_APPROVED',authority_source_job_id=$1,authority_source_spec_revision_id=$2,authority_spec_digest=$3,discussion_closed_at=now(),state='ANALYZING',updated_at=now() where id=$1 and state='DISCUSSING'", [jobId, revisionId, expectedDigest]);
    return { revisionId, digest: expectedDigest, idempotent: false };
  });
  if (!result.idempotent) {
    await appendDiscussionEvent(db, jobId, "spec.approved", { revisionId, digest: expectedDigest });
    await appendDiscussionEvent(db, jobId, "generation.state.changed", { state: "ANALYZING", approvedSpec: result });
  }
  return result;
}
