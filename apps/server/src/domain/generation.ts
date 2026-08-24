import { createHash, randomUUID } from "node:crypto";
import type { GenerationRouteConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { generatedInputSecretName, generationSecretGrantElementKeys, normalizeGenerationSecretName, reconcileGenerationPlanSecrets } from "../generation/generation-secret-plan.mjs";
import { grantGenerationSecretBeforeResume, resumeGenerationAfterSatisfiedInputs } from "../generation/generation-secret-grant-control.mjs";
import { appendDiscussionEvent, createDiscussionMessage } from "./generation-discussion.js";
import { appendAudit } from "./audit.js";
import {
  createSecret,
  grantSecret,
  listSecretGrants,
  listSecrets,
  platformWorkerSecretPrincipal,
  resolveSecret,
  rotateSecret,
  setSecretStatus
} from "./secret-manager.js";

export const GENERATION_STATES = [
  "DISCUSSING", "ANALYZING", "IMPLEMENTING", "INTEGRATING", "VALIDATING",
  "CML_CONFORMANCE", "ACTIVATING", "COMPLETED", "FAILED", "BLOCKED", "CANCELLED"
] as const;
export type GenerationState = typeof GENERATION_STATES[number];

export class GenerationCancelledError extends Error {
  constructor() { super("generation_job_cancelled"); this.name = "GenerationCancelledError"; }
}
export function isGenerationCancelledError(error: unknown): boolean {
  return error instanceof GenerationCancelledError || (error instanceof Error && error.message === "generation_job_cancelled");
}
export async function assertGenerationNotCancelled(db: Db, jobId: string): Promise<void> {
  const result = await db.query("select state from generation_job where id=$1", [jobId]);
  if (!result.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  if (String(result.rows[0].state) === "CANCELLED") throw new GenerationCancelledError();
}

export type GenerationInputKind = "TEXT" | "URL" | "EMAIL" | "PHONE" | "PASSWORD" | "API_KEY" | "SECRET" | "RULE";
export type GenerationPlan = {
  understoodIntent: string;
  resultSummary: string;
  elements: Array<{
    key: string;
    kind: "MCP_SERVER" | "AI_AGENT";
    displayName: string;
    businessPurpose: string;
    responsibilities: string[];
    requiredSecretNames?: string[];
    providerGeneratedSecretNames?: string[];
  }>;
  dependencies: Array<{ from: string; to: string; purpose: string; sourceTool: string; targetTools: string[] }>;
  missingInputs: Array<{
    key: string;
    label: string;
    description: string;
    kind: GenerationInputKind;
    required: boolean;
    secret: boolean;
    /** Explicit proof that this value cannot be derived from the platform or provider documentation. */
    ownerRequired?: boolean;
    /** Human-readable, non-secret reason shown to the OWNER. */
    ownerReason?: string;
    derivationSource?: "OWNER" | "PLATFORM_RESEARCH" | "PROVIDER_INTEGRATION";
    stableSecretName?: string;
    grantToElementKeys?: string[];
  }>;
};

export type GenerationJobView = {
  id: string;
  jobKind: "CREATE" | "REPAIR" | "RETRY";
  authorityKind: "OWNER_APPROVED" | "INHERITED_TECHNICAL" | null;
  authoritySourceJobId: string | null;
  authoritySourceSpecRevisionId: string | null;
  authoritySpecDigest: string | null;
  parentJobId: string | null;
  runSequence: number;
  operatorPrompt: string | null;
  repairComponentId: string | null;
  ownerAdminId: string;
  originalPrompt: string;
  state: GenerationState;
  currentSpecRevisionId: string | null;
  approvedSpecRevisionId: string | null;
  approvedSpecDigest: string | null;
  plan: GenerationPlan | null;
  inputs: Array<{
    id: string; key: string; label: string; description: string; kind: GenerationInputKind; required: boolean; secret: boolean;
    stableSecretName: string | null; grantElementKeys: string[]; supplied: boolean;
  }>;
  events: Array<{ id: number; phase: string; eventType: string; message: string; details: Record<string, unknown>; createdAt: string }>;
  components: Array<{ componentId: string; elementKey: string; elementKind: string; code: string; hostname: string; displayName: string }>;
  resultSummary: Record<string, unknown> | null;
  integrationPlan: { required: boolean; summary: string; steps: string[] } | null;
  workspacePath: string | null;
  blockerSummary: string | null;
  remediationAttempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  eventCursor: number;
};

export { generationSecretGrantElementKeys, normalizeGenerationSecretName };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

const DERIVABLE_INPUT = /\b(host(name)?|server|port|protocol|tls|ssl|timeout|region|endpoint|base\s*url|imap|smtp)\b/i;

/**
 * The planner is advisory; this server-side gate is authoritative.  It keeps
 * provider/platform facts out of the OWNER questionnaire and requires a
 * concrete reason for every value we do ask for.
 */
export function ownerRequiredInputs(inputs: GenerationPlan["missingInputs"]): GenerationPlan["missingInputs"] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = input.key.trim();
    const reason = input.ownerReason?.trim() ?? "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (!input.required || input.ownerRequired === false || input.derivationSource === "PLATFORM_RESEARCH" || input.derivationSource === "PROVIDER_INTEGRATION") return false;
    if (DERIVABLE_INPUT.test(`${input.key} ${input.label} ${input.description}`)) return false;
    // Legacy plans did not carry the proof fields. They remain usable only for
    // credentials/account identity/business rules, never infrastructure data.
    if (input.ownerRequired === true && !reason) return false;
    return true;
  }).map((input) => ({ ...input, key: input.key.trim(), ownerReason: input.ownerReason?.trim() || undefined }));
}

function state(value: unknown): GenerationState {
  const text = String(value);
  if (!GENERATION_STATES.includes(text as GenerationState)) throw new Error(`invalid_generation_state:${text}`);
  return text as GenerationState;
}

export async function appendGenerationEvent(db: Db, jobId: string, phase: string, eventType: string, message: string, details: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    "insert into generation_job_event(job_id,phase,event_type,message,details) values ($1,$2,$3,$4,$5::jsonb)",
    [jobId, phase, eventType, message, JSON.stringify(details)]
  );
}

export async function getGenerationJob(db: Db, jobId: string): Promise<GenerationJobView> {
  const job = await db.query("select * from generation_job where id=$1", [jobId]);
  if (!job.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  const inputs = await db.query("select * from generation_job_input where job_id=$1 order by created_at,input_key", [jobId]);
  const events = await db.query("select * from generation_job_event where job_id=$1 order by id", [jobId]);
  const components = await db.query(
    `select gc.component_id,gc.element_key,gc.element_kind,c.code,c.hostname,c.display_name
       from generation_component gc join component c on c.id=gc.component_id where gc.job_id=$1 order by gc.created_at`, [jobId]
  );
  const row = job.rows[0]; const eventCursor = await db.query("select coalesce(max(sequence),0)::bigint cursor from generation_event where job_id=$1", [jobId]);
  return {
    id: String(row.id), jobKind: String(row.job_kind ?? "CREATE") as "CREATE" | "REPAIR" | "RETRY",
    authorityKind: row.authority_kind ? String(row.authority_kind) as "OWNER_APPROVED" | "INHERITED_TECHNICAL" : null,
    authoritySourceJobId: row.authority_source_job_id ? String(row.authority_source_job_id) : null,
    authoritySourceSpecRevisionId: row.authority_source_spec_revision_id ? String(row.authority_source_spec_revision_id) : null,
    authoritySpecDigest: row.authority_spec_digest ? String(row.authority_spec_digest) : null,
    parentJobId: row.parent_job_id ? String(row.parent_job_id) : null, runSequence: Number(row.run_sequence ?? 1),
    operatorPrompt: row.operator_prompt ? String(row.operator_prompt) : null, repairComponentId: row.repair_component_id ? String(row.repair_component_id) : null,
    ownerAdminId: String(row.owner_admin_id), originalPrompt: String(row.original_prompt), state: state(row.state),
    currentSpecRevisionId: row.current_spec_revision_id ? String(row.current_spec_revision_id) : null,
    approvedSpecRevisionId: row.approved_spec_revision_id ? String(row.approved_spec_revision_id) : null,
    approvedSpecDigest: row.approved_spec_digest ? String(row.approved_spec_digest) : null,
    plan: row.plan as GenerationPlan | null,
    inputs: inputs.rows.map((input) => ({
      id: String(input.id), key: String(input.input_key), label: String(input.label), description: String(input.description),
      kind: String(input.input_kind) as GenerationInputKind, required: Boolean(input.required), secret: Boolean(input.secret),
      stableSecretName: input.stable_secret_name ? String(input.stable_secret_name) : null,
      grantElementKeys: stringArray(input.grant_element_keys), supplied: Boolean(input.supplied_at)
    })),
    events: events.rows.map((event) => ({ id: Number(event.id), phase: String(event.phase), eventType: String(event.event_type), message: String(event.message), details: (event.details ?? {}) as Record<string, unknown>, createdAt: new Date(event.created_at).toISOString() })),
    components: components.rows.map((component) => ({ componentId: String(component.component_id), elementKey: String(component.element_key), elementKind: String(component.element_kind), code: String(component.code), hostname: String(component.hostname), displayName: String(component.display_name) })),
    resultSummary: row.result_summary as Record<string, unknown> | null,
    integrationPlan: row.integration_plan as { required: boolean; summary: string; steps: string[] } | null,
    workspacePath: row.workspace_path ? String(row.workspace_path) : null,
    blockerSummary: row.blocker_summary ? String(row.blocker_summary) : null,
    remediationAttempts: Number(row.remediation_attempts), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, eventCursor: Number(eventCursor.rows[0]?.cursor ?? 0)
  };
}

export async function listGenerationJobs(db: Db, ownerAdminId?: string): Promise<GenerationJobView[]> {
  const result = await db.query(`select id from generation_job ${ownerAdminId ? "where owner_admin_id=$1" : ""} order by created_at desc limit 50`, ownerAdminId ? [ownerAdminId] : []);
  return Promise.all(result.rows.map((row) => getGenerationJob(db, String(row.id))));
}

export async function createGenerationJob(db: Db, ownerAdminId: string, prompt: string, correlationId: string, clientRequestId?: string): Promise<{ job: GenerationJobView; idempotent: boolean }> {
  const normalized = prompt.trim();
  if (normalized.length < 3 || normalized.length > 50_000) throw Object.assign(new Error("invalid_generation_prompt"), { statusCode: 400 });
  const result = await tx(db, async (client) => {
    if (clientRequestId) {
      const replay = await client.query("select id,original_prompt from generation_job where owner_admin_id=$1 and client_request_id=$2 for update", [ownerAdminId, clientRequestId]);
      if (replay.rowCount) {
        if (String(replay.rows[0].original_prompt) !== normalized) throw Object.assign(new Error("generation_job_idempotency_conflict"), { statusCode: 409 });
        return { id: String(replay.rows[0].id), idempotent: true };
      }
    }
    const inserted = await client.query("insert into generation_job(owner_admin_id,original_prompt,state,client_request_id) values ($1,$2,'DISCUSSING',$3) returning id", [ownerAdminId, normalized, clientRequestId ?? null]);
    const jobId = String(inserted.rows[0].id);
    const message = await createDiscussionMessage(client, jobId, "OWNER", normalized, null, `initial:${jobId}`);
    const turn = await client.query("insert into generation_discussion_turn(job_id,input_message_id,status) values ($1,$2,'QUEUED') returning id", [jobId, message.id]);
    await client.query("update generation_job_message set turn_id=$2 where id=$1", [message.id, turn.rows[0].id]);
    await appendDiscussionEvent(client, jobId, "discussion.turn.queued", { turnId: String(turn.rows[0].id), messageId: message.id, initial: true });
    await appendDiscussionEvent(client, jobId, "generation.state.changed", { state: "DISCUSSING" });
    return { id: jobId, idempotent: false };
  });
  if (!result.idempotent) {
    await appendGenerationEvent(db, result.id, "DISCUSSING", "generation.created", "Zadání bylo přijato do persistentní diskuse.");
    await appendAudit(db, { eventType: "generation_job.created", actorType: "admin", actorId: ownerAdminId, objectType: "generation_job", objectId: result.id, after: { promptLength: normalized.length }, correlationId });
  }
  return { job: await getGenerationJob(db, result.id), idempotent: result.idempotent };
}

const FOLLOW_UP_SOURCE_STATES: GenerationState[] = ["FAILED", "BLOCKED", "CANCELLED"];

/** Create a new, linked run; the source job and its evidence remain immutable. */
export async function createGenerationFollowUpJob(
  db: Db, sourceJobId: string, ownerAdminId: string, instruction: string, correlationId: string
): Promise<GenerationJobView> {
  const normalized = instruction.trim();
  if (normalized.length < 3 || normalized.length > 50_000) throw Object.assign(new Error("invalid_generation_follow_up_instruction"), { statusCode: 400 });
  const id = await tx(db, async (client) => {
    const source = await client.query("select * from generation_job where id=$1 and owner_admin_id=$2 for update", [sourceJobId, ownerAdminId]);
    if (!source.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    const row = source.rows[0];
    if (!FOLLOW_UP_SOURCE_STATES.includes(state(row.state))) throw Object.assign(new Error("generation_follow_up_not_available"), { statusCode: 409 });
    const components = await client.query(
      `select gc.component_id,gc.element_key,gc.element_kind,c.active_revision_id,c.lifecycle_state,c.activation_state,c.operational_state,c.monitoring_state,c.enabled,c.ingress_enabled,c.pulse_enabled,c.egress_enabled,
              release.id active_release_id
         from generation_component gc join component c on c.id=gc.component_id
         left join lateral (select id from local_component_release where component_id=c.id and state='ACTIVE' order by activated_at desc limit 1) release on true
        where gc.job_id=$1 order by gc.created_at`, [sourceJobId]
    );
    const active = components.rows.find((component) => component.active_revision_id && component.active_release_id);
    const duplicate = await client.query(
      `select id from generation_job where parent_job_id=$1 and state not in ('COMPLETED','FAILED','BLOCKED','CANCELLED') limit 1`, [sourceJobId]
    );
    if (duplicate.rowCount) throw Object.assign(new Error("generation_follow_up_already_running"), { statusCode: 409 });
    const sequence = await client.query("select coalesce(max(run_sequence),0)::int + 1 next from generation_job where parent_job_id=$1 or id=$1", [sourceJobId]);
    const kind = active ? "REPAIR" : components.rowCount ? "RETRY" : "CREATE";
    // A free-form OWNER follow-up is a semantic change until the OWNER and
    // discussion worker produce and freeze a new specification.  It must not
    // inherit a former plan or bypass the exact approved-spec authority.
    const nextState = "DISCUSSING";
    const prompt = `${String(row.original_prompt)}\n\nOWNER follow-up instruction for run ${Number(sequence.rows[0].next)}: ${normalized}`;
    const repairEvidence = active ? {
      ...(recordValue(row.repair_evidence) ?? {}),
      _kcmlBaseComponentState: {
        activeRevisionId: String(active.active_revision_id), lifecycleState: String(active.lifecycle_state), activationState: String(active.activation_state),
        operationalState: String(active.operational_state), monitoringState: String(active.monitoring_state), enabled: Boolean(active.enabled),
        ingressEnabled: Boolean(active.ingress_enabled), pulseEnabled: Boolean(active.pulse_enabled), egressEnabled: Boolean(active.egress_enabled)
      }
    } : row.repair_evidence;
    const inserted = await client.query(
      `insert into generation_job(owner_admin_id,original_prompt,state,plan,job_kind,repair_component_id,repair_evidence,repair_base_release_id,parent_job_id,run_sequence,operator_prompt)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10,$11) returning id`,
      [ownerAdminId, prompt, nextState, row.plan ? JSON.stringify(row.plan) : null, kind, active ? active.component_id : null,
        repairEvidence ? JSON.stringify(repairEvidence) : null, active ? active.active_release_id : null,
        sourceJobId, Number(sequence.rows[0].next), normalized]
    );
    const jobId = String(inserted.rows[0].id);
    const discussionMessage = await createDiscussionMessage(client, jobId, "OWNER", normalized, null, `follow-up:${jobId}`);
    const discussionTurn = await client.query("insert into generation_discussion_turn(job_id,input_message_id,status) values ($1,$2,'QUEUED') returning id", [jobId, discussionMessage.id]);
    await client.query("update generation_job_message set turn_id=$2 where id=$1", [discussionMessage.id, discussionTurn.rows[0].id]);
    await appendDiscussionEvent(client, jobId, "discussion.turn.queued", { turnId: String(discussionTurn.rows[0].id), messageId: discussionMessage.id, followUp: true });
    await appendDiscussionEvent(client, jobId, "generation.state.changed", { state: "DISCUSSING", followUp: true });
    for (const component of components.rows) {
      await client.query("insert into generation_component(job_id,component_id,element_key,element_kind) values ($1,$2,$3,$4)", [jobId, component.component_id, component.element_key, component.element_kind]);
    }
    await client.query(
      `insert into generation_job_input(job_id,input_key,label,description,input_kind,required,secret,stable_secret_name,grant_element_keys,supplied_at,value_json)
       select $2,input_key,label,description,input_kind,required,secret,stable_secret_name,grant_element_keys,supplied_at,value_json
         from generation_job_input where job_id=$1`, [sourceJobId, jobId]
    );
    await appendAudit(client, { eventType: "generation_job.follow_up_created", actorType: "admin", actorId: ownerAdminId, objectType: "generation_job", objectId: jobId, after: { sourceJobId, runSequence: Number(sequence.rows[0].next), jobKind: kind, instructionLength: normalized.length }, correlationId });
    return jobId;
  });
  await appendGenerationEvent(db, id, "DISCUSSING", "generation.follow_up_created", "Byl vytvořen navazující běh; změna zadání musí projít novou immutable specifikací.", { sourceJobId, instructionLength: normalized.length });
  return getGenerationJob(db, id);
}

function repairEvidenceFingerprint(evidence: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown => Object.prototype.hasOwnProperty.call(evidence, key) ? evidence[key] : undefined;
  const stable = {
    source: pick("source") ?? "component_monitoring",
    probe: pick("probe") ?? pick("probeName") ?? pick("check") ?? pick("checkName") ?? null,
    status: pick("status") ?? pick("result") ?? null,
    reasonCode: pick("reasonCode") ?? pick("errorCode") ?? null,
    error: typeof pick("error") === "string" ? String(pick("error")).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>").slice(0, 500) : null
  };
  return stable;
}

export function generatedRepairTriggerKey(componentId: string, evidence: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ componentId, evidence: repairEvidenceFingerprint(evidence) })).digest("hex")}`;
}

export function automaticRepairAuthority(inheritedApprovedSpec: boolean): { state: "IMPLEMENTING" | "BLOCKED"; blockerCode: string | null } {
  return inheritedApprovedSpec
    ? { state: "IMPLEMENTING", blockerCode: null }
    : { state: "BLOCKED", blockerCode: "generation_repair_spec_lineage_missing" };
}

/**
 * The only supported generation job-creation/continuation authorities.  The
 * worker and repair enqueue paths implement these entries; this exported
 * matrix keeps the contract testable without making diagnostic text an
 * execution source of truth.
 */
export const GENERATION_EXECUTION_AUTHORITY_MATRIX = [
  { path: "CREATE", jobKind: "CREATE", semanticChange: true, authorityKind: "OWNER_APPROVED", sourceSpecification: "same-job approved immutable revision", approvalRequired: true, startState: "DISCUSSING" },
  { path: "OWNER_FOLLOW_UP", jobKind: "CREATE|RETRY|REPAIR", semanticChange: true, authorityKind: "OWNER_APPROVED", sourceSpecification: "new linked job discussion revision", approvalRequired: true, startState: "DISCUSSING" },
  { path: "TECHNICAL_RETRY", jobKind: "CREATE|RETRY|REPAIR", semanticChange: false, authorityKind: "PRESERVE_EXISTING", sourceSpecification: "current frozen authority lineage", approvalRequired: false, startState: "IMPLEMENTING" },
  { path: "AUTOMATIC_REPAIR", jobKind: "REPAIR", semanticChange: false, authorityKind: "INHERITED_TECHNICAL", sourceSpecification: "source job approved immutable revision", approvalRequired: false, startState: "IMPLEMENTING|BLOCKED" },
  { path: "REMEDIATION", jobKind: "CREATE|RETRY|REPAIR", semanticChange: false, authorityKind: "PRESERVE_EXISTING", sourceSpecification: "same job frozen authority lineage", approvalRequired: false, startState: "IMPLEMENTING" }
] as const;

export async function enqueueGeneratedRepairJob(
  db: Db,
  componentId: string,
  evidence: Record<string, unknown>,
  correlationId: string,
  cooldownMinutes = 15
): Promise<GenerationJobView | null> {
  const triggerKey = generatedRepairTriggerKey(componentId, evidence);
  const jobId = await tx(db, async (client) => {
    const component = await client.query(
      `select c.id,c.code,c.hostname,c.display_name,c.category,c.registration_type,c.active_revision_id,
              c.lifecycle_state,c.activation_state,c.operational_state,c.monitoring_state,c.enabled,c.ingress_enabled,c.pulse_enabled,c.egress_enabled,
              revision.manifest,release.id active_release_id,
              prior.job_id prior_job_id,prior.element_key,prior.owner_admin_id,prior.approved_spec_revision_id prior_approved_spec_revision_id
         from component c
         join component_revision revision on revision.id=c.active_revision_id
         left join lateral (
           select gc.job_id,gc.element_key,source_job.owner_admin_id,source_job.approved_spec_revision_id
             from generation_component gc
             join generation_job source_job on source_job.id=gc.job_id
            where gc.component_id=c.id and source_job.approved_spec_revision_id is not null
            order by gc.created_at desc
            limit 1
           ) prior on true
         left join lateral (
           select id from local_component_release where component_id=c.id and state='ACTIVE' order by activated_at desc limit 1
         ) release on true
        where c.id=$1 and c.registration_type='INTERNAL_GENERATED'
          and c.lifecycle_state='ACTIVE' and c.activation_state='ACTIVE' and c.enabled=true
        for update of c`,
      [componentId]
    );
    if (!component.rowCount) return null;
    const row = component.rows[0];
    if (!row.owner_admin_id || !row.active_release_id) return null;
    const duplicate = await client.query(
      `select id from generation_job
        where repair_component_id=$1 and job_kind='REPAIR'
          and (state not in ('COMPLETED','FAILED','BLOCKED','CANCELLED')
               or (repair_trigger_key=$2 and created_at > now()-($3||' minutes')::interval))
        order by created_at desc limit 1`,
      [componentId, triggerKey, cooldownMinutes]
    );
    if (duplicate.rowCount) return null;
    const manifest = recordValue(row.manifest) ?? {};
    const secretPolicy = recordValue(manifest.secretPolicy);
    const elementKey = String(row.element_key ?? `repair-${String(row.code).toLowerCase()}`);
    const plan: GenerationPlan = {
      understoodIntent: `Automatická oprava ${String(row.code)} podle produkční monitoring evidence.`,
      resultSummary: `Opravit existující ${String(row.code)} bez změny jeho CML identity a bez druhého control plane.`,
      elements: [{
        key: elementKey,
        kind: String(row.category) === "AI_AGENT" ? "AI_AGENT" : "MCP_SERVER",
        displayName: String(row.display_name),
        businessPurpose: typeof manifest.businessPurpose === "string" ? manifest.businessPurpose : "Repair existing generated component",
        responsibilities: ["Diagnostikovat root cause z monitoring evidence", "Zachovat veřejný kontrakt, pokud oprava nevyžaduje jeho normativní změnu"],
        requiredSecretNames: stringArray(secretPolicy?.requiredSecrets)
      }],
      dependencies: [],
      missingInputs: []
    };
    const persistedEvidence = { ...evidence, _kcmlBaseComponentState: { activeRevisionId: String(row.active_revision_id), lifecycleState: String(row.lifecycle_state), activationState: String(row.activation_state), operationalState: String(row.operational_state), monitoringState: String(row.monitoring_state), enabled: Boolean(row.enabled), ingressEnabled: Boolean(row.ingress_enabled), pulseEnabled: Boolean(row.pulse_enabled), egressEnabled: Boolean(row.egress_enabled) } };
    const inheritedSpec = row.prior_job_id && row.prior_approved_spec_revision_id
      ? await client.query(
        `select revision.spec,revision.canonical_json,revision.digest,revision.rendered_markdown
           from generation_spec_revision revision
          where revision.id=$1 and revision.job_id=$2`,
        [row.prior_approved_spec_revision_id, row.prior_job_id]
      )
      : { rowCount: 0, rows: [] };
    const authority = automaticRepairAuthority(Boolean(inheritedSpec.rowCount));
    const repairState = authority.state;
    const repairBlocker = authority.blockerCode;
    const prompt = `Automatická OWNER repair cesta pro ${String(row.code)}. Použij aktuální source/release jako základ, diagnostikuj root cause z monitoring/error evidence a proveď nejmenší úplnou opravu. Neměň CML identitu. Evidence: ${JSON.stringify(evidence)}`;
    const inserted = await client.query(
      `insert into generation_job(owner_admin_id,original_prompt,state,plan,job_kind,repair_component_id,repair_evidence,repair_base_release_id,repair_trigger_key,repair_cooldown_until,blocker_summary,blocker_code)
       values ($1,$2,$3,$4::jsonb,'REPAIR',$5,$6::jsonb,$7,$8,now()+($9||' minutes')::interval,$10,$11) returning id`,
      [row.owner_admin_id, prompt, repairState, JSON.stringify(plan), componentId, JSON.stringify({ ...persistedEvidence, repairBlocker }), row.active_release_id, triggerKey, cooldownMinutes, repairBlocker, repairBlocker]
    );
    const id = String(inserted.rows[0].id);
    await client.query(
      `insert into generation_component(job_id,component_id,element_key,element_kind)
       values ($1,$2,$3,$4)`,
      [id, componentId, elementKey, String(row.category) === "AI_AGENT" ? "AI_AGENT" : "MCP_SERVER"]
    );
    if (inheritedSpec.rowCount) {
      const source = inheritedSpec.rows[0];
      const cloned = await client.query(
        `insert into generation_spec_revision(job_id,revision,spec,canonical_json,digest,source_turn_id,source_job_id,rendered_markdown)
         values ($1,1,$2::jsonb,$3,$4,null,$6,$5) returning id`,
        [id, JSON.stringify(source.spec), String(source.canonical_json), String(source.digest), String(source.rendered_markdown ?? ""), String(row.prior_job_id)]
      );
      const clonedId = String(cloned.rows[0].id);
      await client.query(
        `update generation_job
            set current_spec_revision_id=$2,current_spec_job_id=$1,approved_spec_revision_id=$2,approved_spec_job_id=$1,
                approved_spec_digest=$3,authority_kind='INHERITED_TECHNICAL',authority_source_job_id=$4,
                authority_source_spec_revision_id=$5,authority_spec_digest=$3,discussion_closed_at=now(),updated_at=now()
          where id=$1`,
        [id, clonedId, String(source.digest), String(row.prior_job_id), String(row.prior_approved_spec_revision_id)]
      );
    }
    await appendAudit(client, {
      eventType: "generation_repair.queued", actorType: "system", objectType: "generation_job", objectId: id,
      after: { componentId, triggerKey, baseReleaseId: row.active_release_id, cooldownMinutes, evidence }, correlationId
    });
    return id;
  });
  if (!jobId) return null;
  const repairJob = await getGenerationJob(db, jobId);
  await appendGenerationEvent(db, jobId, repairJob.state, repairJob.state === "BLOCKED" ? "generation.repair_blocked" : "generation.repair_queued", repairJob.state === "BLOCKED" ? "Automatická oprava byla zablokována, protože funkční lineage nemá přesnou schválenou specifikaci; je nutná nová OWNER diskuse." : "Monitoring zjistil závadu; byl založen řízený AI repair job s inherited technical authority.", { componentId, triggerKey, inheritedSpec: repairJob.state === "IMPLEMENTING" });
  return repairJob;
}

export async function setGenerationNeedsInput(
  db: Db,
  jobId: string,
  inputs: GenerationPlan["missingInputs"],
  blocker: string,
  resumeState: "IMPLEMENTING" | "INTEGRATING" = "IMPLEMENTING"
): Promise<void> {
  inputs = ownerRequiredInputs(inputs);
  const jobRow = await db.query("select owner_admin_id,plan from generation_job where id=$1", [jobId]);
  if (!jobRow.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  const ownerAdminId = String(jobRow.rows[0].owner_admin_id);
  const plan = (jobRow.rows[0].plan ?? { elements: [] }) as GenerationPlan;
  const activeSecrets = new Set((await listSecrets(db)).filter((secret) => secret.status === "ACTIVE" && !secret.deletedAt).map((secret) => secret.stableName));
  const normalizedInputs = [] as Array<GenerationPlan["missingInputs"][number] & { normalizedSecretName: string | null; alreadyAvailable: boolean }>;
  for (const input of inputs) {
    const secretName = input.secret ? normalizeGenerationSecretName(input.stableSecretName?.trim() || generatedInputSecretName(jobId, input.key)) : null;
    const alreadyAvailable = Boolean(secretName && activeSecrets.has(secretName));
    const grantToElementKeys = secretName
      ? Array.from(new Set([...(input.grantToElementKeys ?? []), ...generationSecretGrantElementKeys(plan, secretName)]))
      : input.grantToElementKeys;
    // During INTEGRATING the candidate identities already exist. An ACTIVE secret must
    // receive all deterministic component grants before the job is allowed to resume.
    if (alreadyAvailable && secretName) {
      const granted = await grantGenerationSecretToElements(db, ownerAdminId, jobId, secretName, grantToElementKeys ?? [], randomUUID());
      if (!granted) throw new Error(`generation_secret_missing:${secretName}`);
    }
    normalizedInputs.push({ ...input, grantToElementKeys, normalizedSecretName: secretName, alreadyAvailable });
  }
  let needsOwnerInput = false;
  await tx(db, async (client) => {
    for (const input of normalizedInputs) {
      await client.query(
        `insert into generation_job_input(job_id,input_key,label,description,input_kind,required,secret,stable_secret_name,grant_element_keys,supplied_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],case when $10 then now() else null end)
         on conflict(job_id,input_key) do update set label=excluded.label,description=excluded.description,input_kind=excluded.input_kind,
           required=excluded.required,secret=excluded.secret,stable_secret_name=excluded.stable_secret_name,grant_element_keys=excluded.grant_element_keys,
           supplied_at=case when $10 then coalesce(generation_job_input.supplied_at,now()) else generation_job_input.supplied_at end`,
        [jobId, input.key, input.label, input.description, input.kind, input.required, input.secret, input.normalizedSecretName, input.grantToElementKeys ?? [], input.alreadyAvailable]
      );
    }
    const missing = await client.query("select count(*)::int n from generation_job_input where job_id=$1 and required and supplied_at is null", [jobId]);
    needsOwnerInput = Number(missing.rows[0].n) > 0;
    const next = needsOwnerInput ? "BLOCKED" : resumeState;
    const updated = await client.query("update generation_job set state=$2,blocker_code=case when $2='BLOCKED' then 'OWNER_INPUT_REQUIRED' else null end,blocker_origin_state=case when $2='BLOCKED' then $3 else null end,resume_state=case when $2='BLOCKED' then $3 else null end,blocker_summary=case when $2='BLOCKED' then $4 else null end,updated_at=now(),lease_owner=null,lease_until=null where id=$1 and state<>'CANCELLED' returning id", [jobId, next, resumeState, blocker]);
    if (!updated.rowCount) throw new GenerationCancelledError();
  });
  if (needsOwnerInput) {
    await appendGenerationEvent(db, jobId, "BLOCKED", "generation.owner_input_required", "Job je dočasně blokován, protože vyžaduje skutečně chybějící OWNER údaj nebo credential.", { blocker, inputs: normalizedInputs.filter((input) => !input.alreadyAvailable).map((input) => input.key), resumeState });
  } else {
    await appendGenerationEvent(db, jobId, resumeState, "generation.inputs_reused", "Požadované secrets již existují v KajovoCML Secret Manageru; OWNER vstup není potřeba a job pokračuje.", { reusedSecrets: normalizedInputs.filter((input) => input.alreadyAvailable).map((input) => input.normalizedSecretName).filter(Boolean) });
  }
}

export async function setGenerationState(db: Db, jobId: string, next: GenerationState, params: { blocker?: string | null; result?: Record<string, unknown> | null; workspacePath?: string | null; revisionPoint?: string | null; remediationAttempts?: number } = {}): Promise<void> {
  if (next === "CANCELLED") throw new Error("generation_cancel_must_use_owner_operation");
  const updated = await db.query(
    `update generation_job set state=$2,blocker_summary=$3,result_summary=coalesce($4::jsonb,result_summary),
       workspace_path=coalesce($5,workspace_path),revision_point=coalesce($6,revision_point),
       remediation_attempts=coalesce($7,remediation_attempts),updated_at=now(),lock_version=lock_version+1,
       completed_at=case when $2='COMPLETED' then now() else completed_at end
     where id=$1 and state<>'CANCELLED' returning id`,
    [jobId, next, params.blocker ?? null, params.result ? JSON.stringify(params.result) : null, params.workspacePath ?? null, params.revisionPoint ?? null, params.remediationAttempts ?? null]
  );
  if (!updated.rowCount) throw new GenerationCancelledError();
}

export async function setGenerationPlan(db: Db, jobId: string, planInput: GenerationPlan): Promise<void> {
  if (!planInput.elements.length) throw new Error("generation_plan_has_no_elements");
  const keys = new Set(planInput.elements.map((element) => element.key));
  for (const dependency of planInput.dependencies) {
    if (!keys.has(dependency.from) || !keys.has(dependency.to) || dependency.from === dependency.to) throw new Error("generation_dependency_invalid");
    if (!Array.isArray(dependency.targetTools) || dependency.targetTools.length === 0 || dependency.targetTools.some((tool) => !tool.trim())) throw new Error(`generation_dependency_target_tools_required:${dependency.from}:${dependency.to}`);
    if (!dependency.sourceTool?.trim()) throw new Error(`generation_dependency_source_tool_required:${dependency.from}:${dependency.to}`);
  }
  const active = await db.query("select stable_name from secret_record where status='ACTIVE' and deleted_at is null");
  const reconciled = reconcileGenerationPlanSecrets({ ...planInput, missingInputs: ownerRequiredInputs(planInput.missingInputs) }, { jobId, activeSecretNames: active.rows.map((row) => String(row.stable_name)) });
  const plan = reconciled.plan;
  await tx(db, async (client) => {
    const planned = await client.query("update generation_job set plan=$2::jsonb,updated_at=now(),lock_version=lock_version+1 where id=$1 and state<>'CANCELLED' returning id", [jobId, JSON.stringify(plan)]);
    if (!planned.rowCount) throw new GenerationCancelledError();
    await client.query("delete from generation_job_input where job_id=$1", [jobId]);
    for (const input of plan.missingInputs) {
      const secretName = input.secret ? normalizeGenerationSecretName(input.stableSecretName) : null;
      const grantKeys = input.secret && secretName ? Array.from(new Set([...(input.grantToElementKeys ?? []), ...generationSecretGrantElementKeys(plan, secretName)])) : [];
      const alreadyAvailable = Boolean(secretName && reconciled.activeSecretNames.has(secretName));
      await client.query(
        `insert into generation_job_input(job_id,input_key,label,description,input_kind,required,secret,stable_secret_name,grant_element_keys,supplied_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],case when $10 then now() else null end)`,
        [jobId, input.key, input.label, input.description, input.kind, input.required, input.secret, secretName, grantKeys, alreadyAvailable]
      );
    }
    const required = await client.query("select count(*)::int n from generation_job_input where job_id=$1 and required and supplied_at is null", [jobId]);
    const moved = await client.query("update generation_job set state=$2,blocker_code=case when $3 then 'OWNER_INPUT_REQUIRED' else null end,blocker_origin_state=case when $3 then 'ANALYZING' else null end,resume_state=case when $3 then 'ANALYZING' else null end,updated_at=now() where id=$1 and state<>'CANCELLED' returning id", [jobId, Number(required.rows[0].n) ? "BLOCKED" : "IMPLEMENTING", Number(required.rows[0].n) > 0]);
    if (!moved.rowCount) throw new GenerationCancelledError();
  });
  await appendGenerationEvent(db, jobId, "ANALYZING", "generation.implementation_input_ready", "Schválená specifikace byla převedena na technický implementation input; pipeline pokračuje bez druhého OWNER schválení.", {
    elements: plan.elements.map((element) => element.key),
    missingInputCount: reconciled.unsatisfiedRequiredInputs.length,
    reusedSecrets: Array.from(reconciled.activeSecretNames).filter((name) => generationSecretGrantElementKeys(plan, name).length > 0)
  });
}

export async function ensurePlatformOpenAiSecret(db: Db, config: GenerationRouteConfig, ownerAdminId: string, value: string, correlationId: string): Promise<void> {
  const secrets = await listSecrets(db);
  const current = secrets.find((secret) => secret.stableName === "OPENAI_API_KEY" && !secret.deletedAt);
  const secret = current
    ? await rotateSecret(db, config, ownerAdminId, correlationId, current.id, { value, expectedVersion: current.lockVersion })
    : await createSecret(db, config, ownerAdminId, correlationId, { stableName: "OPENAI_API_KEY", displayName: "OpenAI API key pro Generování", description: "Modelová integrace interní generation pipeline.", value, ownerKind: "PLATFORM", ownerId: null });
  const platform = await platformWorkerSecretPrincipal(db);
  await grantSecret(db, ownerAdminId, correlationId, secret.id, { principalKind: "PLATFORM", principalId: platform.id, principalPublicId: platform.publicId });
}

export type GenerationOpenAiReadinessReason =
  | "READY"
  | "MISSING"
  | "DELETED"
  | "INACTIVE"
  | "ACTIVE_VERSION_MISSING"
  | "PLATFORM_PRINCIPAL_UNAVAILABLE"
  | "PLATFORM_GRANT_MISSING"
  | "RESOLVE_FAILED";

export type GenerationOpenAiReadiness = {
  ready: boolean;
  reason: GenerationOpenAiReadinessReason;
  stableName: "OPENAI_API_KEY";
  secretExists: boolean;
  secretStatus: string | null;
  activeVersion: boolean;
  platformPrincipal: { id: string; publicId: string } | null;
  platformGrant: boolean;
  canonicalResolve: "PASS" | "FAIL" | "NOT_ATTEMPTED";
};

type GenerationSecretResolverConfig = Pick<GenerationRouteConfig, "CONFIG_VAULT_MASTER_KEY_BASE64" | "CONFIG_VAULT_MASTER_KEY_ID">;

/**
 * Inspect the single canonical OpenAI credential without exposing a value. A generation
 * worker may use it only through the PLATFORM identity's direct (not global) grant, so an
 * ACTIVE record alone is deliberately not considered ready.
 */
export async function generationOpenAiReadiness(db: Db, config: GenerationSecretResolverConfig): Promise<GenerationOpenAiReadiness> {
  const stableName = "OPENAI_API_KEY" as const;
  const secret = (await listSecrets(db)).find((item) => item.stableName === stableName);
  const base = {
    stableName,
    secretExists: Boolean(secret),
    secretStatus: secret?.status ?? null,
    activeVersion: Boolean(secret?.activeVersionId),
    platformPrincipal: null as { id: string; publicId: string } | null,
    platformGrant: false,
    canonicalResolve: "NOT_ATTEMPTED" as const
  };
  if (!secret) return { ...base, ready: false, reason: "MISSING" };
  if (secret.deletedAt || secret.status === "DELETED") return { ...base, ready: false, reason: "DELETED" };
  if (secret.status !== "ACTIVE") return { ...base, ready: false, reason: "INACTIVE" };
  if (!secret.activeVersionId) return { ...base, ready: false, reason: "ACTIVE_VERSION_MISSING" };

  let platform;
  try {
    platform = await platformWorkerSecretPrincipal(db);
  } catch {
    return { ...base, ready: false, reason: "PLATFORM_PRINCIPAL_UNAVAILABLE" };
  }
  const withPrincipal = { ...base, platformPrincipal: { id: platform.id ?? "", publicId: platform.publicId } };
  const grants = await listSecretGrants(db, secret.id);
  const directGrant = grants.some((grant) => grant.principalKind === "PLATFORM"
    && grant.principalId === platform.id
    && grant.principalPublicId === platform.publicId
    && grant.allSecrets === false
    && grant.revokedAt === null);
  if (!directGrant) return { ...withPrincipal, ready: false, reason: "PLATFORM_GRANT_MISSING" };

  try {
    // Exercise the normal resolver, discard the value immediately, and never return/log it.
    await resolveGenerationSecret(db, config, stableName);
    return { ...withPrincipal, platformGrant: true, canonicalResolve: "PASS", ready: true, reason: "READY" };
  } catch {
    return { ...withPrincipal, platformGrant: true, canonicalResolve: "FAIL", ready: false, reason: "RESOLVE_FAILED" };
  }
}

export async function generationOpenAiReady(db: Db, config: GenerationSecretResolverConfig): Promise<boolean> {
  return (await generationOpenAiReadiness(db, config)).ready;
}

/** Reconcile only a missing direct PLATFORM grant; this never creates or rotates a credential. */
export async function reconcileGenerationOpenAiReadiness(db: Db, config: GenerationSecretResolverConfig, ownerAdminId: string, correlationId: string): Promise<GenerationOpenAiReadiness> {
  const before = await generationOpenAiReadiness(db, config);
  if (before.reason === "PLATFORM_GRANT_MISSING") {
    await ensureGenerationPlatformSecretGrant(db, ownerAdminId, "OPENAI_API_KEY", correlationId);
  }
  return generationOpenAiReadiness(db, config);
}

export async function ensureGenerationPlatformSecretGrant(db: Db, ownerAdminId: string, stableNameInput: string, correlationId: string): Promise<boolean> {
  const stableName = normalizeGenerationSecretName(stableNameInput);
  const secrets = await listSecrets(db);
  const secret = secrets.find((item) => item.stableName === stableName && item.status === "ACTIVE" && !item.deletedAt);
  if (!secret) return false;
  const platform = await platformWorkerSecretPrincipal(db);
  await grantSecret(db, ownerAdminId, correlationId, secret.id, { principalKind: "PLATFORM", principalId: platform.id, principalPublicId: platform.publicId });
  return true;
}

export async function grantGenerationSecretToElements(
  db: Db,
  ownerAdminId: string,
  jobId: string,
  stableNameInput: string,
  elementKeys: string[],
  correlationId: string
): Promise<boolean> {
  const result = await grantGenerationSecretBeforeResume({
    stableSecretName: stableNameInput,
    elementKeys,
    findActiveSecret: async (stableName) => {
      const secrets = await listSecrets(db);
      return secrets.find((item) => item.stableName === stableName && item.status === "ACTIVE" && !item.deletedAt) ?? null;
    },
    grantPlatform: async (secret) => {
      const platform = await platformWorkerSecretPrincipal(db);
      await grantSecret(db, ownerAdminId, correlationId, secret.id, { principalKind: "PLATFORM", principalId: platform.id, principalPublicId: platform.publicId });
    },
    listComponents: async (keys) => {
      const components = await db.query(
        `select gc.element_key,gc.component_id,c.code
           from generation_component gc join component c on c.id=gc.component_id
          where gc.job_id=$1 and gc.element_key=any($2::text[])`,
        [jobId, keys]
      );
      return components.rows.map((row) => ({ componentId: String(row.component_id), code: String(row.code), elementKey: String(row.element_key) }));
    },
    grantComponent: async (secret, component) => {
      await grantSecret(db, ownerAdminId, correlationId, secret.id, { principalKind: "COMPONENT", principalId: component.componentId, principalPublicId: component.code });
    }
  });
  return result.available;
}

export async function resolveGenerationSecret(db: Db, config: GenerationSecretResolverConfig, stableName: string, correlationId: string = randomUUID()): Promise<string> {
  const principal = await platformWorkerSecretPrincipal(db);
  return (await resolveSecret(db, config, principal, stableName, correlationId)).value;
}

export async function upsertGenerationSecret(db: Db, config: GenerationRouteConfig, ownerAdminId: string, jobId: string, correlationId: string, input: {
  stableSecretName: string; value: string; displayName?: string; description?: string; grantToElementKeys?: string[];
}): Promise<{ stableName: string; fingerprint: string | null; version: number | null; grantedElementKeys: string[] }> {
  const stableName = normalizeGenerationSecretName(input.stableSecretName);
  const job = await getGenerationJob(db, jobId);
  if (!job.plan) throw new Error("generation_plan_missing");
  const secrets = await listSecrets(db);
  const current = secrets.find((secret) => secret.stableName === stableName && !secret.deletedAt);
  let secret = current
    ? await rotateSecret(db, config, ownerAdminId, correlationId, current.id, { value: input.value, expectedVersion: current.lockVersion })
    : await createSecret(db, config, ownerAdminId, correlationId, { stableName, displayName: input.displayName?.trim() || stableName, description: input.description?.trim() || `Credential uložený během integrační fáze generation jobu ${jobId}.`, value: input.value, ownerKind: "PLATFORM", ownerId: null });
  if (secret.status !== "ACTIVE") secret = await setSecretStatus(db, ownerAdminId, correlationId, secret.id, secret.lockVersion, "ACTIVE");
  const derived = generationSecretGrantElementKeys(job.plan, stableName);
  const grantKeys = Array.from(new Set([...(input.grantToElementKeys ?? []), ...derived]));
  const granted = await grantGenerationSecretToElements(db, ownerAdminId, jobId, stableName, grantKeys, correlationId);
  if (!granted) throw new Error(`generation_secret_not_active_after_upsert:${stableName}`);
  await db.query("update generation_job_input set supplied_at=coalesce(supplied_at,now()) where job_id=$1 and stable_secret_name=$2", [jobId, stableName]);
  await appendAudit(db, { eventType: current ? "generation.secret_rotated" : "generation.secret_created", actorType: "admin", actorId: ownerAdminId, objectType: "generation_job", objectId: jobId, after: { stableName, fingerprint: secret.activeFingerprint, version: secret.activeVersionNumber, grantedElementKeys: grantKeys }, correlationId });
  return { stableName, fingerprint: secret.activeFingerprint, version: secret.activeVersionNumber, grantedElementKeys: grantKeys };
}

async function grantSatisfiedGenerationSecretsBeforeResume(db: Db, ownerAdminId: string, jobId: string, correlationId: string): Promise<void> {
  const job = await getGenerationJob(db, jobId);
  if (!job.plan) return;
  const rows = await db.query(
    "select stable_secret_name,grant_element_keys from generation_job_input where job_id=$1 and secret and supplied_at is not null",
    [jobId]
  );
  const grants = new Map<string, Set<string>>();
  for (const element of job.plan.elements) {
    for (const rawName of element.requiredSecretNames ?? []) {
      const name = normalizeGenerationSecretName(rawName);
      const keys = grants.get(name) ?? new Set<string>();
      keys.add(element.key);
      grants.set(name, keys);
    }
  }
  for (const row of rows.rows) {
    const name = normalizeGenerationSecretName(String(row.stable_secret_name));
    const keys = grants.get(name) ?? new Set<string>();
    for (const key of stringArray(row.grant_element_keys)) keys.add(key);
    for (const key of generationSecretGrantElementKeys(job.plan, name)) keys.add(key);
    grants.set(name, keys);
  }
  for (const [name, keys] of grants) {
    const available = await grantGenerationSecretToElements(db, ownerAdminId, jobId, name, Array.from(keys), correlationId);
    if (available) continue;
    const providerGenerated = job.plan.elements.some((element) => (element.providerGeneratedSecretNames ?? []).map(normalizeGenerationSecretName).includes(name));
    if (!providerGenerated) throw new Error(`generation_secret_missing_before_integration_resume:${name}`);
  }
}

export async function submitGenerationInputs(db: Db, config: GenerationRouteConfig, jobId: string, ownerAdminId: string, values: Record<string, unknown>, correlationId: string): Promise<GenerationJobView> {
  const inputs = await db.query("select * from generation_job_input where job_id=$1 order by created_at", [jobId]);
  if (!inputs.rowCount) return getGenerationJob(db, jobId);
  for (const input of inputs.rows) {
    if (!(String(input.input_key) in values)) continue;
    const raw = values[String(input.input_key)];
    if (input.secret) {
      if (typeof raw !== "string" || !raw.length) throw Object.assign(new Error(`invalid_generation_input:${input.input_key}`), { statusCode: 400 });
      // Reuse the same canonical upsert/grant path used by provider-issued secrets.
      // Component grants are committed before the resume-state update below, so the
      // very first resumed provider callback can resolve the credential.
      await upsertGenerationSecret(db, config, ownerAdminId, jobId, correlationId, {
        stableSecretName: String(input.stable_secret_name),
        value: raw,
        displayName: String(input.label),
        description: String(input.description),
        grantToElementKeys: stringArray(input.grant_element_keys)
      });
      await db.query("update generation_job_input set supplied_at=now(),value_json=null where id=$1", [input.id]);
    } else {
      await db.query("update generation_job_input set supplied_at=now(),value_json=$2::jsonb where id=$1", [input.id, JSON.stringify(raw)]);
    }
  }
  const missing = await db.query("select count(*)::int n from generation_job_input where job_id=$1 and required and supplied_at is null", [jobId]);
  if (!Number(missing.rows[0].n)) {
    const resume = await db.query("select resume_state from generation_job where id=$1", [jobId]);
    const resumeState = String(resume.rows[0]?.resume_state ?? "ANALYZING") as GenerationState;
    await resumeGenerationAfterSatisfiedInputs({
      resumeState,
      ensureIntegrationGrants: () => grantSatisfiedGenerationSecretsBeforeResume(db, ownerAdminId, jobId, correlationId),
      setState: (state) => setGenerationState(db, jobId, state as GenerationState, { blocker: null }),
      clearResumeState: async () => { await db.query("update generation_job set resume_state=null where id=$1", [jobId]); },
      appendCompleteEvent: (state) => appendGenerationEvent(db, jobId, state, "generation.inputs_complete", state === "INTEGRATING" ? "Chybějící integrační údaje jsou doplněné a component granty jsou aktivní; pokračuje post-deploy integrace." : "Všechny nutné údaje jsou doplněné.")
    });
  }
  await appendAudit(db, { eventType: "generation_job.inputs_submitted", actorType: "admin", actorId: ownerAdminId, objectType: "generation_job", objectId: jobId, after: { suppliedKeys: Object.keys(values) }, correlationId });
  return getGenerationJob(db, jobId);
}

export async function cancelGenerationJob(db: Db, jobId: string, ownerAdminId: string, correlationId: string): Promise<void> {
  const result = await tx(db, async (client) => {
    const cancelled = await client.query("update generation_job set state='CANCELLED',cancelled_at=now(),updated_at=now(),lease_owner=null,lease_until=null where id=$1 and owner_admin_id=$2 and state not in ('COMPLETED','CANCELLED') returning id", [jobId, ownerAdminId]);
    if (!cancelled.rowCount) throw Object.assign(new Error("generation_job_not_cancellable"), { statusCode: 409 });
    await client.query("update generation_discussion_turn set status=case when status='QUEUED' then 'CANCELLED' else 'INTERRUPT_REQUESTED' end, interrupt_requested_at=case when status in ('RUNNING','INTERRUPT_REQUESTED') then coalesce(interrupt_requested_at,now()) else interrupt_requested_at end, completed_at=case when status='QUEUED' then now() else completed_at end, lease_owner=case when status='QUEUED' then null else lease_owner end, lease_until=case when status='QUEUED' then null else lease_until end where job_id=$1 and status in ('QUEUED','RUNNING','INTERRUPT_REQUESTED')", [jobId]);
    await client.query("update generation_job_message set status='INTERRUPTED',interrupted_at=now(),content=content where job_id=$1 and role='ASSISTANT' and status='STREAMING'", [jobId]);
    return cancelled;
  });
  if (!result.rowCount) throw Object.assign(new Error("generation_job_not_cancellable"), { statusCode: 409 });
  await appendGenerationEvent(db, jobId, "CANCELLED", "generation.cancelled", "Generování bylo zrušeno vlastníkem.");
  await appendAudit(db, { eventType: "generation_job.cancelled", actorType: "admin", actorId: ownerAdminId, objectType: "generation_job", objectId: jobId, correlationId });
}
