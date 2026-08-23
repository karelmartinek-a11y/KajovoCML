import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit } from "./audit.js";
import { enqueueGeneratedRepairJob } from "./generation.js";
import { runBrowserAutomation, validateManifest } from "../generation/browser-automation-runtime.mjs";
import { platformWorkerSecretPrincipal, resolveSecret } from "./secret-manager.js";

type JsonRecord = Record<string, unknown>;
type Queryable = Pick<Db, "query">;

export const AUTOMATION_TERMINAL_STATES = [
  "SUCCEEDED", "FAILED", "CANCELLED", "CHALLENGE_REQUIRED", "MANUAL_REVIEW", "DRIFT", "REAUTH_REQUIRED"
] as const;
export type AutomationRunStatus =
  | "QUEUED" | "RUNNING" | "CANCEL_REQUESTED" | typeof AUTOMATION_TERMINAL_STATES[number];

export type BrowserAutomationManifest = JsonRecord & {
  schemaVersion: "kcml.browser-automation.v1";
  steps: Array<JsonRecord & { action: string }>;
};

export type BrowserAutomationRunView = {
  id: string;
  definitionId: string;
  revisionId: string;
  idempotencyKey: string;
  status: AutomationRunStatus;
  input: JsonRecord;
  output: JsonRecord | null;
  errorCode: string | null;
  callerPrincipalId: string | null;
  executionMode: "SYNC" | "ASYNC";
  attempt: number;
  currentStep: number | null;
  cancellationRequestedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: Array<{ index: number; action: string; status: string; errorCode: string | null }>;
};

type AutomationConfig = Pick<AppServerConfig, "GENERATION_ROOT" | "CHROMIUM_BINARY" | "CONFIG_VAULT_MASTER_KEY_BASE64" | "CONFIG_VAULT_MASTER_KEY_ID">;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function browserAutomationCanonicalJson(manifest: unknown): string {
  return canonicalJson(manifest);
}

export function browserAutomationDigest(manifest: unknown): string {
  return `sha256:${createHash("sha256").update(browserAutomationCanonicalJson(manifest)).digest("hex")}`;
}

function fail(code: string, statusCode = 400): never {
  throw Object.assign(new Error(code), { statusCode });
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "automation_run_failed";
  if (value === "automation_cancelled") return value;
  if (value.startsWith("automation_")) return value.split(":", 1)[0] ?? "automation_run_failed";
  if (value.startsWith("browser_")) return value.split(":", 1)[0] ?? "browser_action_failed";
  return "automation_run_failed";
}

type BrowserAutomationFinalStatus = "SUCCEEDED" | "FAILED" | "CANCELLED" | "CHALLENGE_REQUIRED" | "MANUAL_REVIEW" | "DRIFT" | "REAUTH_REQUIRED";

export function finalStatusForAutomationError(errorCode: string | null, cancelled: boolean): BrowserAutomationFinalStatus {
  if (cancelled || errorCode === "automation_cancelled") return "CANCELLED";
  if (errorCode === "automation_uncertain_side_effect") return "MANUAL_REVIEW";
  if (errorCode === "automation_human_challenge_required") return "CHALLENGE_REQUIRED";
  if (errorCode === "automation_contract_drift") return "DRIFT";
  if (errorCode === "automation_reauthentication_required") return "REAUTH_REQUIRED";
  return errorCode ? "FAILED" : "SUCCEEDED";
}

function safeManifest(value: unknown): BrowserAutomationManifest {
  const manifest = validateManifest(value) as BrowserAutomationManifest;
  if (manifest.schemaVersion !== "kcml.browser-automation.v1") fail("automation_manifest_schema_unsupported");
  return manifest;
}

export function validateBrowserAutomationManifest(value: unknown): BrowserAutomationManifest {
  return safeManifest(value);
}

function iso(value: unknown): string | null {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function runView(row: Record<string, unknown>, steps: Array<Record<string, unknown>>): BrowserAutomationRunView {
  return {
    id: String(row.id), definitionId: String(row.definition_id), revisionId: String(row.revision_id),
    idempotencyKey: String(row.idempotency_key), status: String(row.status) as AutomationRunStatus,
    input: object(row.input_json), output: row.output_json ? object(row.output_json) : null,
    errorCode: row.error_code ? text(row.error_code) : null,
    callerPrincipalId: row.caller_principal_id ? text(row.caller_principal_id) : null,
    executionMode: text(row.execution_mode ?? "ASYNC") as "SYNC" | "ASYNC",
    attempt: Number(row.attempt ?? 0), currentStep: row.current_step === null || row.current_step === undefined ? null : Number(row.current_step),
    cancellationRequestedAt: iso(row.cancellation_requested_at), createdAt: new Date(row.created_at as string | number | Date).toISOString(),
    startedAt: iso(row.started_at), completedAt: iso(row.completed_at),
    steps: steps.map((step) => ({ index: Number(step.step_index), action: text(step.action), status: text(step.status), errorCode: step.error_code ? text(step.error_code) : null }))
  };
}

async function loadRun(db: Queryable, runId: string): Promise<BrowserAutomationRunView> {
  const run = await db.query("select * from browser_automation_run where id=$1", [runId]);
  if (!run.rowCount) fail("not_found", 404);
  const steps = await db.query("select step_index,action,status,error_code from browser_automation_run_step where run_id=$1 order by step_index", [runId]);
  return runView(run.rows[0] as Record<string, unknown>, steps.rows as Array<Record<string, unknown>>);
}

async function assertCallerPrincipal(db: Queryable, callerPrincipalId: string | null): Promise<void> {
  if (!callerPrincipalId) return;
  const result = await db.query("select status from principal where id=$1", [callerPrincipalId]);
  if (!result.rowCount || String(result.rows[0].status) !== "ACTIVE") fail("automation_caller_not_authorized", 403);
}

export async function listBrowserAutomations(db: Queryable): Promise<Array<Record<string, unknown>>> {
  const result = await db.query(
    `select d.id,d.code,d.stable_key,d.display_name,d.purpose,d.status,d.active_revision_id,
            d.owner_component_id,d.last_success_at,d.last_failure_at,d.last_failure_code,
            d.created_at,d.updated_at,r.revision active_revision,r.digest active_digest,
            r.verification_status active_verification_status
       from browser_automation_definition d
       left join browser_automation_revision r on r.id=d.active_revision_id
      order by d.created_at desc`
  );
  return result.rows.map((row) => ({
    id: String(row.id), code: String(row.code), stableKey: String(row.stable_key), displayName: String(row.display_name),
    purpose: row.purpose ? String(row.purpose) : null, status: String(row.status), activeRevisionId: row.active_revision_id ? String(row.active_revision_id) : null,
    ownerComponentId: row.owner_component_id ? String(row.owner_component_id) : null,
    lastSuccessAt: iso(row.last_success_at), lastFailureAt: iso(row.last_failure_at), lastFailureCode: row.last_failure_code ? String(row.last_failure_code) : null,
    activeRevision: row.active_revision === null ? null : Number(row.active_revision), activeDigest: row.active_digest ? String(row.active_digest) : null,
    activeVerificationStatus: row.active_verification_status ? String(row.active_verification_status) : null,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
  }));
}

export async function getBrowserAutomation(db: Queryable, definitionId: string): Promise<Record<string, unknown>> {
  const result = await db.query(
    `select d.*,r.id revision_id,r.revision,r.manifest,r.canonical_json,r.digest,r.status revision_status,r.verification_status,
            r.created_at revision_created_at,r.activated_at
       from browser_automation_definition d
       left join browser_automation_revision r on r.id=d.active_revision_id
      where d.id=$1`, [definitionId]
  );
  if (!result.rowCount) fail("not_found", 404);
  const row = result.rows[0];
  const binding = await db.query("select stable_secret_name,mode,enabled from browser_automation_auth_binding where definition_id=$1 order by stable_secret_name", [definitionId]);
  return {
    id: String(row.id), code: String(row.code), stableKey: String(row.stable_key), displayName: String(row.display_name), purpose: row.purpose ? String(row.purpose) : null,
    status: String(row.status), activeRevisionId: row.active_revision_id ? String(row.active_revision_id) : null, ownerComponentId: row.owner_component_id ? String(row.owner_component_id) : null,
    revision: row.revision_id ? { id: String(row.revision_id), number: Number(row.revision), manifest: row.manifest, canonicalJson: String(row.canonical_json), digest: String(row.digest), status: String(row.revision_status), verificationStatus: String(row.verification_status), createdAt: new Date(row.revision_created_at).toISOString(), activatedAt: iso(row.activated_at) } : null,
    authBindings: binding.rows.map((entry) => ({ stableSecretName: String(entry.stable_secret_name), mode: String(entry.mode), enabled: Boolean(entry.enabled) }))
  };
}

export async function listBrowserAutomationRevisions(db: Queryable, definitionId: string): Promise<Array<Record<string, unknown>>> {
  const result = await db.query("select id,revision,digest,status,verification_status,source_generation_job_id,approved_spec_revision_id,created_at,activated_at from browser_automation_revision where definition_id=$1 order by revision desc", [definitionId]);
  return result.rows.map((row) => ({ id: String(row.id), revision: Number(row.revision), digest: String(row.digest), status: String(row.status), verificationStatus: String(row.verification_status), sourceGenerationJobId: row.source_generation_job_id ? String(row.source_generation_job_id) : null, approvedSpecRevisionId: row.approved_spec_revision_id ? String(row.approved_spec_revision_id) : null, createdAt: new Date(row.created_at).toISOString(), activatedAt: iso(row.activated_at) }));
}

export async function createBrowserAutomationAuthBinding(
  db: Db,
  definitionId: string,
  stableSecretName: string,
  mode: "SECRET_MANAGER" | "HYBRID" | "OWNER_CHALLENGE",
  actorId: string,
  correlationId: string
): Promise<void> {
  const name = stableSecretName.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(name)) fail("automation_secret_name_invalid");
  await tx(db, async (client) => {
    const definition = await client.query("select id from browser_automation_definition where id=$1 for update", [definitionId]);
    if (!definition.rowCount) fail("not_found", 404);
    const secret = await client.query("select id,status,active_version_id,deleted_at from secret_record where stable_name=$1", [name]);
    if (!secret.rowCount || String(secret.rows[0].status) !== "ACTIVE" || !secret.rows[0].active_version_id || secret.rows[0].deleted_at) fail("automation_secret_unavailable", 409);
    await client.query(
      `insert into browser_automation_auth_binding(definition_id,stable_secret_name,mode,enabled)
       values ($1,$2,$3,true)
       on conflict (definition_id,stable_secret_name) do update set mode=excluded.mode,enabled=true`,
      [definitionId, name, mode]
    );
    await appendAudit(client, { eventType: "browser_automation.auth_binding.created", actorType: "admin", actorId, objectType: "browser_automation_definition", objectId: definitionId, after: { stableSecretName: name, mode }, correlationId });
  });
}

export async function createBrowserAutomationDefinition(
  db: Db,
  input: { code: string; displayName: string; purpose?: string; ownerComponentId?: string | null },
  actorId: string,
  correlationId: string
): Promise<string> {
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{2,80}$/.test(code)) fail("automation_code_invalid");
  return tx(db, async (client) => {
    const inserted = await client.query(
      `insert into browser_automation_definition(code,stable_key,display_name,purpose,owner_component_id)
       values ($1,$1,$2,$3,$4) returning id`, [code, input.displayName.trim(), input.purpose?.trim() || null, input.ownerComponentId ?? null]
    );
    const id = String(inserted.rows[0].id);
    await appendAudit(client, { eventType: "browser_automation.definition.created", actorType: "admin", actorId, objectType: "browser_automation_definition", objectId: id, after: { code }, correlationId });
    return id;
  });
}

export async function createBrowserAutomationRevision(
  db: Db,
  definitionId: string,
  manifestInput: unknown,
  actorId: string,
  correlationId: string
): Promise<{ id: string; digest: string; revision: number }> {
  const manifest = safeManifest(manifestInput);
  const canonical = browserAutomationCanonicalJson(manifest);
  const digest = browserAutomationDigest(manifest);
  return tx(db, async (client) => {
    const definition = await client.query("select id from browser_automation_definition where id=$1 for update", [definitionId]);
    if (!definition.rowCount) fail("not_found", 404);
    const next = await client.query("select coalesce(max(revision),0)+1 next from browser_automation_revision where definition_id=$1", [definitionId]);
    const inserted = await client.query(
      `insert into browser_automation_revision(definition_id,revision,manifest,canonical_json,digest,status,verification_status)
       values ($1,$2,$3::jsonb,$4,$5,'DRAFT','PENDING') returning id`, [definitionId, Number(next.rows[0].next), JSON.stringify(manifest), canonical, digest]
    );
    const id = String(inserted.rows[0].id);
    await appendAudit(client, { eventType: "browser_automation.revision.created", actorType: "admin", actorId, objectType: "browser_automation_revision", objectId: id, after: { definitionId, revision: Number(next.rows[0].next), digest }, correlationId });
    return { id, digest, revision: Number(next.rows[0].next) };
  });
}

export async function preflightBrowserAutomation(db: Db, definitionId: string, actorId: string, correlationId: string): Promise<Record<string, unknown>> {
  const result = await db.query("select d.id,d.active_revision_id,r.manifest,r.digest,r.id revision_id from browser_automation_definition d left join browser_automation_revision r on r.id=d.active_revision_id where d.id=$1", [definitionId]);
  if (!result.rowCount || !result.rows[0].active_revision_id) fail("automation_active_revision_required", 409);
  const row = result.rows[0];
  try {
    const manifest = safeManifest(row.manifest);
    const digest = browserAutomationDigest(manifest);
    if (digest !== String(row.digest)) fail("automation_digest_mismatch", 409);
    await tx(db, async (client) => {
      await client.query("update browser_automation_revision set status='PREFLIGHTED',verification_status='PENDING' where id=$1 and digest=$2", [row.revision_id, digest]);
      await client.query("update browser_automation_definition set last_failure_at=null,last_failure_code=null,updated_at=now() where id=$1", [definitionId]);
      await appendAudit(client, { eventType: "browser_automation.preflight.completed", actorType: "admin", actorId, objectType: "browser_automation_definition", objectId: definitionId, after: { revisionId: String(row.revision_id), digest, verification: "STATIC_MANIFEST_VALIDATION" }, correlationId });
    });
    return { definitionId, revisionId: String(row.revision_id), digest, valid: true, verificationStatus: "STATIC_VALIDATED", runtimeExecutionRequired: true };
  } catch (error) {
    const code = safeErrorCode(error);
    await db.query("update browser_automation_revision set verification_status='FAIL' where id=$1", [row.revision_id]);
    await db.query("update browser_automation_definition set status='REPAIR_REQUIRED',last_failure_at=now(),last_failure_code=$2,updated_at=now() where id=$1", [definitionId, code]);
    fail(code, 400);
  }
}

function assertReadOnlyManifest(manifest: BrowserAutomationManifest): void {
  const visit = (steps: Array<JsonRecord>, pathName: string): void => {
    for (const [index, raw] of steps.entries()) {
      const step = object(raw);
      if (text(step.sideEffectClass) !== "READ_ONLY") fail(`automation_runtime_verification_not_read_only:${pathName}.${index}`, 409);
      const action = text(step.action).toUpperCase();
      if (["FILL_SECRET", "FILL", "SELECT", "CLICK", "CHECK", "UNCHECK", "PRESS", "UPLOAD", "DOWNLOAD"].includes(action)) fail(`automation_runtime_verification_action_not_read_only:${action}`, 409);
      if (action === "BRANCH") {
        visit((step.then ?? step.ifTrue ?? []) as Array<JsonRecord>, `${pathName}.${index}.then`);
        if (step.else !== undefined || step.ifFalse !== undefined) visit((step.else ?? step.ifFalse ?? []) as Array<JsonRecord>, `${pathName}.${index}.else`);
      }
      if (action === "REPEAT_BOUNDED") visit((step.steps ?? []) as Array<JsonRecord>, `${pathName}.${index}.steps`);
    }
  };
  visit(manifest.steps, "steps");
}

export async function verifyBrowserAutomationRevision(
  db: Db,
  config: AutomationConfig,
  definitionId: string,
  revisionId: string,
  input: JsonRecord,
  actorId: string,
  correlationId: string
): Promise<Record<string, unknown>> {
  const result = await db.query("select r.id,r.manifest,r.digest,r.status,r.verification_status from browser_automation_revision r where r.id=$1 and r.definition_id=$2", [revisionId, definitionId]);
  if (!result.rowCount) fail("not_found", 404);
  const row = result.rows[0]; const manifest = safeManifest(row.manifest);
  const digest = browserAutomationDigest(manifest);
  if (digest !== String(row.digest)) fail("automation_digest_mismatch", 409);
  assertReadOnlyManifest(manifest);
  const verificationRoot = path.join(config.GENERATION_ROOT, "browser-automation");
  await mkdir(verificationRoot, { recursive: true, mode: 0o750 });
  const workspace = await mkdtemp(path.join(verificationRoot, "verification-"));
  try {
    const execution = await runBrowserAutomation({ manifest, input, workspace, sessionId: `verification-${revisionId}`, chromiumBinary: config.CHROMIUM_BINARY, allowLocal: false });
    await tx(db, async (client) => {
      await client.query("update browser_automation_revision set verification_status='PASS',status=case when status='DRAFT' then 'PREFLIGHTED' else status end where id=$1 and digest=$2", [revisionId, digest]);
      await client.query("update browser_automation_definition set last_preflight_at=now(),last_preflight_error=null,updated_at=now() where id=$1", [definitionId]);
      await appendAudit(client, { eventType: "browser_automation.runtime_verification.completed", actorType: "admin", actorId, objectType: "browser_automation_revision", objectId: revisionId, after: { definitionId, digest, stepCount: execution.steps.length, verification: "RUNTIME_READ_ONLY" }, correlationId });
    });
    return { definitionId, revisionId, digest, valid: true, verificationStatus: "PASS", executionMode: "PLAYWRIGHT_READ_ONLY", stepCount: execution.steps.length, outputKeys: Object.keys(execution.output) };
  } catch (error) {
    const code = safeErrorCode(error);
    await db.query("update browser_automation_revision set verification_status='FAIL' where id=$1", [revisionId]);
    await db.query("update browser_automation_definition set last_preflight_at=now(),last_preflight_error=$2,updated_at=now() where id=$1", [definitionId, code]);
    fail(code, 409);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function activateBrowserAutomationRevision(db: Db, definitionId: string, revisionId: string, actorId: string, correlationId: string): Promise<void> {
  await tx(db, async (client) => {
    const revision = await client.query("select id,digest,verification_status from browser_automation_revision where id=$1 and definition_id=$2 for update", [revisionId, definitionId]);
    if (!revision.rowCount) fail("not_found", 404);
    if (String(revision.rows[0].verification_status) !== "PASS") fail("automation_runtime_verification_required", 409);
    await client.query("update browser_automation_revision set status='SUPERSEDED' where definition_id=$1 and status='ACTIVE' and id<>$2", [definitionId, revisionId]);
    await client.query("update browser_automation_revision set status='ACTIVE',activated_at=coalesce(activated_at,now()) where id=$1", [revisionId]);
    await client.query("update browser_automation_definition set active_revision_id=$2,status='DISABLED',updated_at=now() where id=$1", [definitionId, revisionId]);
    await appendAudit(client, { eventType: "browser_automation.revision.activated", actorType: "admin", actorId, objectType: "browser_automation_revision", objectId: revisionId, after: { definitionId, digest: String(revision.rows[0].digest) }, correlationId });
  });
}

export async function setBrowserAutomationEnabled(db: Db, definitionId: string, enabled: boolean, actorId: string, correlationId: string): Promise<void> {
  const result = await db.query("select active_revision_id from browser_automation_definition where id=$1", [definitionId]);
  if (!result.rowCount) fail("not_found", 404);
  if (enabled) {
    if (!result.rows[0].active_revision_id) fail("automation_active_revision_required", 409);
    const revision = await db.query("select status,verification_status from browser_automation_revision where id=$1", [result.rows[0].active_revision_id]);
    if (!revision.rowCount || String(revision.rows[0].status) !== "ACTIVE" || String(revision.rows[0].verification_status) !== "PASS") fail("automation_runtime_verification_required", 409);
  }
  await tx(db, async (client) => {
    await client.query("update browser_automation_definition set status=$2,updated_at=now() where id=$1", [definitionId, enabled ? "ENABLED" : "DISABLED"]);
    await appendAudit(client, { eventType: `browser_automation.${enabled ? "enabled" : "disabled"}`, actorType: "admin", actorId, objectType: "browser_automation_definition", objectId: definitionId, after: { enabled }, correlationId });
  });
}

export async function createBrowserAutomationRun(
  db: Db,
  definitionId: string,
  input: JsonRecord,
  idempotencyKey: string,
  callerPrincipalId: string | null,
  actorId: string,
  correlationId: string
): Promise<BrowserAutomationRunView> {
  await assertCallerPrincipal(db, callerPrincipalId);
  return tx(db, async (client) => {
    const definition = await client.query("select id,status,active_revision_id from browser_automation_definition where id=$1 for update", [definitionId]);
    if (!definition.rowCount) fail("not_found", 404);
    if (String(definition.rows[0].status) !== "ENABLED") fail("automation_not_enabled", 409);
    const revision = await client.query("select id,manifest,status,verification_status from browser_automation_revision where id=$1 and definition_id=$2", [definition.rows[0].active_revision_id, definitionId]);
    if (!revision.rowCount || String(revision.rows[0].status) !== "ACTIVE" || String(revision.rows[0].verification_status) !== "PASS") fail("automation_runtime_verification_required", 409);
    const existing = await client.query("select * from browser_automation_run where definition_id=$1 and caller_principal_id is not distinct from $2 and idempotency_key=$3", [definitionId, callerPrincipalId, idempotencyKey]);
    if (existing.rowCount) return loadRun(client, String(existing.rows[0].id));
    const inserted = await client.query(
      `insert into browser_automation_run(definition_id,revision_id,caller_principal_id,idempotency_key,input_json,execution_mode,status)
       values ($1,$2,$3,$4,$5::jsonb,'ASYNC','QUEUED') returning id`, [definitionId, revision.rows[0].id, callerPrincipalId, idempotencyKey, JSON.stringify(input)]
    );
    const runId = String(inserted.rows[0].id);
    const manifest = safeManifest(revision.rows[0].manifest);
    for (const [index, step] of manifest.steps.entries()) await client.query("insert into browser_automation_run_step(run_id,step_index,action) values ($1,$2,$3)", [runId, index, String(step.action).toUpperCase()]);
    await appendAudit(client, { eventType: "browser_automation.run.queued", actorType: "admin", actorId, objectType: "browser_automation_run", objectId: runId, after: { definitionId, revisionId: String(revision.rows[0].id), callerPrincipalId, idempotencyKey }, correlationId });
    return loadRun(client, runId);
  });
}

export async function listBrowserAutomationRuns(db: Queryable, definitionId: string): Promise<BrowserAutomationRunView[]> {
  const runs = await db.query("select * from browser_automation_run where definition_id=$1 order by created_at desc limit 100", [definitionId]);
  return Promise.all(runs.rows.map(async (row) => loadRun(db, String(row.id))));
}

export async function getBrowserAutomationRun(db: Queryable, runId: string): Promise<BrowserAutomationRunView> {
  return loadRun(db, runId);
}

export async function requestBrowserAutomationCancel(db: Db, runId: string, actorId: string, correlationId: string): Promise<void> {
  await tx(db, async (client) => {
    const result = await client.query(
      `update browser_automation_run
          set status=case when status='QUEUED' then 'CANCELLED' when status='RUNNING' then 'CANCEL_REQUESTED' else status end,
              cancellation_requested_at=case when status in ('QUEUED','RUNNING') then now() else cancellation_requested_at end,
              completed_at=case when status='QUEUED' then now() else completed_at end
        where id=$1 and status in ('QUEUED','RUNNING') returning status`, [runId]
    );
    if (!result.rowCount) {
      const exists = await client.query("select id,status from browser_automation_run where id=$1", [runId]);
      if (!exists.rowCount) fail("not_found", 404);
      if (String(exists.rows[0].status) === "CANCEL_REQUESTED") return;
      fail("automation_run_terminal", 409);
    }
    await appendAudit(client, { eventType: "browser_automation.run.cancel_requested", actorType: "admin", actorId, objectType: "browser_automation_run", objectId: runId, after: { status: String(result.rows[0].status) }, correlationId });
  });
}

async function claimRun(db: Db, workerId: string, leaseMs: number): Promise<Record<string, unknown> | null> {
  return tx(db, async (client) => {
    const result = await client.query(
      `select r.id,r.definition_id,r.revision_id,r.input_json,r.attempt,d.code,rev.manifest
         from browser_automation_run r
         join browser_automation_definition d on d.id=r.definition_id
         join browser_automation_revision rev on rev.id=r.revision_id
        where r.status='QUEUED' or (r.status='RUNNING' and r.lease_until < now())
        order by r.created_at
        for update of r skip locked limit 1`
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const token = randomUUID();
    const claimed = await client.query(
      `update browser_automation_run
          set status='RUNNING',lease_owner=$2,lease_token=$3::uuid,lease_until=now()+($4||' milliseconds')::interval,
              attempt=attempt+1,started_at=coalesce(started_at,now()),current_step=0
        where id=$1 and (status='QUEUED' or (status='RUNNING' and lease_until < now()))
        returning id,definition_id,revision_id,input_json,attempt,lease_token`, [row.id, workerId, token, leaseMs]
    );
    return claimed.rowCount ? { ...row as Record<string, unknown>, ...claimed.rows[0] as Record<string, unknown> } : null;
  });
}

async function isCancelled(db: Db, runId: string, workerId: string, leaseToken: string): Promise<boolean> {
  const result = await db.query("select status,cancellation_requested_at from browser_automation_run where id=$1 and lease_owner=$2 and lease_token=$3::uuid", [runId, workerId, leaseToken]);
  return !result.rowCount || String(result.rows[0].status) === "CANCEL_REQUESTED" || Boolean(result.rows[0].cancellation_requested_at);
}

async function renewLease(db: Db, runId: string, workerId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
  const result = await db.query("update browser_automation_run set lease_until=now()+($4||' milliseconds')::interval where id=$1 and lease_owner=$2 and lease_token=$3::uuid and status='RUNNING' returning id", [runId, workerId, leaseToken, leaseMs]);
  return Boolean(result.rowCount);
}

async function writeEvidence(config: AutomationConfig, runId: string, evidence: JsonRecord): Promise<string> {
  const relativeKey = path.join("browser-automation", runId, "evidence.json");
  const target = path.resolve(config.GENERATION_ROOT, relativeKey);
  const root = path.resolve(config.GENERATION_ROOT);
  if (!target.startsWith(`${root}${path.sep}`)) fail("automation_artifact_path_invalid", 500);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
  await writeFile(target, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600);
  return relativeKey;
}

async function finalizeRun(db: Db, config: AutomationConfig, run: Record<string, unknown>, workerId: string, leaseToken: string, status: BrowserAutomationFinalStatus, output: JsonRecord | null, errorCode: string | null, steps: Array<Record<string, unknown>>): Promise<boolean> {
  const runId = String(run.id);
  const evidenceKey = await writeEvidence(config, runId, { runId, revisionId: String(run.revision_id), status, attempt: Number(run.attempt ?? 0), errorCode, steps: steps.map((step) => ({ index: Number(step.index), action: String(step.action), status: String(step.status), errorCode: step.errorCode ? text(step.errorCode) : null })) });
  return tx(db, async (client) => {
    const result = await client.query(
      `update browser_automation_run
          set status=$4,output_json=$5::jsonb,error_code=$6, safe_error=case when $6 is null then null else jsonb_build_object('code',$6) end,
              completed_at=now(),lease_until=null,current_step=null,progress_json=$7::jsonb
        where id=$1 and lease_owner=$2 and lease_token=$3::uuid and status in ('RUNNING','CANCEL_REQUESTED') returning id`,
      [runId, workerId, leaseToken, status, output ? JSON.stringify(output) : null, errorCode, JSON.stringify({ evidenceKey })]
    );
    if (!result.rowCount) return false;
    for (const step of steps) {
      const stepIndex = typeof step.index === "number" && Number.isInteger(step.index) ? step.index : null;
      if (stepIndex === null) continue;
      await client.query("update browser_automation_run_step set status=$2,error_code=$3,output_json=$4::jsonb,completed_at=now() where run_id=$1 and step_index=$5", [runId, String(step.status), step.errorCode ? text(step.errorCode) : null, step.output ? JSON.stringify(step.output) : null, stepIndex]);
    }
    await client.query("insert into browser_automation_artifact(run_id,kind,storage_key,sensitive,content_type) values ($1,'EVIDENCE',$2,false,'application/json')", [runId, evidenceKey]);
    await client.query("update browser_automation_definition set last_success_at=case when $2='SUCCEEDED' then now() else last_success_at end,last_failure_at=case when $2<>'SUCCEEDED' then now() else last_failure_at end,last_failure_code=case when $2<>'SUCCEEDED' then $3 else null end,updated_at=now() where id=$1", [String(run.definition_id), status, errorCode]);
    return true;
  });
}

export async function processNextBrowserAutomationRun(db: Db, config: AutomationConfig, workerId: string, leaseMs = 60_000): Promise<boolean> {
  const run = await claimRun(db, workerId, leaseMs);
  if (!run) return false;
  const runId = String(run.id); const leaseToken = String(run.lease_token);
  const controller = new AbortController();
  const timer = setInterval(() => {
    void (async () => {
      if (await isCancelled(db, runId, workerId, leaseToken)) controller.abort(new Error("automation_cancelled"));
      else if (!await renewLease(db, runId, workerId, leaseToken, leaseMs)) controller.abort(new Error("automation_lease_lost"));
    })();
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  try {
    const result = await runBrowserAutomation({
      manifest: run.manifest,
      input: object(run.input_json),
      workspace: path.join(config.GENERATION_ROOT, "browser-automation", runId),
      sessionId: runId,
      chromiumBinary: config.CHROMIUM_BINARY,
      allowLocal: false,
      signal: controller.signal,
      resolveSecret: async (stableName) => {
        const binding = await db.query("select 1 from browser_automation_auth_binding where definition_id=$1 and stable_secret_name=$2 and enabled=true", [String(run.definition_id), stableName.trim().toUpperCase()]);
        if (!binding.rowCount) fail("automation_secret_binding_required", 403);
        const principal = await platformWorkerSecretPrincipal(db);
        return (await resolveSecret(db, config, principal, stableName, randomUUID())).value;
      }
    });
    const canceled = await isCancelled(db, runId, workerId, leaseToken);
    const errorCode = canceled ? "automation_cancelled" : null;
    await finalizeRun(db, config, run, workerId, leaseToken, finalStatusForAutomationError(errorCode, canceled), object(result.output), errorCode, result.steps.map((step: Record<string, unknown>) => ({ index: step.index, action: step.action, status: step.status, output: step.output })));
  } catch (error) {
    const canceled = (error instanceof Error && error.message === "automation_cancelled") || await isCancelled(db, runId, workerId, leaseToken);
    const errorCode = canceled ? "automation_cancelled" : safeErrorCode(error);
    const runtimeSteps = error instanceof Error && Array.isArray((error as Error & { runtimeSteps?: unknown }).runtimeSteps)
      ? (error as Error & { runtimeSteps: Array<Record<string, unknown>> }).runtimeSteps
      : [{ index: Number(run.current_step ?? 0), action: "RUN", status: canceled ? "SKIPPED" : "FAILED", errorCode }];
    await finalizeRun(db, config, run, workerId, leaseToken, finalStatusForAutomationError(errorCode, canceled), null, errorCode, runtimeSteps);
  } finally {
    clearInterval(timer);
  }
  return true;
}

export async function reauthenticateBrowserAutomation(db: Db, definitionId: string, actorId: string, reauthenticatedAt: string, correlationId: string): Promise<void> {
  if (Date.now() - new Date(reauthenticatedAt).getTime() > 10 * 60_000) fail("reauthentication_required", 401);
  await tx(db, async (client) => {
    const bindings = await client.query("select id from browser_automation_auth_binding where definition_id=$1 and enabled=true", [definitionId]);
    if (!bindings.rowCount) fail("automation_auth_binding_required", 409);
    await client.query("update browser_automation_definition set status=case when active_revision_id is null then 'REAUTH_REQUIRED' else 'DISABLED' end,updated_at=now() where id=$1", [definitionId]);
    await appendAudit(client, { eventType: "browser_automation.reauthenticated", actorType: "admin", actorId, objectType: "browser_automation_definition", objectId: definitionId, after: { bindingCount: bindings.rowCount }, correlationId });
  });
}

export async function repairBrowserAutomation(db: Db, definitionId: string, actorId: string, correlationId: string): Promise<Record<string, unknown>> {
  const result = await db.query("select active_revision_id,status,owner_component_id,last_failure_code from browser_automation_definition where id=$1", [definitionId]);
  if (!result.rowCount) fail("not_found", 404);
  const preflight = await preflightBrowserAutomation(db, definitionId, actorId, correlationId);
  const ownerComponentId = result.rows[0].owner_component_id ? String(result.rows[0].owner_component_id) : null;
  const repairJob = ownerComponentId
    ? await enqueueGeneratedRepairJob(db, ownerComponentId, {
      source: "browser_automation_repair",
      probe: "browser_automation_runtime",
      status: "REPAIR_REQUESTED",
      definitionId,
      activeRevisionId: preflight.revisionId,
      activeDigest: preflight.digest,
      lastFailureCode: result.rows[0].last_failure_code ? String(result.rows[0].last_failure_code) : null
    }, correlationId)
    : null;
  const repairState = repairJob?.state ?? null;
  const repairAction = repairJob?.state === "IMPLEMENTING" ? "ENQUEUED" : "BLOCKED";
  const blockerCode = repairJob
    ? (repairJob.state === "BLOCKED" ? "generation_repair_spec_lineage_missing" : null)
    : ownerComponentId ? "automation_repair_enqueue_blocked" : "automation_owner_component_required";
  await tx(db, async (client) => {
    await client.query("update browser_automation_definition set status='REPAIR_REQUIRED',updated_at=now() where id=$1", [definitionId]);
    await appendAudit(client, {
      eventType: "browser_automation.repair.requested",
      actorType: "admin",
      actorId,
      objectType: "browser_automation_definition",
      objectId: definitionId,
      after: {
        ownerComponentId,
        repairAction,
        repairJobId: repairJob?.id ?? null,
        repairState,
        blockerCode,
        revisionId: preflight.revisionId,
        digest: preflight.digest
      },
      correlationId
    });
  });
  return {
    ...preflight,
    repair: repairAction,
    repairJobId: repairJob?.id ?? null,
    repairJobState: repairState,
    repairAuthorityKind: repairJob?.authorityKind ?? null,
    ownerComponentId,
    blockerCode,
    activationRequired: repairAction === "ENQUEUED",
    previousStatus: String(result.rows[0].status)
  };
}

export async function readBrowserAutomationArtifact(db: Queryable, config: AutomationConfig, runId: string, artifactId: string): Promise<{ contentType: string; body: Buffer }> {
  const result = await db.query("select a.storage_key,a.content_type from browser_automation_artifact a where a.id=$1 and a.run_id=$2", [artifactId, runId]);
  if (!result.rowCount) fail("not_found", 404);
  const root = path.resolve(config.GENERATION_ROOT); const target = path.resolve(root, String(result.rows[0].storage_key));
  if (!target.startsWith(`${root}${path.sep}`)) fail("artifact_path_invalid", 500);
  return { contentType: String(result.rows[0].content_type ?? "application/octet-stream"), body: await readFile(target) };
}
