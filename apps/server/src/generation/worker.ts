import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { queueComponentE2ERun, queueComponentHeartbeatChallenge, queueComponentStateQuery, setComponentActivation, validateComponentManifest } from "../domain/component.js";
import { processNextComponentControlDispatch } from "../onboarding/component-control-worker.js";
import { processNextComponentE2ERun } from "../onboarding/component-e2e-worker.js";
import {
  cancelGeneratedCandidateRelease,
  deployGeneratedRelease,
  ensureGeneratedRuntimeIdentity,
  grantGenerationInputSecrets,
  materializeGenerationDependencies,
  registerGeneratedRevision,
  reserveGeneratedComponents,
  verifyGeneratedComponentConformance,
  verifyGenerationDependencies,
  verifyGeneratedHttpsRuntime,
  waitForGeneratedRuntime,
  type ReservedGeneratedComponent
} from "../domain/generated-component.js";
import {
  appendGenerationEvent,
  assertGenerationNotCancelled,
  GenerationCancelledError,
  getGenerationJob,
  isGenerationCancelledError,
  resolveGenerationSecret,
  ensureGenerationPlatformSecretGrant,
  setGenerationNeedsInput,
  upsertGenerationSecret,
  setGenerationPlan,
  setGenerationState,
  type GenerationJobView
} from "../domain/generation.js";
import { implementGeneration, integrateGeneration, planGeneration, type GenerationImplementationResult } from "./openai-responses.js";
import { prepareGenerationWorkspace } from "./workspace.js";
import { runWithCancellationPolling } from "./generation-cancellation.mjs";
import { deployCandidatesBeforeIntegration, runLiveCandidateIntegration } from "./integration-phase.mjs";
import { recoverGenerationTechnicalFailure } from "./generation-failure-recovery.mjs";
import { canonicalJson, digest, generationSpecificationSchema, processNextDiscussionTurn } from "../domain/generation-discussion.js";

const ACTIVE_STATES = ["ANALYZING", "IMPLEMENTING", "INTEGRATING", "VALIDATING", "CML_CONFORMANCE", "ACTIVATING"] as const;
const MAX_REMEDIATION_ATTEMPTS = 5;
const LEASE_SECONDS = 180;

type ClaimedJob = { id: string; state: GenerationJobView["state"] };

type GeneratedArtifact = {
  component: ReservedGeneratedComponent;
  runtimeToken: string;
  revisionId: string;
  manifest: ReturnType<typeof validateComponentManifest>;
  handlerPath: string;
  manifestPath: string;
};

type WorkerTerminalRow = Record<string, unknown>;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(row: WorkerTerminalRow, key: string, fallback = ""): string {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

type GenerationFailureDiagnostic = { code: string; fingerprint: string; errors: Array<{ path: string; keyword: string; message: string }> };

function failureDiagnostic(error: unknown): GenerationFailureDiagnostic | null {
  if (!(error instanceof Error)) return null;
  const raw = (error as Error & { errors?: unknown }).errors;
  if (!Array.isArray(raw)) return null;
  const errors = raw.slice(0, 20).map((item) => {
    const value = recordValue(item) ?? {};
    return {
      path: typeof value.instancePath === "string" ? value.instancePath : "",
      keyword: typeof value.keyword === "string" ? value.keyword : "validation",
      message: typeof value.message === "string" ? value.message.slice(0, 300) : "invalid"
    };
  });
  const code = error.message || "invalid_candidate";
  return { code, errors, fingerprint: `sha256:${createHash("sha256").update(JSON.stringify({ code, errors })).digest("hex")}` };
}

async function runLocalHandlerCheck(handlerPath: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", handlerPath], { stdio: ["ignore", "pipe", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`generated_handler_syntax_failed_${code}:${Buffer.concat(errors).toString("utf8").slice(-1000)}`)));
  });
}

async function claimGenerationJob(db: Db, workerId: string): Promise<ClaimedJob | null> {
  return tx(db, async (client) => {
    const result = await client.query(
      `select id,state
         from generation_job
        where state=any($1::text[])
          and (lease_until is null or lease_until < now() or lease_owner=$2)
        order by updated_at,created_at
        for update skip locked
        limit 1`,
      [[...ACTIVE_STATES], workerId]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    await client.query(
      `update generation_job
          set lease_owner=$2,lease_until=now()+($3||' seconds')::interval,last_heartbeat_at=now(),updated_at=now()
        where id=$1`,
      [row.id, workerId, LEASE_SECONDS]
    );
    return { id: String(row.id), state: String(row.state) as GenerationJobView["state"] };
  });
}

async function heartbeatLease(db: Db, jobId: string, workerId: string): Promise<void> {
  await db.query(
    `update generation_job set lease_until=now()+($3||' seconds')::interval,last_heartbeat_at=now()
      where id=$1 and lease_owner=$2`,
    [jobId, workerId, LEASE_SECONDS]
  );
}

async function releaseLease(db: Db, jobId: string, workerId: string): Promise<void> {
  await db.query("update generation_job set lease_owner=null,lease_until=null where id=$1 and lease_owner=$2", [jobId, workerId]);
}

async function withLeaseHeartbeat<T>(db: Db, jobId: string, workerId: string, operation: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    void heartbeatLease(db, jobId, workerId).catch((error) => {
      console.error("generation_lease_heartbeat_failed", { jobId, error: error instanceof Error ? error.message : String(error) });
    });
  }, 30_000);
  timer.unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

async function withCancellationMonitor<T>(db: Db, jobId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return runWithCancellationPolling({
    assertActive: () => assertGenerationNotCancelled(db, jobId),
    isCancelled: isGenerationCancelledError,
    operation,
    pollMs: 500,
    onCheckError: (error) => console.error("generation_cancel_monitor_failed", { jobId, error: error instanceof Error ? error.message : String(error) })
  });
}

async function cancellationCheckpoint(db: Db, jobId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new GenerationCancelledError();
  await assertGenerationNotCancelled(db, jobId);
}

async function safeWorkspacePath(workspace: string, candidate: string): Promise<string> {
  const root = await realpath(workspace);
  const absolute = path.resolve(workspace, candidate);
  const parent = await realpath(path.dirname(absolute));
  const relativeParent = path.relative(root, parent);
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) throw new Error("generation_artifact_outside_workspace");
  return absolute;
}

async function normalizeGeneratedManifest(
  workspace: string,
  component: ReservedGeneratedComponent,
  handlerPathInput: string,
  manifestPathInput: string,
  jobId: string,
  config: AppConfig,
  registrationRevisionOverride?: string
): Promise<{ handlerPath: string; manifestPath: string; manifest: unknown }> {
  const handlerPath = await safeWorkspacePath(workspace, handlerPathInput);
  const manifestPath = await safeWorkspacePath(workspace, manifestPathInput);
  const handler = await readFile(handlerPath);
  const sourceDigest = sha256(handler);
  const parsed = recordValue(JSON.parse(await readFile(manifestPath, "utf8"))) ?? {};
  const artifact = recordValue(parsed.artifact) ?? {};
  const runtime = recordValue(parsed.runtime) ?? {};
  parsed.schemaVersion = "2026.07.22-compliance.1";
  // These capabilities are the platform-owned CML lifecycle contract.  They
  // are not business behavior invented by the model, so the server restores
  // the complete baseline when a model-produced manifest omits one of them.
  // This keeps candidate generation deterministic and prevents a valid JSON
  // artifact from reaching registration only to fail during activation.
  const requiredPlatformCapabilities = [
    "mcp.initialize", "mcp.notifications.initialized", "mcp.tools.list", "mcp.tools.call",
    "component.control.ack", "component.state.query", "component.heartbeat", "component.audit.write"
  ];
  const declaredCapabilities = Array.isArray(parsed.capabilities) ? parsed.capabilities.filter((value): value is string => typeof value === "string") : [];
  parsed.capabilities = [...new Set([...requiredPlatformCapabilities, ...declaredCapabilities])];
  parsed.registrationRevision = registrationRevisionOverride ?? (typeof parsed.registrationRevision === "string" && parsed.registrationRevision.trim() ? parsed.registrationRevision : "1.0.0");
  parsed.displayName = component.displayName;
  parsed.artifact = {
    ...artifact,
    type: "SOURCE_PACKAGE",
    digest: sourceDigest,
    sourceBundleDigest: sourceDigest,
    buildContract: recordValue(artifact.buildContract) ?? {
      builder: "KCML_GENERATION_WORKER",
      sourceDigest,
      entrypoint: "handler.mjs",
      manifest: "manifest.kcml.json",
      runtime: "KCML_RESTRICTED_HANDLER"
    },
    provenance: {
      ...(recordValue(artifact.provenance) ?? {}),
      issuer: `https://admin.${config.PUBLIC_BASE_DOMAIN}/generation/jobs/${jobId}`,
      source: "KCML_INTERNAL_GENERATION",
      generationJobId: jobId
    }
  };
  parsed.runtime = {
    ...runtime,
    transport: "UDS",
    runtimeDigest: sourceDigest,
    socketPath: path.join(config.RUNTIME_SOCKET_ROOT, `${component.code.toLowerCase()}.sock`)
  };
  const normalizedRuntime = recordValue(parsed.runtime) ?? {};
  if (!recordValue(normalizedRuntime.persistentState)) {
    normalizedRuntime.persistentState = {
      required: true,
      mountPath: "/var/lib/kcml-data",
      survivesRestart: true,
      survivesUpgrade: true,
      survivesRollback: true
    };
    parsed.runtime = normalizedRuntime;
  }
  await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return { handlerPath, manifestPath, manifest: parsed };
}

async function nextRepairRevision(db: Db, componentId: string): Promise<string> {
  const current = await db.query("select manifest->>'registrationRevision' revision from component_revision where id=(select active_revision_id from component where id=$1)", [componentId]);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current.rows[0]?.revision ?? "1.0.0"));
  if (!match) return "1.0.1";
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3]) + 1}`;
}

async function seedRepairWorkspace(db: Db, job: GenerationJobView, reservations: ReservedGeneratedComponent[], workspace: string): Promise<Record<string, unknown> | null> {
  if (job.jobKind !== "REPAIR") return null;
  const repair = await db.query(
    `select job.repair_evidence,release.release_path
       from generation_job job join local_component_release release on release.id=job.repair_base_release_id
      where job.id=$1`, [job.id]
  );
  if (!repair.rowCount) throw new Error("repair_base_release_missing");
  const releasePath = String(repair.rows[0].release_path);
  for (const component of reservations) {
    const elementRoot = path.join(workspace, "elements", component.elementKey);
    await mkdir(elementRoot, { recursive: true, mode: 0o750 });
    if (job.remediationAttempts === 0) {
      await cp(path.join(releasePath, "handler.mjs"), path.join(elementRoot, "handler.mjs"), { force: true });
      await cp(path.join(releasePath, "manifest.kcml.json"), path.join(elementRoot, "manifest.kcml.json"), { force: true });
    }
  }
  return (repair.rows[0].repair_evidence ?? {}) as Record<string, unknown>;
}

async function analyzeJob(db: Db, config: AppConfig, job: GenerationJobView, signal: AbortSignal): Promise<void> {
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationState(db, job.id, "ANALYZING");
  await appendGenerationEvent(db, job.id, "ANALYZING", "generation.analysis_started", "Probíhá analýza zadání a návrh výsledných prvků.");
  const openAiCorrelationId = randomUUID();
  if (!await ensureGenerationPlatformSecretGrant(db, job.ownerAdminId, "OPENAI_API_KEY", openAiCorrelationId)) throw new Error("openai_key_required");
  const apiKey = await resolveGenerationSecret(db, config, "OPENAI_API_KEY", openAiCorrelationId);
  const approved = await loadApprovedSpecification(db, job.id);
  const plan = await planGeneration(apiKey, config.GENERATION_OPENAI_MODEL, approved.plannerInput, signal);
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationPlan(db, job.id, plan);
}

async function loadApprovedSpecification(db: Db, jobId: string): Promise<{ plannerInput: string }> {
  const result = await db.query(`select job.approved_spec_digest,job.authority_kind,job.authority_source_job_id,job.authority_source_spec_revision_id,job.authority_spec_digest,
      revision.spec,revision.canonical_json,revision.digest,
      source_revision.digest source_authority_digest
    from generation_job job join generation_spec_revision revision on revision.id=job.approved_spec_revision_id and revision.job_id=job.id
    left join generation_spec_revision source_revision on source_revision.job_id=job.authority_source_job_id and source_revision.id=job.authority_source_spec_revision_id
    where job.id=$1`, [jobId]);
  if (!result.rowCount) throw new Error("generation_approved_spec_missing");
  const row = result.rows[0];
  if (!["OWNER_APPROVED", "INHERITED_TECHNICAL"].includes(String(row.authority_kind))
    || !row.authority_source_job_id || !row.authority_source_spec_revision_id
    || String(row.authority_spec_digest) !== String(row.approved_spec_digest)
    || String(row.source_authority_digest) !== String(row.approved_spec_digest)) throw new Error("generation_execution_authority_missing");
  const spec = generationSpecificationSchema.parse(row.spec);
  const canonical = canonicalJson(spec); const expected = digest(spec);
  if (canonical !== String(row.canonical_json) || expected !== String(row.digest) || expected !== String(row.approved_spec_digest)) throw new Error("generation_approved_spec_digest_mismatch");
  return { plannerInput: canonical };
}

async function waitForWorkerRecord(
  db: Db,
  sql: string,
  params: unknown[],
  terminal: (row: WorkerTerminalRow) => boolean,
  drive: () => Promise<boolean>
): Promise<WorkerTerminalRow> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await db.query(sql, params);
    const row = result.rowCount ? result.rows[0] as WorkerTerminalRow : null;
    if (row && terminal(row)) return row;
    await drive();
  }
  throw new Error("generation_cml_worker_timeout");
}

async function runProductionConformanceWorkers(db: Db, config: AppConfig, artifact: GeneratedArtifact, correlationId: string): Promise<void> {
  const e2e = await queueComponentE2ERun(db, { componentId: artifact.component.componentId, correlationId });
  const e2eId = String(e2e.id);
  const e2eResult = await waitForWorkerRecord(db, "select status,final_error_code from component_e2e_run where id=$1", [e2eId],
    (row) => ["PASS", "FAIL", "CANCELLED"].includes(String(row.status)),
    () => processNextComponentE2ERun(db, config, `generation-e2e-${artifact.component.code}`));
  if (stringField(e2eResult, "status") !== "PASS") throw new Error(`generated_e2e_worker_failed:${stringField(e2eResult, "final_error_code", "scenario_failed")}`);

  const stateDispatch = await queueComponentStateQuery(db, { componentId: artifact.component.componentId, correlationId: randomUUID() });
  const stateResult = await waitForWorkerRecord(db, "select state,final_error_code from component_control_dispatch where id=$1", [String(stateDispatch.id)],
    (row) => ["ACKED", "FAILED", "EXPIRED", "CANCELLED"].includes(String(row.state)),
    () => processNextComponentControlDispatch(db, config, `generation-control-${artifact.component.code}`));
  if (stringField(stateResult, "state") !== "ACKED") throw new Error(`generated_state_control_failed:${stringField(stateResult, "final_error_code", "not_acked")}`);

  const heartbeatDispatch = await queueComponentHeartbeatChallenge(db, { componentId: artifact.component.componentId, correlationId: randomUUID() });
  const heartbeatResult = await waitForWorkerRecord(db, "select state,final_error_code from component_control_dispatch where id=$1", [String(heartbeatDispatch.id)],
    (row) => ["ACKED", "FAILED", "EXPIRED", "CANCELLED"].includes(String(row.state)),
    () => processNextComponentControlDispatch(db, config, `generation-heartbeat-${artifact.component.code}`));
  if (stringField(heartbeatResult, "state") !== "ACKED") throw new Error(`generated_heartbeat_control_failed:${stringField(heartbeatResult, "final_error_code", "not_acked")}`);
}

function candidateTargetView(artifact: GeneratedArtifact): Record<string, unknown> {
  const webhooks = artifact.manifest.endpoints
    .filter((endpoint) => {
      const auth = recordValue(endpoint.auth);
      return (typeof auth?.mode === "string" ? auth.mode : "KCML_BEARER") === "EXTERNAL_WEBHOOK";
    })
    .map((endpoint) => ({
      key: String(endpoint.key), method: String(endpoint.method), path: String(endpoint.path),
      url: `https://${artifact.component.hostname}${String(endpoint.path)}`,
      verification: recordValue(endpoint.auth)?.verification ?? null
    }));
  return {
    elementKey: artifact.component.elementKey,
    componentId: artifact.component.componentId,
    code: artifact.component.code,
    hostname: artifact.component.hostname,
    mcpUrl: `https://${artifact.component.hostname}/mcp`,
    webhooks,
    manifest: artifact.manifest
  };
}

function integrationRequired(job: GenerationJobView, artifacts: GeneratedArtifact[], integrationPlan?: GenerationImplementationResult["integrationPlan"] | null): boolean {
  if (integrationPlan?.required) return true;
  if (job.plan?.elements.some((element) => (element.providerGeneratedSecretNames ?? []).length > 0)) return true;
  return artifacts.some((artifact) =>
    artifact.manifest.outboundPolicies.some((policy) => String(policy.type) === "HTTPS_FETCH") ||
    artifact.manifest.endpoints.some((endpoint) => {
      const auth = recordValue(endpoint.auth);
      return (typeof auth?.mode === "string" ? auth.mode : "KCML_BEARER") === "EXTERNAL_WEBHOOK";
    })
  );
}

async function loadCandidateArtifacts(
  db: Db,
  config: AppConfig,
  job: GenerationJobView,
  reservations: ReservedGeneratedComponent[],
  correlationId: string
): Promise<GeneratedArtifact[]> {
  const artifacts: GeneratedArtifact[] = [];
  for (const component of reservations) {
    const identity = await ensureGeneratedRuntimeIdentity(db, config, component, job.ownerAdminId, correlationId);
    const release = await db.query(
      `select release.revision_id,release.release_path,revision.manifest
         from local_component_release release
         join component_revision revision on revision.id=release.revision_id
        where release.component_id=$1 and release.generation_job_id=$2 and release.state='ACTIVE'
        order by release.activated_at desc limit 1`,
      [component.componentId, job.id]
    );
    if (!release.rowCount) throw new Error(`generation_candidate_release_missing:${component.elementKey}`);
    const releasePath = String(release.rows[0].release_path);
    artifacts.push({
      component,
      runtimeToken: identity.token,
      revisionId: String(release.rows[0].revision_id),
      manifest: validateComponentManifest(release.rows[0].manifest),
      handlerPath: path.join(releasePath, "handler.mjs"),
      manifestPath: path.join(releasePath, "manifest.kcml.json")
    });
  }
  return artifacts;
}

async function runIntegrationPhase(
  db: Db,
  config: AppConfig,
  job: GenerationJobView,
  reservations: ReservedGeneratedComponent[],
  artifacts: GeneratedArtifact[],
  workspace: string,
  integrationPlan: GenerationImplementationResult["integrationPlan"] | null | undefined,
  correlationId: string,
  signal: AbortSignal
): Promise<boolean> {
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationState(db, job.id, "INTEGRATING", { blocker: null });
  await appendGenerationEvent(db, job.id, "INTEGRATING", "generation.integration_started", "Candidate runtime běží; probíhá konfigurace externích providerů proti skutečným veřejným HTTPS URL.", {
    targets: artifacts.map((artifact) => ({ componentId: artifact.component.componentId, hostname: artifact.component.hostname }))
  });

  if (integrationRequired(job, artifacts, integrationPlan)) {
    const apiKey = await resolveGenerationSecret(db, config, "OPENAI_API_KEY", correlationId);
    const result = await runLiveCandidateIntegration({
      artifacts,
      checkpoint: () => cancellationCheckpoint(db, job.id, signal),
      verifyCandidateRuntime: (artifact) => waitForGeneratedRuntime(config, artifact.component, artifact.runtimeToken),
      integrate: async () => {
        const approved = await loadApprovedSpecification(db, job.id);
        return integrateGeneration(apiKey, config.GENERATION_OPENAI_MODEL, {
        prompt: approved.plannerInput,
        plan: job.plan!,
        integrationPlan: integrationPlan ?? undefined,
        reservations,
        deployedTargets: artifacts.map(candidateTargetView),
        workspace,
        sourceRoot: config.GENERATION_SOURCE_ROOT,
        chromiumBinary: config.CHROMIUM_BINARY,
        secretPresent: async (name) => ensureGenerationPlatformSecretGrant(db, job.ownerAdminId, name, correlationId),
        resolveSecret: async (name) => resolveGenerationSecret(db, config, name, correlationId),
        upsertSecret: async (input) => upsertGenerationSecret(db, config, job.ownerAdminId, job.id, correlationId, input),
        remediation: job.blockerSummary,
        signal
        });
      }
    });
    await cancellationCheckpoint(db, job.id, signal);
    if (result.needsInput?.length) {
      await setGenerationNeedsInput(db, job.id, result.needsInput, "Externí integrace vyžaduje skutečně chybějící OWNER údaj nebo credential.", "INTEGRATING");
      return false;
    }
    await appendGenerationEvent(db, job.id, "INTEGRATING", "generation.integration_complete", result.summary || "Externí integrace candidate prvků byla dokončena.");
  } else {
    await appendGenerationEvent(db, job.id, "INTEGRATING", "generation.integration_not_required", "Návrh nevyžaduje externí provider konfiguraci; candidate runtime pokračuje přímo do validace.");
  }

  // Provider-issued credentials created in INTEGRATING are now available. Reconcile all
  // deterministic grants from requiredSecretNames before any functional/conformance call.
  await grantGenerationInputSecrets(db, job.ownerAdminId, job.id, job.plan!, correlationId);
  return true;
}

async function runConformanceAndActivation(
  db: Db,
  config: AppConfig,
  job: GenerationJobView,
  artifacts: GeneratedArtifact[],
  correlationId: string,
  signal: AbortSignal
): Promise<void> {
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationState(db, job.id, "CML_CONFORMANCE", { blocker: null });
  await appendGenerationEvent(db, job.id, "CML_CONFORMANCE", "generation.conformance_started", "Candidate runtime a provider integrace běží; probíhají skutečné CML konformitní gate.");
  await verifyGenerationDependencies(db, config, job.id, job.plan!, artifacts, correlationId);
  for (const artifact of artifacts) {
    await cancellationCheckpoint(db, job.id, signal);
    await runProductionConformanceWorkers(db, config, artifact, correlationId);
    await verifyGeneratedComponentConformance(db, config, artifact.component, artifact.revisionId, artifact.manifest, artifact.runtimeToken, correlationId);
  }
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationState(db, job.id, "ACTIVATING", { blocker: null });
  await appendGenerationEvent(db, job.id, "ACTIVATING", "generation.activation_started", "Všechny CML gate prošly; probíhá aktivace výsledných prvků.");
  for (const artifact of artifacts) {
    await cancellationCheckpoint(db, job.id, signal);
    const current = await db.query("select activation_state from component where id=$1", [artifact.component.componentId]);
    if (String(current.rows[0]?.activation_state) === "READY_FOR_ACTIVATION") {
      await setComponentActivation(db, { componentId: artifact.component.componentId, enabled: true, actorId: job.ownerAdminId, correlationId });
    }
  }
  await db.query("update generation_component set release_id=(select id from local_component_release where component_id=generation_component.component_id and state='ACTIVE' order by activated_at desc limit 1) where job_id=$1", [job.id]);
}

async function runValidationPhase(db: Db, config: AppConfig, job: GenerationJobView, artifacts: GeneratedArtifact[], correlationId: string, signal: AbortSignal): Promise<void> {
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationState(db, job.id, "VALIDATING", { blocker: null });
  await appendGenerationEvent(db, job.id, "VALIDATING", "generation.validation_started", "Probíhá funkční validace již nasazeného candidate runtime po provider integraci.");
  for (const artifact of artifacts) {
    await cancellationCheckpoint(db, job.id, signal);
    await waitForGeneratedRuntime(config, artifact.component, artifact.runtimeToken);
  }
  await runConformanceAndActivation(db, config, job, artifacts, correlationId, signal);
}

async function implementJob(db: Db, config: AppConfig, initialJob: GenerationJobView, signal: AbortSignal): Promise<void> {
  await cancellationCheckpoint(db, initialJob.id, signal);
  // The analysis phase persists the planner result and advances the state in a
  // separate transaction. Reload before implementation so a worker observing
  // the state transition cannot carry a pre-analysis null plan into the next
  // phase.
  const job = initialJob.plan ? initialJob : await getGenerationJob(db, initialJob.id);
  if (!job.plan) throw new Error("generation_plan_missing");
  const ownerAdminId = job.ownerAdminId;
  const correlationId = randomUUID();
  const reservations = await reserveGeneratedComponents(db, job.id, job.plan.elements);
  const identities = new Map<string, { token: string; fingerprint: string; secretName: string }>();
  for (const component of reservations) identities.set(component.elementKey, await ensureGeneratedRuntimeIdentity(db, config, component, ownerAdminId, correlationId));
  await grantGenerationInputSecrets(db, ownerAdminId, job.id, job.plan, correlationId);
  await cancellationCheckpoint(db, job.id, signal);

  const prepared = await prepareGenerationWorkspace(config, job.id, reservations);
  const workspace = prepared.workspace;
  const repairEvidence = await seedRepairWorkspace(db, job, reservations, workspace);
  await setGenerationState(db, job.id, "IMPLEMENTING", { workspacePath: workspace, revisionPoint: prepared.revisionPoint });
  await appendGenerationEvent(db, job.id, "IMPLEMENTING", "generation.implementation_started", "Probíhá implementace zdroje, manifestů a integračního plánu; provider se v této fázi nekonfiguruje.", { remediationAttempt: job.remediationAttempts });

  const apiKey = await resolveGenerationSecret(db, config, "OPENAI_API_KEY", correlationId);
  const result = await implementGeneration(apiKey, config.GENERATION_OPENAI_MODEL, {
    prompt: (await loadApprovedSpecification(db, job.id)).plannerInput, plan: job.plan, reservations, workspace,
    sourceRoot: config.GENERATION_SOURCE_ROOT, chromiumBinary: config.CHROMIUM_BINARY,
    secretPresent: async (name) => ensureGenerationPlatformSecretGrant(db, job.ownerAdminId, name, correlationId),
    resolveSecret: async (name) => resolveGenerationSecret(db, config, name, correlationId),
    remediation: job.blockerSummary, repairEvidence, signal
  });
  await cancellationCheckpoint(db, job.id, signal);
  if (result.needsInput?.length) {
    await setGenerationNeedsInput(db, job.id, result.needsInput, "Implementace vyžaduje skutečně chybějící OWNER údaj nebo credential.", "IMPLEMENTING");
    return;
  }

  const byKey = new Map(result.elements.map((element) => [element.key, element]));
  const artifacts: GeneratedArtifact[] = [];
  for (const component of reservations) {
    await cancellationCheckpoint(db, job.id, signal);
    const output = byKey.get(component.elementKey);
    if (!output) throw new Error(`generation_element_output_missing:${component.elementKey}`);
    const normalized = await normalizeGeneratedManifest(workspace, component, output.handlerPath, output.manifestPath, job.id, config,
      ["REPAIR", "RETRY"].includes(job.jobKind) ? await nextRepairRevision(db, component.componentId) : undefined);
    await runLocalHandlerCheck(normalized.handlerPath);
    // This is the authoritative preflight: an invalid candidate never reaches
    // revision registration, release assembly, deployment, or activation.
    validateComponentManifest(normalized.manifest);
    const registered = await registerGeneratedRevision(db, config, component, normalized.manifest, correlationId);
    const identity = identities.get(component.elementKey)!;
    artifacts.push({ component, runtimeToken: identity.token, revisionId: registered.revisionId, manifest: registered.manifest, handlerPath: normalized.handlerPath, manifestPath: normalized.manifestPath });
  }
  await materializeGenerationDependencies(db, job.id, job.plan, artifacts, correlationId);
  await db.query("update generation_job set integration_plan=$2::jsonb,updated_at=now() where id=$1 and state<>'CANCELLED'", [job.id, JSON.stringify(result.integrationPlan ?? { required: false, summary: "", steps: [] })]);
  await appendGenerationEvent(db, job.id, "IMPLEMENTING", "generation.candidate_deploy_started", "Manifesty jsou registrované; nasazuje se candidate runtime před provider konfigurací.");

  await deployCandidatesBeforeIntegration({
    artifacts,
    checkpoint: () => cancellationCheckpoint(db, job.id, signal),
    deployCandidate: async (artifact) => {
      await deployGeneratedRelease(db, config, artifact.component, artifact.revisionId, artifact.handlerPath, artifact.manifestPath, artifact.runtimeToken, correlationId, job.id);
    },
    waitCandidateRuntime: (artifact) => waitForGeneratedRuntime(config, artifact.component, artifact.runtimeToken)
  });
  await appendGenerationEvent(db, job.id, "IMPLEMENTING", "generation.candidate_runtime_ready", "Candidate runtime je nasazený a health probe prošel; veřejné callback URL jsou připravené pro INTEGRATING.", { targets: artifacts.map((artifact) => artifact.component.hostname) });

  const integrated = await runIntegrationPhase(db, config, job, reservations, artifacts, workspace, result.integrationPlan, correlationId, signal);
  if (!integrated) return;
  await runValidationPhase(db, config, job, artifacts, correlationId, signal);
  await appendGenerationEvent(db, job.id, "ACTIVATING", "generation.implementation_complete", result.summary, { components: reservations.map((item) => item.code) });
}

async function resumeIntegratingJob(db: Db, config: AppConfig, job: GenerationJobView, signal: AbortSignal): Promise<void> {
  if (!job.plan) throw new Error("generation_plan_missing");
  if (!job.workspacePath) throw new Error("generation_workspace_missing");
  const correlationId = randomUUID();
  const reservations = await reserveGeneratedComponents(db, job.id, job.plan.elements);
  const artifacts = await loadCandidateArtifacts(db, config, job, reservations, correlationId);
  const integrated = await runIntegrationPhase(db, config, job, reservations, artifacts, job.workspacePath, job.integrationPlan, correlationId, signal);
  if (!integrated) return;
  await runValidationPhase(db, config, job, artifacts, correlationId, signal);
}

async function resumeValidatingJob(db: Db, config: AppConfig, job: GenerationJobView, signal: AbortSignal): Promise<void> {
  if (!job.plan) throw new Error("generation_plan_missing");
  const correlationId = randomUUID();
  const reservations = await reserveGeneratedComponents(db, job.id, job.plan.elements);
  const artifacts = await loadCandidateArtifacts(db, config, job, reservations, correlationId);
  await runValidationPhase(db, config, job, artifacts, correlationId, signal);
}

async function resumeConformanceJob(db: Db, config: AppConfig, job: GenerationJobView, signal: AbortSignal): Promise<void> {
  if (!job.plan) throw new Error("generation_plan_missing");
  const correlationId = randomUUID();
  const reservations = await reserveGeneratedComponents(db, job.id, job.plan.elements);
  const artifacts = await loadCandidateArtifacts(db, config, job, reservations, correlationId);
  await runConformanceAndActivation(db, config, job, artifacts, correlationId, signal);
}

async function finalizeActivation(db: Db, config: AppConfig, job: GenerationJobView, signal: AbortSignal): Promise<void> {
  await cancellationCheckpoint(db, job.id, signal);
  const rows = await db.query(
    `select c.id,c.code,c.activation_state,c.lifecycle_state,c.operational_state,c.enabled
       from generation_component gc join component c on c.id=gc.component_id where gc.job_id=$1 order by c.code`,
    [job.id]
  );
  if (!rows.rowCount) throw new Error("generation_components_missing");
  const failed = rows.rows.find((row) => ["BLOCKED", "QUARANTINED", "RETIRED"].includes(String(row.activation_state)) || ["QUARANTINED", "RETIRED", "DEREGISTERED"].includes(String(row.lifecycle_state)));
  if (failed) throw new Error(`generated_component_activation_failed:${String(failed.code)}`);
  const allActive = rows.rows.every((row) => Boolean(row.enabled) && String(row.activation_state) === "ACTIVE" && String(row.operational_state) === "HEALTHY");
  if (!allActive) return;
  for (const row of rows.rows) { await cancellationCheckpoint(db, job.id, signal); await verifyGeneratedHttpsRuntime(db, config, String(row.id), randomUUID()); }
  await cancellationCheckpoint(db, job.id, signal);
  await setGenerationState(db, job.id, "COMPLETED", {
    blocker: null,
    result: { status: "COMPLETED", components: rows.rows.map((row) => ({ id: String(row.id), code: String(row.code) })) }
  });
  await appendGenerationEvent(db, job.id, "COMPLETED", "generation.completed", "Generování, CML validace a aktivace byly úspěšně dokončeny.", { components: rows.rows.map((row) => String(row.code)) });
}

async function restoreRepairBaseState(db: Db, job: GenerationJobView): Promise<void> {
  if (!(["REPAIR", "RETRY"] as string[]).includes(job.jobKind) || !job.repairComponentId) return;
  const result = await db.query("select repair_evidence from generation_job where id=$1", [job.id]);
  const base = result.rows[0]?.repair_evidence?._kcmlBaseComponentState;
  if (!base || typeof base !== "object") return;
  await db.query(`update component set active_revision_id=$2,lifecycle_state=$3,activation_state=$4,operational_state=$5,monitoring_state=$6,enabled=$7,ingress_enabled=$8,pulse_enabled=$9,egress_enabled=$10,updated_at=now() where id=$1`, [job.repairComponentId, base.activeRevisionId, base.lifecycleState, base.activationState, base.operationalState, base.monitoringState, Boolean(base.enabled), Boolean(base.ingressEnabled), Boolean(base.pulseEnabled), Boolean(base.egressEnabled)]);
}

async function cleanupJobCandidateRelease(db: Db, config: AppConfig, job: GenerationJobView, componentId: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await cancelGeneratedCandidateRelease(db, config, componentId, job.id, randomUUID());
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("generated_candidate_cleanup_failed");
}

async function handleCancellation(db: Db, config: AppConfig, job: GenerationJobView): Promise<void> {
  const components = await db.query("select component_id from generation_component where job_id=$1", [job.id]);
  for (const row of components.rows) {
    try { await cleanupJobCandidateRelease(db, config, job, String(row.component_id)); } catch (error) { console.error("generation_cancel_release_cleanup_failed", { jobId: job.id, componentId: row.component_id, error: error instanceof Error ? error.message : String(error) }); }
  }
  try { await restoreRepairBaseState(db, job); } catch (error) { console.error("generation_cancel_restore_failed", { jobId: job.id, error: error instanceof Error ? error.message : String(error) }); }
}

async function handleTechnicalFailure(db: Db, config: AppConfig, job: GenerationJobView, error: unknown): Promise<void> {
  const diagnostic = failureDiagnostic(error);
  const message = diagnostic
    ? `${diagnostic.code}: ${diagnostic.errors.map((item) => `${item.path || "/"} ${item.keyword} ${item.message}`).join("; ")}`.slice(0, 4000)
    : error instanceof Error ? error.message : "generation_failed";
  const attempts = job.remediationAttempts + 1;
  const components = await db.query("select component_id from generation_component where job_id=$1", [job.id]);
  const componentIds = components.rows.map((row) => String(row.component_id));

  if (diagnostic) {
    const prior = await db.query(
      `select 1 from generation_job_event where job_id=$1 and event_type='generation.remediation_scheduled'
        and details->>'errorFingerprint'=$2 limit 1`, [job.id, diagnostic.fingerprint]
    );
    if (prior.rowCount) {
      for (const componentId of componentIds) await cleanupJobCandidateRelease(db, config, job, componentId);
      await restoreRepairBaseState(db, job);
      await setGenerationState(db, job.id, "BLOCKED", { blocker: message, remediationAttempts: attempts });
      await appendGenerationEvent(db, job.id, "BLOCKED", "generation.repeated_validation_blocked", "Stejná validační chyba se opakovala; job byl bezpečně zastaven místo dalších slepých pokusů. Spusťte navazující běh s instrukcí pro opravu.", { error: message, errorFingerprint: diagnostic.fingerprint, validationErrors: diagnostic.errors });
      return;
    }
  }

  try {
    await recoverGenerationTechnicalFailure({
      phase: job.state,
      jobKind: job.jobKind,
      attempts,
      maxAttempts: MAX_REMEDIATION_ATTEMPTS,
      componentIds,
      errorMessage: message,
      eventDetails: diagnostic ? { errorFingerprint: diagnostic.fingerprint, validationErrors: diagnostic.errors } : {},
      setState: (state, params) => setGenerationState(db, job.id, state as GenerationJobView["state"], params),
      appendEvent: (phase, eventType, eventMessage, details = {}) => appendGenerationEvent(db, job.id, phase, eventType, eventMessage, details),
      failClosedComponent: async (componentId) => {
        await setComponentActivation(db, { componentId, enabled: false, actorId: job.ownerAdminId, correlationId: randomUUID() });
      },
      cleanupCandidate: (componentId) => cleanupJobCandidateRelease(db, config, job, componentId),
      restoreRepairBase: () => restoreRepairBaseState(db, job)
    });
  } catch (cleanupError) {
    // Never start a fresh candidate if the abandoned candidate could not be cleaned.
    // Keep the failure visible rather than silently leaving an orphan runtime/release.
    const cleanupMessage = `generation_candidate_cleanup_failed:${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
    try { await restoreRepairBaseState(db, job); } catch { /* preserve the cleanup root cause below */ }
    await setGenerationState(db, job.id, "FAILED", { blocker: cleanupMessage, remediationAttempts: Math.min(attempts, MAX_REMEDIATION_ATTEMPTS) });
    await appendGenerationEvent(db, job.id, "FAILED", "generation.candidate_cleanup_failed", "Opuštěný candidate se nepodařilo bezpečně uklidit; další remediation nebyla spuštěna, aby nevznikl paralelní/orphan runtime.", { failedPhase: job.state, error: message, cleanupError: cleanupMessage });
  }
}

export async function processNextGenerationJob(db: Db, config: AppConfig, workerId: string): Promise<boolean> {
  const apiKey = await resolveGenerationSecret(db, config, "OPENAI_API_KEY", randomUUID()).catch(() => null);
  if (apiKey && await processNextDiscussionTurn(db, config, workerId, apiKey)) return true;
  const claimed = await claimGenerationJob(db, workerId);
  if (!claimed) return false;
  try {
    await withLeaseHeartbeat(db, claimed.id, workerId, async () => {
      const job = await getGenerationJob(db, claimed.id);
      try {
        await withCancellationMonitor(db, job.id, async (signal) => {
          if (job.state === "ANALYZING") await analyzeJob(db, config, job, signal);
          else if (job.state === "IMPLEMENTING") await implementJob(db, config, job, signal);
          else if (job.state === "INTEGRATING") await resumeIntegratingJob(db, config, job, signal);
          else if (job.state === "VALIDATING") await resumeValidatingJob(db, config, job, signal);
          else if (job.state === "CML_CONFORMANCE") await resumeConformanceJob(db, config, job, signal);
          else if (job.state === "ACTIVATING") await finalizeActivation(db, config, job, signal);
        });
      } catch (error) {
        if (isGenerationCancelledError(error) || (error instanceof DOMException && error.name === "AbortError")) await handleCancellation(db, config, job);
        else await handleTechnicalFailure(db, config, await getGenerationJob(db, job.id), error);
      }
    });
  } finally {
    await releaseLease(db, claimed.id, workerId);
  }
  return true;
}
