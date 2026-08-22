import { createHash } from "node:crypto";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import type pg from "pg";

type SqlExecutor = Db | pg.PoolClient;

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
export const generationSpecificationSchema = z.object({
  objective: z.string().trim().min(1).max(20_000), resultSummary: z.string().trim().min(1).max(20_000), behavioralRequirements: textList,
  inputsAndOutputs: textList, externalSystems: textList, businessRules: textList, explicitOwnerDecisions: textList, constraints: textList,
  acceptanceCriteria: textList, verifiedFacts: textList, openQuestions: textList, browserAutomations: z.array(browserAutomationRequirementSchema).max(50)
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

export async function createSpecRevision(db: SqlExecutor, jobId: string, input: unknown, turnId: string): Promise<GenerationSpecRevision> {
  if (typeof (db as Db).connect === "function") return tx<GenerationSpecRevision>(db as Db, (client) => createSpecRevisionLocked(client, jobId, input, turnId));
  return createSpecRevisionLocked(db, jobId, input, turnId);
}

/** The parent job row is the per-job monotonic revision allocator. */
async function createSpecRevisionLocked(db: SqlExecutor, jobId: string, input: unknown, turnId: string): Promise<GenerationSpecRevision> {
  const spec = generationSpecificationSchema.parse(input);
  const canonical = canonicalJson(spec); const specDigest = digest(spec); const renderedMarkdown = renderSpecificationMarkdown(spec);
  const job = await db.query("select id,state from generation_job where id=$1 for update", [jobId]);
  if (!job.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  if (String(job.rows[0].state) !== "DISCUSSING") throw Object.assign(new Error("generation_discussion_closed"), { statusCode: 409 });
  const current = await getCurrentSpec(db, jobId);
  if (current?.digest === specDigest) return { ...current, created: false };
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

const discussionInstructions = `Return only JSON with two properties: assistantMessage (OWNER-readable Czech text) and specification. specification must be a complete GenerationSpecification object with objective, resultSummary, behavioralRequirements, inputsAndOutputs, externalSystems, businessRules, explicitOwnerDecisions, constraints, acceptanceCriteria, verifiedFacts, openQuestions and browserAutomations. Do not expose chain of thought.`;

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

function parseSseFrames(buffer: string): { frames: Record<string, unknown>[]; rest: string } {
  const parts = buffer.split("\n\n"); const rest = parts.pop() ?? "";
  return { rest, frames: parts.flatMap((part) => {
    const data = part.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
    if (!data || data === "[DONE]") return [];
    try { return [JSON.parse(data) as Record<string, unknown>]; } catch { return []; }
  }) };
}

export async function processNextDiscussionTurn(db: Db, config: AppServerConfig, workerId: string, apiKey: string): Promise<boolean> {
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
    await client.query("update generation_discussion_turn set status='RUNNING',lease_owner=$2,lease_until=now()+interval '180 seconds',started_at=now(),heartbeat_at=now() where id=$1", [row.id, workerId]);
    await appendDiscussionEvent(client, String(row.job_id), "discussion.turn.started", { turnId: String(row.id) });
    return { turnId: String(row.id), jobId: String(row.job_id), inputMessageId: String(row.input_message_id) };
  });
  if (!claimed) return false;
  let assistantId: string | null = null; let accumulated = ""; let interruptedBySteer = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const heartbeat = setInterval(() => {
    void db.query(
      "update generation_discussion_turn set heartbeat_at=now(),lease_until=now()+interval '180 seconds' where id=$1 and status='RUNNING' and lease_owner=$2 returning id",
      [claimed.turnId, workerId]
    ).then(async () => {
      const current = await db.query("select status from generation_discussion_turn where id=$1", [claimed.turnId]);
      if (String(current.rows[0]?.status) === "INTERRUPT_REQUESTED") { interruptedBySteer = true; controller.abort(); }
    }).catch(() => undefined);
  }, 30_000);
  try {
    const assistant = await createDiscussionMessage(db, claimed.jobId, "ASSISTANT", "", claimed.turnId);
    assistantId = assistant.id;
    await db.query("update generation_job_message set status='STREAMING',model=$2 where id=$1", [assistantId, config.GENERATION_OPENAI_MODEL]);
    const history = (await getDiscussionMessages(db, claimed.jobId)).filter((message) => message.id !== assistantId).slice(-40).map((message) => ({ role: message.role === "OWNER" ? "user" : "assistant", content: message.content }));
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.GENERATION_OPENAI_MODEL, stream: true, store: false, instructions: discussionInstructions, input: history }), signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`openai_responses_${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ""; let providerResponseId: string | null = null;
    while (true) {
      const interrupted = await db.query("select turn.status,job.state job_state from generation_discussion_turn turn join generation_job job on job.id=turn.job_id where turn.id=$1", [claimed.turnId]);
      if (String(interrupted.rows[0]?.status) === "INTERRUPT_REQUESTED" || String(interrupted.rows[0]?.job_state) === "CANCELLED") { interruptedBySteer = true; controller.abort(); throw Object.assign(new Error("discussion_interrupted"), { interrupted: true }); }
      const next = await reader.read(); if (next.done) break;
      const parsed = parseSseFrames(pending + decoder.decode(next.value, { stream: true })); pending = parsed.rest;
      for (const frame of parsed.frames) {
        if (typeof frame.response === "object" && frame.response && typeof (frame.response as { id?: unknown }).id === "string") providerResponseId = String((frame.response as { id: string }).id);
        if (frame.type === "response.output_text.delta" && typeof frame.delta === "string") {
          accumulated += frame.delta;
          await db.query("update generation_job_message set content=$2 where id=$1 and status='STREAMING'", [assistantId, accumulated]);
          await appendDiscussionEvent(db, claimed.jobId, "discussion.message.delta", { messageId: assistantId, delta: frame.delta });
        }
      }
    }
    const terminal = await db.query("select job.state job_state,turn.status turn_status from generation_job job join generation_discussion_turn turn on turn.job_id=job.id where turn.id=$1", [claimed.turnId]);
    if (String(terminal.rows[0]?.job_state) !== "DISCUSSING" || String(terminal.rows[0]?.turn_status) !== "RUNNING") throw Object.assign(new Error("discussion_interrupted"), { interrupted: true });
    const parsed = JSON.parse(accumulated) as { assistantMessage?: unknown; specification?: unknown };
    if (typeof parsed.assistantMessage !== "string") throw new Error("discussion_structured_response_missing_message");
    const revision = await createSpecRevision(db, claimed.jobId, parsed.specification, claimed.turnId);
    await db.query("update generation_job_message set content=$2,status='COMPLETED',provider_response_id=$3,completed_at=now() where id=$1 and status='STREAMING'", [assistantId, parsed.assistantMessage, providerResponseId]);
    await db.query("update generation_discussion_turn set status='COMPLETED',provider_response_id=$2,completed_at=now(),lease_owner=null,lease_until=null where id=$1", [claimed.turnId, providerResponseId]);
    await appendDiscussionEvent(db, claimed.jobId, "discussion.message.completed", { messageId: assistantId });
    await appendDiscussionEvent(db, claimed.jobId, "discussion.turn.completed", { turnId: claimed.turnId, revisionId: revision.id, revisionCreated: revision.created });
  } catch (error) {
    const interrupted = interruptedBySteer || Boolean((error as { interrupted?: boolean }).interrupted);
    if (assistantId) await db.query("update generation_job_message set status=$2,content=$3,interrupted_at=case when $2='INTERRUPTED' then now() else null end,completed_at=case when $2='FAILED' then now() else null end where id=$1", [assistantId, interrupted ? "INTERRUPTED" : "FAILED", accumulated]);
    await db.query("update generation_discussion_turn set status=$2,interrupted_at=case when $2='INTERRUPTED' then now() else null end,completed_at=now(),error_code=$3,lease_owner=null,lease_until=null where id=$1", [claimed.turnId, interrupted ? "INTERRUPTED" : "FAILED", interrupted ? null : error instanceof Error ? error.message.slice(0, 300) : "discussion_failed"]);
    await appendDiscussionEvent(db, claimed.jobId, interrupted ? "discussion.turn.interrupted" : "discussion.turn.failed", { turnId: claimed.turnId, messageId: assistantId, errorCode: interrupted ? undefined : error instanceof Error ? error.message : "discussion_failed" });
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
    await client.query("update generation_job set approved_spec_revision_id=$2,approved_spec_job_id=$1,approved_spec_digest=$3,discussion_closed_at=now(),state='ANALYZING',updated_at=now() where id=$1 and state='DISCUSSING'", [jobId, revisionId, expectedDigest]);
    return { revisionId, digest: expectedDigest, idempotent: false };
  });
  if (!result.idempotent) {
    await appendDiscussionEvent(db, jobId, "spec.approved", { revisionId, digest: expectedDigest });
    await appendDiscussionEvent(db, jobId, "generation.state.changed", { state: "ANALYZING", approvedSpec: result });
  }
  return result;
}
