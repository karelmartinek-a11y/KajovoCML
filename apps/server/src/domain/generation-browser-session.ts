import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GenerationRouteConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { runBrowserAutomation, validateManifest } from "../generation/browser-automation-runtime.mjs";
import { appendDiscussionEvent } from "./generation-discussion.js";
import { appendAudit } from "./audit.js";
import { createSecret, grantSecret, listSecrets, platformWorkerSecretPrincipal, rotateSecret } from "./secret-manager.js";

type BrowserSessionConfig = Pick<GenerationRouteConfig, "GENERATION_ROOT" | "CHROMIUM_BINARY">;
type JsonRecord = Record<string, unknown>;
type BrowserSessionState = { url: string; title: string; viewport: { width: number; height: number } | null };
type BrowserScreenshot = { body: Buffer; url: string; title: string; width: number | null; height: number | null };
type BrowserSession = { open(value: string): Promise<BrowserSessionState>; state(): Promise<BrowserSessionState>; screenshot(): Promise<BrowserScreenshot>; close(): Promise<void> };
type BrowserSessionModule = { PlaywrightBrowserSession: new (input: { chromiumBinary?: string; workspace: string; sessionId: string; allowLocal?: boolean }) => BrowserSession };

const ALLOWED_SCOPE_ACTIONS = new Set(["READ_ONLY", "LOCAL_INPUT", "AUTHENTICATION", "MUTATION_IDEMPOTENT", "MUTATION_NON_IDEMPOTENT", "DESTRUCTIVE"]);
const READ_ONLY_ACTIONS = new Set(["NAVIGATE", "WAIT", "WAIT_FOR", "ASSERT", "ASSERT_TEXT", "EXTRACT", "EXTRACT_TEXT", "BRANCH", "REPEAT_BOUNDED"]);
const MUTATING_MANIFEST_ACTIONS = new Set(["CLICK", "FILL", "FILL_SECRET", "SELECT", "CHECK", "UNCHECK", "PRESS", "UPLOAD", "DOWNLOAD"]);
const liveBrowserSessions = new Map<string, BrowserSession>();

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function fail(code: string, statusCode = 409): never { throw Object.assign(new Error(code), { statusCode }); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function digest(value: unknown): string {
  const serialized = JSON.stringify(canonical(value));
  return `sha256:${createHash("sha256").update(serialized ?? "null").digest("hex")}`;
}

function safeOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { fail("browser_scope_origin_invalid", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail("browser_scope_origin_invalid", 400);
  return url.origin;
}

function safeUrlMetadata(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`.slice(0, 2_000);
}

function relativeArtifact(root: string, jobId: string, name: string): { relative: string; absolute: string } {
  const relative = path.join("generation-browser", jobId, name);
  const absolute = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (!absolute.startsWith(`${resolvedRoot}${path.sep}`)) fail("browser_preview_path_invalid", 500);
  return { relative, absolute };
}

async function ownedJob(db: Db, jobId: string, ownerId: string, forUpdate = false): Promise<Record<string, unknown>> {
  const result = await db.query(`select id,owner_admin_id,state from generation_job where id=$1 ${forUpdate ? "for update" : ""}`, [jobId]);
  if (!result.rowCount || String(result.rows[0].owner_admin_id) !== ownerId) fail("not_found", 404);
  return result.rows[0] as Record<string, unknown>;
}

async function ensureSession(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string): Promise<{ id: string; status: string }> {
  await ownedJob(db, jobId, ownerId);
  await mkdir(path.join(config.GENERATION_ROOT, "generation-browser", jobId), { recursive: true, mode: 0o750 });
  const existing = await db.query("select id,status,expires_at from generation_browser_session where job_id=$1 and owner_admin_id=$2", [jobId, ownerId]);
  if (existing.rowCount && new Date(String(existing.rows[0].expires_at)).getTime() > Date.now() && String(existing.rows[0].status) === "ACTIVE") {
    return { id: String(existing.rows[0].id), status: String(existing.rows[0].status) };
  }
  if (existing.rowCount) {
    const oldSession = liveBrowserSessions.get(String(existing.rows[0].id));
    if (oldSession) { await oldSession.close().catch(() => undefined); liveBrowserSessions.delete(String(existing.rows[0].id)); }
    await db.query("update generation_browser_session set status='ACTIVE',expires_at=now()+interval '30 minutes',updated_at=now() where id=$1", [existing.rows[0].id]);
    return { id: String(existing.rows[0].id), status: "ACTIVE" };
  }
  const inserted = await db.query(
    `insert into generation_browser_session(job_id,owner_admin_id,status)
     values ($1,$2,'ACTIVE') returning id,status`, [jobId, ownerId]
  );
  return { id: String(inserted.rows[0].id), status: String(inserted.rows[0].status) };
}

export type PreviewResponse = {
  status: "NO_PREVIEW" | "NORMAL" | "SENSITIVE";
  sessionId?: string;
  frameId?: string;
  revision?: number;
  url?: string;
  title?: string;
  width?: number | null;
  height?: number | null;
  contentType?: string;
  body?: Buffer;
};

export async function getGenerationBrowserPreview(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string): Promise<PreviewResponse> {
  await ownedJob(db, jobId, ownerId);
  const result = await db.query(
    `select f.id,f.revision,f.mode,f.storage_key,f.content_type,f.url,f.title,f.width,f.height,s.id session_id
       from generation_browser_preview_frame f
       join generation_browser_session s on s.id=f.session_id
      where f.job_id=$1 and s.owner_admin_id=$2
      order by f.revision desc limit 1`, [jobId, ownerId]
  );
  if (!result.rowCount) return { status: "NO_PREVIEW" };
  const row = result.rows[0];
  const metadata = { status: String(row.mode) as "NORMAL" | "SENSITIVE", sessionId: String(row.session_id), frameId: String(row.id), revision: Number(row.revision), url: row.url ? String(row.url) : undefined, title: row.title ? String(row.title) : undefined, width: row.width === null ? null : Number(row.width), height: row.height === null ? null : Number(row.height), contentType: row.content_type ? String(row.content_type) : undefined };
  if (metadata.status === "SENSITIVE") return metadata;
  const key = String(row.storage_key);
  const target = path.resolve(config.GENERATION_ROOT, key);
  const root = path.resolve(config.GENERATION_ROOT);
  if (!target.startsWith(`${root}${path.sep}`)) fail("browser_preview_path_invalid", 500);
  try { return { ...metadata, body: await readFile(target) }; }
  catch { fail("browser_preview_unavailable", 409); }
}

export async function openGenerationBrowserPreview(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string, input: { url: string; sensitive?: boolean }): Promise<PreviewResponse> {
  const session = await ensureSession(db, config, jobId, ownerId);
  const url = new URL(input.url);
  if (url.protocol !== "https:") fail("browser_https_required", 400);
  const sessionModule = await import("../generation/playwright-session.mjs") as unknown as BrowserSessionModule;
  const browser = liveBrowserSessions.get(session.id) ?? new sessionModule.PlaywrightBrowserSession({ chromiumBinary: config.CHROMIUM_BINARY, workspace: path.join(config.GENERATION_ROOT, "generation-browser", jobId), sessionId: session.id, allowLocal: false });
  liveBrowserSessions.set(session.id, browser);
  let artifactAbsolute: string | null = null;
  try {
    await browser.open(url.toString());
    const state = await browser.state();
    const revisionResult: { id: string; revision: number; mode: "NORMAL" | "SENSITIVE"; contentType: string } = await tx(db, async (client) => {
      const current = await client.query("select frame_revision from generation_browser_session where id=$1 and job_id=$2 and owner_admin_id=$3 for update", [session.id, jobId, ownerId]);
      if (!current.rowCount) fail("not_found", 404);
      const revision = Number(current.rows[0].frame_revision) + 1;
      const mode: "NORMAL" | "SENSITIVE" = input.sensitive ? "SENSITIVE" : "NORMAL";
      let storageKey: string | null = null;
      if (mode === "NORMAL") {
        const artifact = relativeArtifact(config.GENERATION_ROOT, jobId, `preview-${revision}-${randomUUID()}.png`);
        artifactAbsolute = artifact.absolute;
        const shot = await browser.screenshot();
        await writeFile(artifact.absolute, shot.body, { mode: 0o600 });
        storageKey = artifact.relative;
      }
      const frame = await client.query(
        `insert into generation_browser_preview_frame(session_id,job_id,revision,mode,storage_key,content_type,url,title,width,height)
         values ($1,$2,$3,$4,$5,'image/png',$6,$7,$8,$9) returning id,revision,mode,content_type`,
        [session.id, jobId, revision, mode, storageKey, safeUrlMetadata(state.url), String(state.title ?? "").slice(0, 500), Number(state.viewport?.width ?? 0) || null, Number(state.viewport?.height ?? 0) || null]
      );
      await client.query("update generation_browser_session set frame_revision=$2,current_url=$3,current_title=$4,sensitive=$5,updated_at=now(),expires_at=now()+interval '30 minutes' where id=$1", [session.id, revision, safeUrlMetadata(state.url), String(state.title ?? "").slice(0, 500), mode === "SENSITIVE"]);
      await appendDiscussionEvent(client, jobId, mode === "SENSITIVE" ? "browser.preview.sensitive" : "browser.preview.updated", { sessionId: session.id, revision, mode, frameId: String(frame.rows[0].id), url: safeUrlMetadata(state.url) });
      return { id: String(frame.rows[0].id), revision, mode, contentType: "image/png" };
    });
    return { status: revisionResult.mode, sessionId: session.id, frameId: revisionResult.id, revision: revisionResult.revision, url: safeUrlMetadata(state.url), title: String(state.title ?? "").slice(0, 500), contentType: revisionResult.contentType };
  } catch (error) {
    if (artifactAbsolute) await rm(artifactAbsolute, { force: true }).catch(() => undefined);
    await db.query("update generation_browser_session set status='FAILED',updated_at=now() where id=$1", [session.id]).catch(() => undefined);
    await browser.close().catch(() => undefined);
    liveBrowserSessions.delete(session.id);
    throw error;
  }
}

export async function createGenerationOperationScope(db: Db, jobId: string, ownerId: string, input: { sourceMessageId: string; purpose: string; targetAccountLabel?: string; allowedOrigins: string[]; allowedActionClasses: string[]; browserSessionId?: string | null; expiresAt?: string | null }, correlationId: string): Promise<JsonRecord> {
  const scope = await tx(db, async (client) => {
    const job = await client.query("select id from generation_job where id=$1 and owner_admin_id=$2 for update", [jobId, ownerId]);
    if (!job.rowCount) fail("not_found", 404);
    const message = await client.query("select id,content from generation_job_message where id=$1 and job_id=$2 and role='OWNER'", [input.sourceMessageId, jobId]);
    if (!message.rowCount) fail("browser_scope_owner_message_required", 400);
    const origins = Array.from(new Set(input.allowedOrigins.map(safeOrigin)));
    const actions = Array.from(new Set(input.allowedActionClasses.map((value) => value.trim().toUpperCase())));
    if (!origins.length || !actions.length || actions.some((action) => !ALLOWED_SCOPE_ACTIONS.has(action))) fail("browser_scope_invalid", 400);
    const instruction = String(message.rows[0].content).toLowerCase();
    if (!origins.every((origin) => instruction.includes(new URL(origin).hostname.toLowerCase()))) fail("browser_scope_exceeds_owner_instruction", 409);
    const scopeDigest = digest({ jobId, sourceMessageId: input.sourceMessageId, purpose: input.purpose.trim(), targetAccountLabel: input.targetAccountLabel?.trim() ?? null, origins: origins.sort(), actions: actions.sort() });
    const existing = await client.query("select id from generation_external_operation_scope where job_id=$1 and scope_digest=$2", [jobId, scopeDigest]);
    if (existing.rowCount) return { id: String(existing.rows[0].id), scopeDigest, idempotent: true };
    const inserted = await client.query(
      `insert into generation_external_operation_scope(id,job_id,owner_instruction_message_id,purpose,allowed_origins,allowed_operations,status,expires_at,browser_session_id,target_account_label,scope_digest)
       values ($1,$2,$3,$4,$5,$6,'ACTIVE',coalesce($7::timestamptz,now()+interval '30 minutes'),$8,$9,$10)
       returning id,expires_at`, [randomUUID(), jobId, input.sourceMessageId, input.purpose.trim(), origins, actions, input.expiresAt ?? null, input.browserSessionId ?? null, input.targetAccountLabel?.trim() || null, scopeDigest]
    );
    await appendDiscussionEvent(client, jobId, "browser.operation_scope.established", { scopeId: String(inserted.rows[0].id), scopeDigest, sourceMessageId: input.sourceMessageId, allowedOrigins: origins, allowedActionClasses: actions });
    await appendAudit(client, { eventType: "generation.browser.operation_scope_established", actorType: "admin", actorId: ownerId, objectType: "generation_job", objectId: jobId, after: { scopeId: String(inserted.rows[0].id), scopeDigest, sourceMessageId: input.sourceMessageId, allowedOriginCount: origins.length, actionClasses: actions }, correlationId });
    return { id: String(inserted.rows[0].id), scopeDigest, expiresAt: new Date(inserted.rows[0].expires_at).toISOString(), idempotent: false };
  });
  return scope;
}

export async function createIrreversibleConfirmation(db: Db, jobId: string, ownerId: string, input: { scopeId: string; sourceMessageId: string; actionDigest: string; actionSummary: string; targetOrigin: string; browserSessionId?: string | null; expiresAt?: string | null }, correlationId: string): Promise<JsonRecord> {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.actionDigest)) fail("browser_action_digest_invalid", 400);
  const origin = safeOrigin(input.targetOrigin);
  return tx(db, async (client) => {
    const scope = await client.query("select id,owner_instruction_message_id,allowed_origins,allowed_operations,status,expires_at from generation_external_operation_scope where id=$1 and job_id=$2", [input.scopeId, jobId]);
    if (!scope.rowCount || String(scope.rows[0].status) !== "ACTIVE" || new Date(String(scope.rows[0].expires_at)).getTime() <= Date.now()) fail("browser_scope_not_active", 409);
    if (scope.rows[0].owner_instruction_message_id && String(scope.rows[0].owner_instruction_message_id) !== input.sourceMessageId) fail("browser_confirmation_source_message_mismatch", 409);
    const rawAllowedOrigins: unknown = scope.rows[0].allowed_origins;
    const allowedOrigins = Array.isArray(rawAllowedOrigins) ? rawAllowedOrigins.filter((value): value is string => typeof value === "string") : [];
    if (!allowedOrigins.includes(origin)) fail("browser_confirmation_origin_outside_scope", 409);
    const rawAllowedOperations: unknown = scope.rows[0].allowed_operations;
    const allowedOperations = Array.isArray(rawAllowedOperations) ? rawAllowedOperations.filter((value): value is string => typeof value === "string") : [];
    if (!allowedOperations.some((value) => value === "MUTATION_NON_IDEMPOTENT" || value === "DESTRUCTIVE")) fail("browser_confirmation_action_class_outside_scope", 409);
    const message = await client.query("select id from generation_job_message where id=$1 and job_id=$2 and role='OWNER'", [input.sourceMessageId, jobId]);
    if (!message.rowCount) fail("browser_confirmation_owner_message_required", 400);
    const existing = await client.query("select id,status from generation_irreversible_action_confirmation where job_id=$1 and action_digest=$2", [jobId, input.actionDigest]);
    if (existing.rowCount) return { confirmationId: String(existing.rows[0].id), actionDigest: input.actionDigest, status: String(existing.rows[0].status), idempotent: true };
    const inserted = await client.query(
      `insert into generation_irreversible_action_confirmation(id,job_id,scope_id,action_digest,status,confirmed_at,browser_session_id,source_message_id,action_summary,target_origin,expires_at)
       values ($1,$2,$3,$4,'CONFIRMED',now(),$5,$6,$7,$8,coalesce($9::timestamptz,now()+interval '10 minutes')) returning id,expires_at`,
      [randomUUID(), jobId, input.scopeId, input.actionDigest, input.browserSessionId ?? null, input.sourceMessageId, input.actionSummary.trim().slice(0, 2_000), origin, input.expiresAt ?? null]
    );
    await appendDiscussionEvent(client, jobId, "browser.irreversible_confirmation.used", { confirmationId: String(inserted.rows[0].id), scopeId: input.scopeId, actionDigest: input.actionDigest, targetOrigin: origin });
    await appendAudit(client, { eventType: "generation.browser.irreversible_confirmation_used", actorType: "admin", actorId: ownerId, objectType: "generation_job", objectId: jobId, after: { confirmationId: String(inserted.rows[0].id), scopeId: input.scopeId, actionDigest: input.actionDigest, targetOrigin: origin }, correlationId });
    return { confirmationId: String(inserted.rows[0].id), actionDigest: input.actionDigest, status: "CONFIRMED", expiresAt: new Date(inserted.rows[0].expires_at).toISOString(), idempotent: false };
  });
}

function validateTeachingSteps(raw: unknown): Array<JsonRecord> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 200) fail("teaching_steps_invalid", 400);
  return raw.map((entry, index) => {
    const step = record(entry);
    const action = text(step.actionType || step.action).trim().toUpperCase();
    if (!action || action.length > 80) fail(`teaching_step_action_invalid:${index}`, 400);
    const sideEffectClass = text(step.sideEffectClass || "READ_ONLY").toUpperCase();
    const retryClass = text(step.retryClass || "SAFE_RETRY").toUpperCase();
    if (!ALLOWED_SCOPE_ACTIONS.has(sideEffectClass) || !["SAFE_RETRY", "RECHECK_BEFORE_RETRY", "NO_AUTO_RETRY"].includes(retryClass)) fail(`teaching_step_policy_invalid:${index}`, 400);
    return { semanticPurpose: text(step.semanticPurpose || step.purpose).trim().slice(0, 2_000), actionType: action, locator: step.locator ?? null, inputBinding: step.inputBinding ?? null, precondition: step.precondition ?? null, waitPolicy: step.waitPolicy ?? null, postcondition: step.postcondition ?? null, sideEffectClass, retryClass, uncertainResultPolicy: step.uncertainResultPolicy ?? null, observedResult: step.observedResult ?? null };
  });
}

export async function listGenerationTeaching(db: Db, jobId: string, ownerId: string): Promise<JsonRecord[]> {
  await ownedJob(db, jobId, ownerId);
  const runs = await db.query("select id,status,purpose,start_url,allowed_origins_json,started_at,completed_at,failed_code from generation_browser_teaching_run where job_id=$1 order by created_at desc", [jobId]);
  return Promise.all(runs.rows.map(async (run) => {
    const steps = await db.query("select sequence,coalesce(semantic_purpose,action) semantic_purpose,coalesce(action_type,action) action_type,locator,input_binding_json,precondition_json,wait_policy_json,postcondition_json,side_effect_class,retry_class,uncertain_result_policy_json,observed_state from generation_browser_teaching_step where teaching_run_id=$1 order by sequence", [run.id]);
    return { id: String(run.id), status: String(run.status), purpose: run.purpose ? String(run.purpose) : null, startUrl: run.start_url ? String(run.start_url) : null, allowedOrigins: run.allowed_origins_json ?? [], startedAt: run.started_at ? new Date(run.started_at).toISOString() : null, completedAt: run.completed_at ? new Date(run.completed_at).toISOString() : null, failedCode: run.failed_code ? String(run.failed_code) : null, steps: steps.rows.map((step) => ({ sequence: Number(step.sequence), semanticPurpose: text(step.semantic_purpose), actionType: text(step.action_type), locator: step.locator ?? null, inputBinding: step.input_binding_json ?? null, precondition: step.precondition_json ?? null, waitPolicy: step.wait_policy_json ?? null, postcondition: step.postcondition_json ?? null, sideEffectClass: text(step.side_effect_class), retryClass: text(step.retry_class), uncertainResultPolicy: step.uncertain_result_policy_json ?? null, observedState: step.observed_state ?? null })) };
  }));
}

function assertReadOnlyManifest(manifest: JsonRecord): void {
  const walk = (steps: unknown): void => {
    if (!Array.isArray(steps)) fail("teaching_manifest_steps_invalid", 400);
    for (const raw of steps) {
      const step = record(raw); const action = text(step.action).toUpperCase();
      if (MUTATING_MANIFEST_ACTIONS.has(action) || ["MUTATION_NON_IDEMPOTENT", "DESTRUCTIVE"].includes(text(step.sideEffectClass).toUpperCase())) fail("teaching_manifest_not_read_only", 409);
      if (!READ_ONLY_ACTIONS.has(action)) fail(`teaching_manifest_action_not_read_only:${action}`, 409);
      if (action === "BRANCH") { walk(step.then ?? step.ifTrue); if (step.else !== undefined || step.ifFalse !== undefined) walk(step.else ?? step.ifFalse); }
      if (action === "REPEAT_BOUNDED") walk(step.steps);
    }
  };
  walk(manifest.steps);
}

function manifestSteps(manifest: JsonRecord): JsonRecord[] {
  return Array.isArray(manifest.steps) ? manifest.steps.map(record) : [];
}

async function executeTeachingCandidate(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string, input: { manifest: JsonRecord; values?: JsonRecord; purpose: string; mode: "PREFLIGHT" | "REPLAY" }): Promise<JsonRecord> {
  await ownedJob(db, jobId, ownerId);
  const manifest = validateManifest(input.manifest) as JsonRecord;
  assertReadOnlyManifest(manifest);
  const run = await tx(db, async (client) => {
    const inserted = await client.query(
      `insert into generation_browser_teaching_run(job_id,status,purpose,start_url,allowed_origins_json,started_at)
       values ($1,'RUNNING',$2,$3,$4::jsonb,now()) returning id`,
      [jobId, input.purpose.trim().slice(0, 2_000), text(manifestSteps(manifest)[0]?.url) || null, JSON.stringify(Array.isArray(manifest.allowedOrigins) ? manifest.allowedOrigins : [])]
    );
    await appendDiscussionEvent(client, jobId, input.mode === "PREFLIGHT" ? "browser.replay.started" : "browser.teaching.started", { teachingRunId: String(inserted.rows[0].id), mode: input.mode });
    return String(inserted.rows[0].id);
  });
  const workspace = path.join(config.GENERATION_ROOT, "generation-browser", jobId, "teaching", run);
  try {
    const result = await runBrowserAutomation({ manifest, input: input.values ?? {}, workspace, sessionId: run, chromiumBinary: config.CHROMIUM_BINARY, allowLocal: false });
    await tx(db, async (client) => {
      const steps = manifestSteps(manifest);
      for (const [index, step] of result.steps.entries()) {
        const manifestStep = steps[index] ?? {};
        await client.query(
        `insert into generation_browser_teaching_step(teaching_run_id,sequence,action,semantic_purpose,action_type,locator,observed_state,side_effect_class,retry_class)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) on conflict(teaching_run_id,sequence) do update set observed_state=excluded.observed_state`,
        [run, index, String(step.action), text(manifestStep.purpose), String(step.action), JSON.stringify(manifestStep.locator ?? null), JSON.stringify({ status: step.status, output: step.output ?? null }), text(manifestStep.sideEffectClass) || "READ_ONLY", text(manifestStep.retryClass) || "SAFE_RETRY"]
        );
      }
      await client.query("update generation_browser_teaching_run set status='COMPLETED',completed_at=now() where id=$1", [run]);
      await appendDiscussionEvent(client, jobId, "browser.replay.completed", { teachingRunId: run, mode: input.mode, status: "PASS", stepCount: result.steps.length });
    });
    return { teachingRunId: run, mode: input.mode, status: "PASS", stepCount: result.steps.length, outputKeys: Object.keys(result.output), modelCalls: 0 };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 300) : "teaching_replay_failed";
    await db.query("update generation_browser_teaching_run set status='FAILED',failed_code=$2,completed_at=now() where id=$1", [run, code]).catch(() => undefined);
    await appendDiscussionEvent(db, jobId, "browser.replay.completed", { teachingRunId: run, mode: input.mode, status: "FAIL", failureCode: code }).catch(() => undefined);
    fail(code, 409);
  }
}

export async function runGenerationTeachingPreflight(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string, input: { manifest: JsonRecord; values?: JsonRecord; purpose?: string }): Promise<JsonRecord> {
  return executeTeachingCandidate(db, config, jobId, ownerId, { ...input, purpose: input.purpose ?? "Read-only browser candidate preflight", mode: "PREFLIGHT" });
}

export async function runGenerationTeachingReplay(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string, input: { manifest: JsonRecord; values?: JsonRecord; purpose?: string }): Promise<JsonRecord> {
  return executeTeachingCandidate(db, config, jobId, ownerId, { ...input, purpose: input.purpose ?? "Deterministic browser candidate replay", mode: "REPLAY" });
}

export async function storeGenerationBrowserCredential(db: Db, config: GenerationRouteConfig, jobId: string, ownerId: string, input: { stableName: string; value: string; displayName?: string; description?: string }, correlationId: string): Promise<JsonRecord> {
  await ownedJob(db, jobId, ownerId);
  const stableName = input.stableName.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(stableName) || !input.value.trim()) fail("browser_credential_invalid", 400);
  if (stableName === "OPENAI_API_KEY") fail("browser_credential_reuse_canonical_generation_secret", 409);
  const current = (await listSecrets(db)).find((secret) => secret.stableName === stableName && !secret.deletedAt);
  const secret = current
    ? await rotateSecret(db, config, ownerId, correlationId, current.id, { value: input.value, expectedVersion: current.lockVersion })
    : await createSecret(db, config, ownerId, correlationId, { stableName, displayName: input.displayName?.trim() || stableName, description: input.description?.trim() || `Browser credential for generation job ${jobId}.`, value: input.value, ownerKind: "PLATFORM", ownerId: null });
  const principal = await platformWorkerSecretPrincipal(db);
  await grantSecret(db, ownerId, correlationId, secret.id, { principalKind: "PLATFORM", principalId: principal.id, principalPublicId: principal.publicId, allSecrets: false });
  await appendDiscussionEvent(db, jobId, "browser.credential.bound", { stableName, secretId: secret.id, platformPrincipal: principal.publicId });
  await appendAudit(db, { eventType: "generation.browser.credential_bound", actorType: "admin", actorId: ownerId, objectType: "generation_job", objectId: jobId, after: { stableName, secretId: secret.id, platformPrincipal: principal.publicId, rotated: Boolean(current) }, correlationId });
  return { stableName, secretId: secret.id, status: secret.status, activeVersionId: secret.activeVersionId, activeFingerprint: secret.activeFingerprint, platformPrincipal: principal.publicId };
}

export async function recordGenerationTeachingRun(db: Db, jobId: string, ownerId: string, input: { purpose: string; startUrl?: string; allowedOrigins: string[]; steps: unknown[]; sourceTurnId?: string | null }): Promise<JsonRecord> {
  await ownedJob(db, jobId, ownerId);
  const steps = validateTeachingSteps(input.steps);
  const origins = input.allowedOrigins.map(safeOrigin);
  const result = await tx(db, async (client) => {
    const run = await client.query(`insert into generation_browser_teaching_run(job_id,source_turn_id,status,purpose,start_url,allowed_origins_json,started_at,completed_at) values ($1,$2,'COMPLETED',$3,$4,$5::jsonb,now(),now()) returning id`, [jobId, input.sourceTurnId ?? null, input.purpose.trim().slice(0, 2_000), input.startUrl ? safeUrlMetadata(input.startUrl) : null, JSON.stringify(origins)]);
    for (const [sequence, step] of steps.entries()) await client.query(
      `insert into generation_browser_teaching_step(teaching_run_id,sequence,action,semantic_purpose,action_type,locator,input_binding_json,precondition_json,wait_policy_json,postcondition_json,side_effect_class,retry_class,uncertain_result_policy_json,observed_state)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb)`, [run.rows[0].id, sequence, step.actionType, step.semanticPurpose, step.actionType, JSON.stringify(step.locator), JSON.stringify(step.inputBinding), JSON.stringify(step.precondition), JSON.stringify(step.waitPolicy), JSON.stringify(step.postcondition), step.sideEffectClass, step.retryClass, JSON.stringify(step.uncertainResultPolicy), JSON.stringify(step.observedResult)]
    );
    return String(run.rows[0].id);
  });
  return { teachingRunId: result, status: "COMPLETED", stepCount: steps.length, allowedOrigins: origins };
}

export async function cleanupGenerationBrowserSession(db: Db, config: BrowserSessionConfig, jobId: string, ownerId: string): Promise<void> {
  await ownedJob(db, jobId, ownerId);
  const session = await db.query("select id from generation_browser_session where job_id=$1 and owner_admin_id=$2", [jobId, ownerId]);
  for (const row of session.rows) {
    const browser = liveBrowserSessions.get(String(row.id));
    if (browser) await browser.close().catch(() => undefined);
    liveBrowserSessions.delete(String(row.id));
  }
  await db.query("update generation_browser_session set status='CLOSED',updated_at=now() where job_id=$1 and owner_admin_id=$2 and status<>'CLOSED'", [jobId, ownerId]);
  await db.query("delete from generation_browser_preview_frame where job_id=$1", [jobId]);
  const target = path.resolve(config.GENERATION_ROOT, "generation-browser", jobId);
  const root = path.resolve(config.GENERATION_ROOT);
  if (target.startsWith(`${root}${path.sep}`)) await rm(target, { recursive: true, force: true }).catch(() => undefined);
}
