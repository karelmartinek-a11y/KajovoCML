import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, symlink, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { GenerationRouteConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { hmacToken, issueOpaqueSecret } from "../security/secrets.js";
import { appendAudit } from "./audit.js";
import { authorizeComponentCall, componentSourceIdentityMatches } from "./component-auth.js";
import {
  ACTIVATION_GATES,
  COMPONENT_CATALOG_VERSION,
  componentManifestDigest,
  recordComponentMonitoringWatchdog,
  replaceDerivedComponentContracts,
  recordActiveGateEvidence,
  gateResults,
  persistGateEvidence,
  validateComponentManifest,
  type ComponentManifest
} from "./component.js";
import { probeUdsComponentRuntime } from "./component-runtime-health.js";
import { CANONICAL_COMPONENT_HOST_SUFFIX } from "./hostnames.js";
import { createSecret, grantSecret, listSecrets, platformWorkerSecretPrincipal, resolveSecret, rotateSecret, setSecretStatus, type SecretPrincipal } from "./secret-manager.js";
import { generationSecretGrantElementKeys, grantGenerationSecretToElements, normalizeGenerationSecretName, type GenerationPlan } from "./generation.js";
import { switchGeneratedCandidateRuntime } from "../generation/generation-release-cleanup.mjs";

export type ReservedGeneratedComponent = { componentId: string; principalId: string; code: string; hostname: string; elementKey: string; elementKind: "MCP_SERVER" | "AI_AGENT"; displayName: string };

export type GeneratedDependencyArtifact = { component: ReservedGeneratedComponent; manifest: ComponentManifest };

type JsonRecord = Record<string, unknown>;
type JsonResponse = { status: number; json: unknown };

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function responseTools(value: unknown): string[] {
  const payload = recordValue(value);
  const result = recordValue(payload?.result);
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools
    .map((tool) => stringValue(recordValue(tool)?.name))
    .filter(Boolean)
    .sort();
}

function statePayload(value: unknown): JsonRecord {
  const payload = recordValue(value);
  const nestedState = recordValue(payload?.state);
  return recordValue(payload?.states) ?? recordValue(nestedState?.states) ?? {};
}

export async function materializeGenerationDependencies(
  db: Db,
  jobId: string,
  plan: GenerationPlan,
  artifacts: GeneratedDependencyArtifact[],
  correlationId: string
): Promise<void> {
  const byKey = new Map(artifacts.map((artifact) => [artifact.component.elementKey, artifact]));
  await tx(db, async (client) => {
    for (const dependency of plan.dependencies) {
      const source = byKey.get(dependency.from);
      const target = byKey.get(dependency.to);
      if (!source || !target || source.component.componentId === target.component.componentId) throw new Error(`generation_dependency_invalid:${dependency.from}:${dependency.to}`);
      const targetTools = new Map(target.manifest.tools.map((tool) => [String(tool.name), tool]));
      for (const toolName of [...new Set(dependency.targetTools)]) {
        const tool = targetTools.get(toolName);
        if (!tool) throw new Error(`generation_dependency_tool_missing:${dependency.to}:${toolName}`);
        const scope = String(tool.scope);
        const route = `/mcp/tools/${toolName}`;
        await client.query(
          `insert into component_permission(source_component_id,target_component_id,route_pattern,scope_name,access_level,constraints_json,granted_by_type,granted_by_id)
           values ($1,$2,$3,$4,'INVOKE',$5::jsonb,'generation',$6)
           on conflict (source_component_id,target_component_id,route_pattern,scope_name)
           do update set revoked_at=null,constraints_json=excluded.constraints_json,granted_by_type='generation',granted_by_id=excluded.granted_by_id`,
          [source.component.componentId, target.component.componentId, route, scope, JSON.stringify({ generationJobId: jobId, purpose: dependency.purpose }), jobId]
        );
        await client.query(
          `delete from principal_component_permission
            where source_principal_id=$1 and target_component_id=$2 and route_pattern=$3 and scope_name=$4`,
          [source.component.principalId, target.component.componentId, route, scope]
        );
        await client.query(
          `insert into principal_component_permission(source_principal_id,target_component_id,route_pattern,scope_name)
           values ($1,$2,$3,$4)`,
          [source.component.principalId, target.component.componentId, route, scope]
        );
        await appendAudit(client, {
          eventType: "generation_dependency.materialized", actorType: "system", objectType: "component_permission",
          objectId: `${source.component.componentId}:${target.component.componentId}:${toolName}`,
          after: { jobId, from: dependency.from, to: dependency.to, targetTool: toolName, route, scope, purpose: dependency.purpose }, correlationId
        });
      }
    }
  });
}

export async function verifyGenerationDependencies(
  db: Db,
  config: GenerationRouteConfig,
  jobId: string,
  plan: GenerationPlan,
  artifacts: Array<GeneratedDependencyArtifact & { runtimeToken: string; revisionId: string }>,
  correlationId: string
): Promise<void> {
  const byKey = new Map(artifacts.map((artifact) => [artifact.component.elementKey, artifact]));
  const sourcesWithDependencies = new Set<string>();
  for (const dependency of plan.dependencies) {
    const source = byKey.get(dependency.from);
    const target = byKey.get(dependency.to);
    if (!source || !target) throw new Error(`generation_dependency_invalid:${dependency.from}:${dependency.to}`);
    sourcesWithDependencies.add(source.component.componentId);
    const sourceTool = source.manifest.tools.find((tool) => String(tool.name) === dependency.sourceTool);
    if (!sourceTool) throw new Error(`generation_dependency_source_tool_missing:${dependency.from}:${dependency.sourceTool}`);
    const scenario = source.manifest.e2eScenarios.find((candidate) => {
      const invocation = candidate.invocation as Record<string, unknown>;
      return invocation.kind === "TOOL" && invocation.name === dependency.sourceTool;
    });
    if (!scenario) throw new Error(`generation_dependency_source_fixture_missing:${dependency.from}:${dependency.sourceTool}`);
    const input = scenario.input as Record<string, unknown>;
    const expected = scenario.expected as Record<string, unknown>;
    const startedAt = new Date().toISOString();
    const response = await fetch(`https://${source.component.hostname}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${source.runtimeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name: dependency.sourceTool, arguments: input.json ?? {} } }),
      signal: AbortSignal.timeout(Math.max(15_000, Number(scenario.timeoutMs ?? 15_000)))
    });
    if (!response.ok) throw new Error(`generation_dependency_https_failed:${dependency.from}:${dependency.sourceTool}:${response.status}`);
    const payload = await response.json();
    if (payload?.error) throw new Error(`generation_dependency_source_call_failed:${dependency.from}:${payload.error.message ?? "runtime_error"}`);
    if (canonical(payload?.result?.structuredContent) !== canonical(expected.json)) {
      throw new Error(`generation_dependency_source_output_mismatch:${dependency.from}:${dependency.sourceTool}`);
    }
    const lease = await db.query(
      `select operation_name,started_at,finished_at,success
         from component_operation_lease
        where source_principal_id=$1 and target_component_id=$2 and operation_kind='TOOL'
          and operation_name=any($3::text[]) and started_at >= $4::timestamptz and success is true
        order by started_at desc limit 1`,
      [source.component.principalId, target.component.componentId, dependency.targetTools, startedAt]
    );
    if (!lease.rowCount) throw new Error(`generation_dependency_target_dispatch_missing:${dependency.from}:${dependency.to}`);
    await tx(db, async (client) => {
      for (const gate of ["REGISTERED_TO_REGISTERED_DISPATCH", "DEPENDENCY_READY"] as const) {
        await recordActiveGateEvidence(client, {
          componentId: source.component.componentId,
          revisionId: source.revisionId,
          gate,
          pass: true,
          reasonCode: gate === "REGISTERED_TO_REGISTERED_DISPATCH" ? "generated_cross_component_call_observed" : "generated_dependency_runtime_ready",
          evidence: {
            jobId,
            from: dependency.from,
            to: dependency.to,
            sourceTool: dependency.sourceTool,
            targetTool: String(lease.rows[0].operation_name),
            targetLeaseStartedAt: new Date(lease.rows[0].started_at).toISOString(),
            targetLeaseFinishedAt: lease.rows[0].finished_at ? new Date(lease.rows[0].finished_at).toISOString() : null,
            sourceHttps: `https://${source.component.hostname}/mcp`
          },
          correlationId,
          variant: `dependency:${dependency.from}:${dependency.to}`
        });
      }
    });
  }
  // Components without cross-component dependencies do not receive synthetic PASS
  // evidence. gateResults() derives NOT_APPLICABLE from the absence of canonical
  // principal_component_permission edges to another component.
}

function manifestRevision(manifest: ComponentManifest): string { return stringValue(manifest.registrationRevision, "1.0.0"); }
function manifestTransports(manifest: ComponentManifest): string[] { return [stringValue((manifest.runtime as Record<string, unknown>).transport, "UDS")]; }
function manifestProtocols(manifest: ComponentManifest): string[] { return manifest.capabilities.some((value) => value.startsWith("mcp.")) ? ["MCP"] : []; }
function sha256File(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function generatedExternalTargetKey(hostname: string): string {
  return `generated-${createHash("sha256").update(hostname.toLowerCase()).digest("hex").slice(0, 24)}`;
}

function normalizedOutboundPathPrefix(value: unknown): string {
  const raw = stringValue(value, "/");
  if (!raw.startsWith("/") || raw.includes("//")) throw new Error(`generated_outbound_path_prefix_invalid:${raw}`);
  return raw === "/" ? "/" : raw.replace(/\/+$/, "");
}

async function run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 60_000);
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); const stdout=Buffer.concat(out).toString("utf8"); const stderr=Buffer.concat(err).toString("utf8"); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`${command}_failed_${code}:${stderr.slice(-1000)}`)); });
  });
}

async function installRuntimeCredential(config: GenerationRouteConfig, componentCode: string, token: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.GENERATION_PRIVILEGED_HELPER, ["credential-stdin", componentCode.toLowerCase()], { stdio: ["pipe", "pipe", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`runtime_credential_install_failed_${code}:${Buffer.concat(errors).toString("utf8").slice(-1000)}`)));
    child.stdin.end(token);
  });
}

export async function reserveGeneratedComponents(db: Db, jobId: string, elements: Array<{ key: string; kind: "MCP_SERVER" | "AI_AGENT"; displayName: string; businessPurpose: string }>): Promise<ReservedGeneratedComponent[]> {
  return tx(db, async (client) => {
    const existing = await client.query(`select gc.component_id,gc.element_key,gc.element_kind,c.principal_id,c.code,c.hostname,c.display_name from generation_component gc join component c on c.id=gc.component_id where gc.job_id=$1 order by gc.created_at`, [jobId]);
    if (existing.rowCount) return existing.rows.map((row) => ({ componentId:String(row.component_id), principalId:String(row.principal_id), code:String(row.code), hostname:String(row.hostname), elementKey:String(row.element_key), elementKind:String(row.element_kind) as "MCP_SERVER"|"AI_AGENT", displayName:String(row.display_name) }));
    const reserved: ReservedGeneratedComponent[] = [];
    for (const element of elements) {
      const identity = await client.query("select nextval('kcml_number_seq')::bigint number");
      const number = Number(identity.rows[0].number); const code = `KCML${String(number).padStart(4,"0")}`; const hostname = `${code.toLowerCase()}.${CANONICAL_COMPONENT_HOST_SUFFIX}`;
      const componentId=randomUUID(); const principalId=randomUUID();
      await client.query(`insert into principal(id,kind,public_id,status,policy_epoch,revocation_epoch,metadata) values ($1,'COMPONENT',$2,'SUSPENDED',1,1,$3::jsonb)`, [principalId,code,JSON.stringify({componentId,assignedBy:"internal_generation",jobId,elementKey:element.key})]);
      await client.query(`insert into component(id,principal_id,kcml_number,code,hostname,display_name,description,category,registration_type,component_role,owners,contacts,lifecycle_state,activation_state,operational_state,monitoring_state,enabled,release_version,kind_metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,'INTERNAL_GENERATED',$9,'{}'::jsonb,'{}'::jsonb,'DRAFT','INACTIVE','UNKNOWN','PENDING',false,$10,'internal_generation')`, [componentId,principalId,number,code,hostname,element.displayName,element.businessPurpose,element.kind,element.kind==='AI_AGENT'?'AGENT':'SERVICE',COMPONENT_CATALOG_VERSION]);
      await client.query("insert into component_audit_stream(component_id) values ($1)", [componentId]);
      await client.query(`insert into dashboard_visual_node(component_id,principal_id,lifecycle_phase,label,metadata) values ($1,$2,'REGISTERED',$3,$4::jsonb) on conflict do nothing`, [componentId,principalId,code,JSON.stringify({displayName:element.displayName,generationJobId:jobId,elementKey:element.key})]);
      await client.query(`insert into generation_component(job_id,component_id,element_key,element_kind) values ($1,$2,$3,$4)`, [jobId,componentId,element.key,element.kind]);
      reserved.push({componentId,principalId,code,hostname,elementKey:element.key,elementKind:element.kind,displayName:element.displayName});
    }
    return reserved;
  });
}

export async function ensureGeneratedRuntimeIdentity(db: Db, config: GenerationRouteConfig, component: ReservedGeneratedComponent, ownerAdminId: string, correlationId: string): Promise<{ token: string; fingerprint: string; secretName: string }> {
  const current = await db.query(`select identity.*,token.fingerprint,token.revoked_at from component_runtime_identity identity join principal_access_token token on token.id=identity.access_token_id where identity.component_id=$1`, [component.componentId]);
  if (current.rowCount) {
    if (current.rows[0].revoked_at) throw Object.assign(new Error("runtime_identity_revoked_requires_owner_rotation"), { statusCode: 409 });
    const platform = await platformWorkerSecretPrincipal(db);
    const resolved = await resolveSecret(db, config, platform, String(current.rows[0].stable_secret_name), correlationId);
    return { token: resolved.value, fingerprint: String(current.rows[0].fingerprint), secretName: String(current.rows[0].stable_secret_name) };
  }
  const issued=issueOpaqueSecret(); const secretName=`${component.code}_RUNTIME_ACCESS_TOKEN`;
  const tokenId = await tx(db, async (client) => {
    const epochs=await client.query("select policy_epoch,revocation_epoch from principal where id=$1 for update",[component.principalId]);
    const inserted=await client.query(`insert into principal_access_token(lookup_digest,key_id,fingerprint,source_principal_id,target_component_id,audience,scope_names,issued_policy_epoch,issued_revocation_epoch,expires_at) values ($1,$2,$3,$4,null,'*',$5,$6,$7,'infinity') returning id`,[hmacToken(issued.value,config.ACCESS_TOKEN_HMAC_KEY_BASE64),config.ACCESS_TOKEN_HMAC_KEY_ID,issued.fingerprint,component.principalId,['*','secret.resolve'],Number(epochs.rows[0].policy_epoch),Number(epochs.rows[0].revocation_epoch)]);
    return String(inserted.rows[0].id);
  });
  const secret=await createSecret(db,config,ownerAdminId,correlationId,{stableName:secretName,displayName:`${component.code} runtime access token`,description:"Kanonická runtime credential interně generované komponenty.",value:issued.value,ownerKind:"COMPONENT",ownerId:component.componentId});
  await grantSecret(db,ownerAdminId,correlationId,secret.id,{principalKind:"COMPONENT",principalId:component.componentId,principalPublicId:component.code});
  const platform=await platformWorkerSecretPrincipal(db); await grantSecret(db,ownerAdminId,correlationId,secret.id,{principalKind:"PLATFORM",principalId:platform.id,principalPublicId:platform.publicId});
  await db.query(`insert into component_runtime_identity(component_id,access_token_id,secret_id,stable_secret_name,installed_fingerprint) values ($1,$2,$3,$4,$5)`,[component.componentId,tokenId,secret.id,secretName,issued.fingerprint]);
  await appendAudit(db,{eventType:"generated_component.runtime_identity_issued",actorType:"system",objectType:"component",objectId:component.componentId,after:{fingerprint:issued.fingerprint,secretName},correlationId});
  return {token:issued.value,fingerprint:issued.fingerprint,secretName};
}

export async function isGeneratedRuntimeAccessToken(db: Db, componentId: string, tokenId: string): Promise<boolean> {
  const result = await db.query(
    `select 1 from component_runtime_identity identity
      join component c on c.id=identity.component_id
     where identity.component_id=$1 and identity.access_token_id=$2 and c.registration_type='INTERNAL_GENERATED'`,
    [componentId, tokenId]
  );
  return Boolean(result.rowCount);
}

export async function rotateGeneratedRuntimeAccessToken(db: Db, config: GenerationRouteConfig, params: {
  componentId: string;
  tokenId: string;
  actorId: string;
  correlationId: string;
}): Promise<{ token: string; fingerprint: string }> {
  const current = await db.query(
    `select identity.secret_id,identity.stable_secret_name,c.code,c.principal_id,token.*,
            p.policy_epoch as current_policy_epoch,p.revocation_epoch as current_revocation_epoch
       from component_runtime_identity identity
       join component c on c.id=identity.component_id
       join principal p on p.id=c.principal_id
       join principal_access_token token on token.id=identity.access_token_id
      where identity.component_id=$1 and identity.access_token_id=$2 and c.registration_type='INTERNAL_GENERATED'`,
    [params.componentId, params.tokenId]
  );
  if (!current.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });

  const row = current.rows[0];
  const issued = issueOpaqueSecret();
  const secrets = await listSecrets(db);
  let secret = secrets.find((item) => item.id === String(row.secret_id));
  if (!secret || secret.status === "DELETED") throw Object.assign(new Error("runtime_identity_secret_unavailable"), { statusCode: 409 });
  if (secret.status === "DISABLED") secret = await setSecretStatus(db, params.actorId, params.correlationId, secret.id, secret.lockVersion, "ACTIVE");

  // Rotate the managed secret and installed systemd credential first. Until the DB switch below,
  // the new token is intentionally fail-closed at the CML authorization layer.
  await rotateSecret(db, config, params.actorId, params.correlationId, secret.id, { value: issued.value, expectedVersion: secret.lockVersion });
  await installRuntimeCredential(config, String(row.code), issued.value);
  await run(config.GENERATION_PRIVILEGED_HELPER, ["restart", String(row.code).toLowerCase()], { timeoutMs: 30_000 });

  const insertedId = await tx(db, async (client) => {
    const locked = await client.query(
      `select identity.access_token_id,c.principal_id,p.policy_epoch,p.revocation_epoch,token.revoked_at
         from component_runtime_identity identity
         join component c on c.id=identity.component_id
         join principal p on p.id=c.principal_id
         join principal_access_token token on token.id=identity.access_token_id
        where identity.component_id=$1 for update of identity,p,token`,
      [params.componentId]
    );
    if (!locked.rowCount || String(locked.rows[0].access_token_id) !== params.tokenId) {
      throw Object.assign(new Error("runtime_identity_changed_during_rotation"), { statusCode: 409 });
    }
    const inserted = await client.query(
      `insert into principal_access_token(
         lookup_digest,key_id,fingerprint,source_principal_id,target_component_id,audience,scope_names,
         issued_policy_epoch,issued_revocation_epoch,expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'infinity') returning id`,
      [hmacToken(issued.value, config.ACCESS_TOKEN_HMAC_KEY_BASE64), config.ACCESS_TOKEN_HMAC_KEY_ID, issued.fingerprint,
        row.principal_id, null, "*", row.scope_names,
        Number(locked.rows[0].policy_epoch), Number(locked.rows[0].revocation_epoch)]
    );
    await client.query("update principal_access_token set revoked_at=coalesce(revoked_at,now()),rotated_at=now(),rotation_reason='ADMIN_ROTATE' where id=$1", [params.tokenId]);
    await client.query("update principal set status='ACTIVE',updated_at=now() where id=$1", [row.principal_id]);
    await client.query(
      "update component set activation_state=case when activation_state='BLOCKED' then 'READY_FOR_ACTIVATION' else activation_state end,updated_at=now() where id=$1",
      [params.componentId]
    );
    await client.query(
      "update component_runtime_identity set access_token_id=$2,installed_fingerprint=$3,rotated_at=now(),updated_at=now() where component_id=$1",
      [params.componentId, inserted.rows[0].id, issued.fingerprint]
    );
    await appendAudit(client, {
      eventType: "generated_component.runtime_identity_rotated", actorType: "admin", actorId: params.actorId,
      objectType: "component", objectId: params.componentId,
      before: { tokenId: params.tokenId, fingerprint: row.fingerprint },
      after: { tokenId: String(inserted.rows[0].id), fingerprint: issued.fingerprint }, correlationId: params.correlationId
    });
    return String(inserted.rows[0].id);
  });
  if (!insertedId) throw new Error("runtime_identity_rotation_failed");
  return { token: issued.value, fingerprint: issued.fingerprint };
}

export async function revokeGeneratedRuntimeAccessToken(db: Db, config: GenerationRouteConfig, params: {
  componentId: string;
  tokenId: string;
  actorId: string;
  correlationId: string;
}): Promise<void> {
  const identity = await db.query(
    `select identity.secret_id,c.code,c.principal_id,token.revoked_at
       from component_runtime_identity identity
       join component c on c.id=identity.component_id
       join principal_access_token token on token.id=identity.access_token_id
      where identity.component_id=$1 and identity.access_token_id=$2 and c.registration_type='INTERNAL_GENERATED'`,
    [params.componentId, params.tokenId]
  );
  if (!identity.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  if (identity.rows[0].revoked_at) throw Object.assign(new Error("access_token_already_revoked"), { statusCode: 409 });
  const row = identity.rows[0];

  await tx(db, async (client) => {
    const locked = await client.query(
      `select token.revoked_at from component_runtime_identity identity
        join principal_access_token token on token.id=identity.access_token_id
       where identity.component_id=$1 and identity.access_token_id=$2 for update of identity,token`,
      [params.componentId, params.tokenId]
    );
    if (!locked.rowCount || locked.rows[0].revoked_at) throw Object.assign(new Error("access_token_already_revoked"), { statusCode: 409 });
    await client.query("update principal_access_token set revoked_at=now(),rotation_reason='ADMIN_REVOKE' where id=$1", [params.tokenId]);
    await client.query("update principal set status='SUSPENDED',revocation_epoch=revocation_epoch+1,updated_at=now() where id=$1", [row.principal_id]);
    await client.query(
      "update component set enabled=false,ingress_enabled=false,pulse_enabled=false,egress_enabled=false,activation_state='BLOCKED',operational_state='DISABLED',updated_at=now() where id=$1",
      [params.componentId]
    );
    await appendAudit(client, {
      eventType: "generated_component.runtime_identity_revoked", actorType: "admin", actorId: params.actorId,
      objectType: "component", objectId: params.componentId,
      before: { tokenId: params.tokenId, enabled: true },
      after: { tokenId: params.tokenId, enabled: false, activationState: "BLOCKED" }, correlationId: params.correlationId
    });
  });
  const secrets = await listSecrets(db);
  const secret = secrets.find((item) => item.id === String(row.secret_id));
  if (secret && secret.status === "ACTIVE") await setSecretStatus(db, params.actorId, params.correlationId, secret.id, secret.lockVersion, "DISABLED");
  await run(config.GENERATION_PRIVILEGED_HELPER, ["stop", String(row.code).toLowerCase()], { timeoutMs: 30_000 });
}

export async function grantGenerationInputSecrets(db: Db, ownerAdminId: string, jobId: string, plan: GenerationPlan, correlationId: string): Promise<void> {
  const secrets = await listSecrets(db);
  const activeByName = new Map(secrets.filter((item) => item.status === "ACTIVE" && !item.deletedAt).map((item) => [item.stableName, item]));
  const inputRows = await db.query(`select stable_secret_name,grant_element_keys,supplied_at from generation_job_input where job_id=$1 and secret`, [jobId]);
  const grants = new Map<string, Set<string>>();
  for (const element of plan.elements) {
    for (const name of element.requiredSecretNames ?? []) {
      const normalized = normalizeGenerationSecretName(name);
      const set = grants.get(normalized) ?? new Set<string>(); set.add(element.key); grants.set(normalized, set);
    }
  }
  for (const row of inputRows.rows) {
    const name = normalizeGenerationSecretName(String(row.stable_secret_name));
    const set = grants.get(name) ?? new Set<string>();
    const grantKeys = Array.isArray(row.grant_element_keys) ? (row.grant_element_keys as unknown[]).filter((entry): entry is string => typeof entry === "string") : [];
    for (const key of grantKeys) set.add(key);
    for (const key of generationSecretGrantElementKeys(plan, name)) set.add(key);
    grants.set(name, set);
  }
  for (const [name, elementKeys] of grants) {
    const secret = activeByName.get(name);
    if (!secret) {
      const providerGenerated = plan.elements.some((element) => (element.providerGeneratedSecretNames ?? []).map(normalizeGenerationSecretName).includes(name));
      if (providerGenerated) continue;
      throw new Error(`generation_secret_missing:${name}`);
    }
    const granted = await grantGenerationSecretToElements(db, ownerAdminId, jobId, name, Array.from(elementKeys), correlationId);
    if (!granted) throw new Error(`generation_secret_missing:${name}`);
  }
}

export async function registerGeneratedRevision(db: Db, config: GenerationRouteConfig, component: ReservedGeneratedComponent, manifestInput: unknown, correlationId: string): Promise<{ revisionId: string; manifest: ComponentManifest; digest: string }> {
  const manifest=validateComponentManifest(manifestInput); const runtime=manifest.runtime as Record<string,unknown>;
  if (runtime.transport!=="UDS") throw new Error("generated_component_runtime_transport_must_be_uds");
  const expectedSocket=path.join(config.RUNTIME_SOCKET_ROOT,`${component.code.toLowerCase()}.sock`); if (runtime.socketPath!==expectedSocket) throw new Error(`generated_component_socket_must_be:${expectedSocket}`);
  if ((manifest.artifact as Record<string,unknown>).type!=="SOURCE_PACKAGE") throw new Error("generated_component_artifact_must_be_source_package");
  for (const policy of manifest.outboundPolicies) {
    if (String(policy.type) !== "HTTPS_FETCH") continue;
    if (Number(policy.port) !== 443) throw new Error(`generated_https_outbound_port_must_be_443:${String(policy.targetHost)}`);
    if (!manifest.capabilities.includes("component.outbound.pulse")) throw new Error(`generated_https_outbound_capability_required:${String(policy.targetHost)}`);
    const auth = recordValue(policy.auth) ?? { mode: "NONE" };
    const mode = stringValue(auth.mode, "NONE");
    if ((mode === "BEARER_SECRET" || mode === "HEADER_SECRET") && !/^[A-Z][A-Z0-9_]{2,127}$/.test(stringValue(auth.secretName))) {
      throw new Error(`generated_outbound_secret_name_invalid:${String(policy.targetHost)}`);
    }
    normalizedOutboundPathPrefix(policy.pathPrefix);
  }
  for (const endpoint of manifest.endpoints) {
    const auth = recordValue(endpoint.auth) ?? {};
    if (stringValue(auth.mode, "KCML_BEARER") !== "EXTERNAL_WEBHOOK") continue;
    const endpointPath = stringValue(endpoint.path);
    if (!endpointPath.startsWith("/webhooks/")) throw new Error(`generated_webhook_path_must_be_webhooks_namespace:${String(endpoint.key)}`);
    const verification = recordValue(auth.verification);
    if (!verification) throw new Error(`generated_webhook_verification_required:${String(endpoint.key)}`);
    const type = stringValue(verification.type);
    const method = stringValue(endpoint.method);
    const challengeName = stringValue(verification.challengeSecretName);
    const signatureName = stringValue(verification.signatureSecretName);
    if ((type === "CHALLENGE_TOKEN" || type === "CHALLENGE_AND_HMAC") && !challengeName) throw new Error(`generated_webhook_challenge_secret_required:${String(endpoint.key)}`);
    if ((type === "HMAC_SHA256" || type === "CHALLENGE_AND_HMAC") && !signatureName) throw new Error(`generated_webhook_signature_secret_required:${String(endpoint.key)}`);
    if (type === "CHALLENGE_TOKEN" && method !== "GET") throw new Error(`generated_webhook_challenge_only_must_use_get:${String(endpoint.key)}`);
    if ((type === "HMAC_SHA256" || type === "CHALLENGE_AND_HMAC") && method === "GET") throw new Error(`generated_webhook_signed_callback_must_not_use_get:${String(endpoint.key)}`);
  }
  const digest=componentManifestDigest(manifest);
  const revisionId=await tx(db, async(client)=>{
    const revision=await client.query(`insert into component_revision(component_id,revision,manifest,manifest_digest,capabilities,protocols,transports,derived_gates,validation_state) values ($1,$2,$3::jsonb,$4,$5::text[],$6::text[],$7::text[],$8::jsonb,'PENDING') on conflict(component_id,revision) do update set manifest=excluded.manifest,manifest_digest=excluded.manifest_digest,capabilities=excluded.capabilities,protocols=excluded.protocols,transports=excluded.transports,derived_gates=excluded.derived_gates,validation_state='PENDING' returning id`,[component.componentId,manifestRevision(manifest),JSON.stringify(manifest),digest,manifest.capabilities,manifestProtocols(manifest),manifestTransports(manifest),JSON.stringify(ACTIVATION_GATES)]);
    const id=String(revision.rows[0].id); await replaceDerivedComponentContracts(client,component.componentId,id,manifest,component.hostname);
    await client.query(`update component_external_permission permission set revoked_at=coalesce(permission.revoked_at,now())
      from component_external_target target
      where permission.external_target_id=target.id and permission.component_id=$1 and target.target_key like 'generated-%'`, [component.componentId]);
    for (const policy of manifest.outboundPolicies) {
      if (String(policy.type) !== "HTTPS_FETCH") continue;
      const targetHost = String(policy.targetHost).toLowerCase();
      const pathPrefix = normalizedOutboundPathPrefix(policy.pathPrefix);
      const targetKey = generatedExternalTargetKey(targetHost);
      const target = await client.query(
        `insert into component_external_target(target_key,display_name,base_url,allowed_path_prefixes,request_timeout_ms,max_retries,circuit_failure_threshold,circuit_open_seconds,status)
         values ($1,$2,$3,$4::text[],15000,1,5,60,'ACTIVE')
         on conflict(target_key) do update set
           base_url=excluded.base_url,status='ACTIVE',revoked_at=null,
           allowed_path_prefixes=(select array_agg(distinct prefix order by prefix) from unnest(component_external_target.allowed_path_prefixes || excluded.allowed_path_prefixes) prefix)
         returning id`,
        [targetKey, `Generated HTTPS ${targetHost}`, `https://${targetHost}`, [pathPrefix]]
      );
      const auth = policy.auth && typeof policy.auth === "object" && !Array.isArray(policy.auth) ? policy.auth as Record<string, unknown> : { mode: "NONE" };
      const allowedMethods = Array.isArray(policy.methods) && policy.methods.length ? policy.methods.map((value) => String(value).toUpperCase()) : ["POST"];
      const routePattern = pathPrefix === "/" ? "/*" : `${pathPrefix}/*`;
      const existingPermission = await client.query(
        `select id from component_external_permission
          where component_id=$1 and external_principal_id is null and external_target_id=$2
            and route_pattern=$3 and scope_name=$4
          order by granted_at asc limit 1 for update`,
        [component.componentId, target.rows[0].id, routePattern, String(policy.scope)]
      );
      if (existingPermission.rowCount) {
        await client.query(
          `update component_external_permission set revoked_at=null,auth_config=$2::jsonb,allowed_methods=$3::text[] where id=$1`,
          [existingPermission.rows[0].id, JSON.stringify(auth), allowedMethods]
        );
      } else {
        await client.query(
          `insert into component_external_permission(component_id,external_target_id,route_pattern,scope_name,auth_config,allowed_methods)
           values ($1,$2,$3,$4,$5::jsonb,$6::text[])`,
          [component.componentId, target.rows[0].id, routePattern, String(policy.scope), JSON.stringify(auth), allowedMethods]
        );
      }
    }
    await client.query("update component set active_revision_id=$2,lifecycle_state='REVIEW',activation_state='INACTIVE',enabled=false,ingress_enabled=false,pulse_enabled=false,egress_enabled=false,owners=$3::jsonb,contacts=$4::jsonb,updated_at=now() where id=$1",[component.componentId,id,JSON.stringify(manifest.owners),JSON.stringify(manifest.contacts)]);
    await appendAudit(client,{eventType:"generated_component.revision_registered",actorType:"system",objectType:"component",objectId:component.componentId,after:{revision:manifest.registrationRevision,manifestDigest:digest},correlationId});
    return id;
  });
  return {revisionId,manifest,digest};
}

export async function deployGeneratedRelease(db: Db, config: GenerationRouteConfig, component: ReservedGeneratedComponent, revisionId: string, handlerSourcePath: string, manifestPath: string, runtimeToken: string, correlationId: string, generationJobId?: string): Promise<{ releaseId: string; releasePath: string; sourceDigest: string }> {
  const handlerBytes=await readFile(handlerSourcePath); const sourceDigest=sha256File(handlerBytes); const releaseKey=`${Date.now()}-${sourceDigest.slice(-12)}`;
  const componentRoot=path.join(config.GENERATED_COMPONENT_ROOT,component.code.toLowerCase()); const releases=path.join(componentRoot,"releases"); const releasePath=path.join(releases,releaseKey); const staging=`${releasePath}.staging-${process.pid}`;
  await run(config.GENERATION_PRIVILEGED_HELPER,["prepare",component.code.toLowerCase()],{timeoutMs:30_000});
  await mkdir(staging,{recursive:true,mode:0o750}); await writeFile(path.join(staging,"handler.mjs"),handlerBytes,{mode:0o440}); await cp(manifestPath,path.join(staging,"manifest.kcml.json")); await cp(new URL("../generation/runtime-host.mjs",import.meta.url),path.join(staging,"runtime-host.mjs")); await cp(new URL("../generation/handler-sandbox.mjs",import.meta.url),path.join(staging,"handler-sandbox.mjs")); await cp(new URL("../generation/handler-sandbox-worker.mjs",import.meta.url),path.join(staging,"handler-sandbox-worker.mjs"));
  await rename(staging,releasePath); const previous=await db.query("select id,release_path from local_component_release where component_id=$1 and state='ACTIVE' order by activated_at desc limit 1",[component.componentId]);
  const inserted=await db.query(`insert into local_component_release(component_id,revision_id,release_key,source_digest,release_path,previous_release_id,state,generation_job_id) values ($1,$2,$3,$4,$5,$6,'STAGED',$7) returning id`,[component.componentId,revisionId,releaseKey,sourceDigest,releasePath,previous.rows[0]?.id??null,generationJobId??null]); const releaseId=String(inserted.rows[0].id);
  // Credential bytes are supplied on stdin only; argv and environment never contain the token.
  await installRuntimeCredential(config, component.code, runtimeToken);
  const current=path.join(componentRoot,"current"); const next=`${current}.next-${process.pid}`; await rm(next,{force:true}); await symlink(releasePath,next); await rename(next,current);
  const env=`KCML_COMPONENT_CODE=${component.code}\nKCML_RUNTIME_SOCKET=${config.RUNTIME_SOCKET_ROOT}/${component.code.toLowerCase()}.sock\nKCML_HANDLER_PATH=${current}/handler.mjs\nKCML_STATE_DIR=${componentRoot}/data\nKCML_SECRET_API_BASE=https://secrets.${config.PUBLIC_BASE_DOMAIN}\nKCML_COMPONENT_HOSTNAME=${component.hostname}\n`;
  await writeFile(path.join(componentRoot,"runtime.env"),env,{mode:0o640});
  try {
    await run(config.GENERATION_PRIVILEGED_HELPER,[previous.rowCount?"restart":"start",component.code.toLowerCase()],{timeoutMs:30_000});
  } catch (error) {
    // The symlink switch happens before service start so systemd always sees a complete release.
    // If start/restart fails, restore the previous filesystem release before surfacing the error;
    // otherwise a later generic rollback could skip one version because DB state still points at it.
    try {
      if (previous.rowCount) {
        const recovery=`${current}.recover-${process.pid}`;
        await rm(recovery,{force:true});
        await symlink(String(previous.rows[0].release_path),recovery);
        await rename(recovery,current);
        await run(config.GENERATION_PRIVILEGED_HELPER,["restart",component.code.toLowerCase()],{timeoutMs:30_000});
      } else {
        await rm(current,{force:true});
        try { await run(config.GENERATION_PRIVILEGED_HELPER,["stop",component.code.toLowerCase()],{timeoutMs:30_000}); } catch { /* best-effort stop during failed first activation */ }
      }
    } finally {
      await db.query("update local_component_release set state='FAILED' where id=$1 and state='STAGED'",[releaseId]);
    }
    throw error;
  }
  const activated = await tx(db,async(client)=>{
    if (generationJobId) {
      const job = await client.query("select state from generation_job where id=$1 for update", [generationJobId]);
      if (!job.rowCount || String(job.rows[0].state) === "CANCELLED") return false;
    }
    await client.query("update local_component_release set state='SUPERSEDED' where component_id=$1 and state='ACTIVE'",[component.componentId]);
    await client.query("update local_component_release set state='ACTIVE',activated_at=now() where id=$1",[releaseId]);
    await appendAudit(client,{eventType:"generated_component.release_activated",actorType:"system",objectType:"component",objectId:component.componentId,after:{releaseId,releaseKey,sourceDigest},correlationId});
    return true;
  });
  if (!activated) {
    await switchGeneratedCandidateRuntime({
      currentPath: current,
      previousReleasePath: previous.rowCount ? String(previous.rows[0].release_path) : null,
      componentCode: component.code.toLowerCase(),
      runPrivileged: async (operation, componentCode) => {
        await run(config.GENERATION_PRIVILEGED_HELPER, [operation, componentCode], { timeoutMs: 30_000 });
      }
    });
    await db.query("update local_component_release set state='ROLLED_BACK' where id=$1 and state='STAGED'", [releaseId]);
    throw new Error("generation_job_cancelled");
  }
  return {releaseId,releasePath,sourceDigest};
}

export async function rollbackGeneratedRelease(db: Db, config: GenerationRouteConfig, componentId: string, correlationId: string): Promise<void> {
  const active = await db.query(
    `select active.id,active.previous_release_id,c.code
       from local_component_release active
       join component c on c.id=active.component_id
      where active.component_id=$1 and active.state='ACTIVE'
      order by active.activated_at desc limit 1`,
    [componentId]
  );
  if (!active.rowCount || !active.rows[0].previous_release_id) throw new Error("generated_release_rollback_unavailable");
  const previous = await db.query("select * from local_component_release where id=$1", [active.rows[0].previous_release_id]);
  if (!previous.rowCount) throw new Error("generated_release_previous_missing");
  const code = String(active.rows[0].code).toLowerCase();
  const componentRoot = path.join(config.GENERATED_COMPONENT_ROOT, code);
  const current = path.join(componentRoot, "current");
  await switchGeneratedCandidateRuntime({
    currentPath: current,
    previousReleasePath: String(previous.rows[0].release_path),
    componentCode: code,
    runPrivileged: async (operation, componentCode) => {
      await run(config.GENERATION_PRIVILEGED_HELPER, [operation, componentCode], { timeoutMs: 30_000 });
    }
  });
  await tx(db, async (client) => {
    await client.query("update local_component_release set state='ROLLED_BACK' where id=$1", [active.rows[0].id]);
    await client.query("update local_component_release set state='ACTIVE',activated_at=now() where id=$1", [previous.rows[0].id]);
    if (previous.rows[0].revision_id) await client.query("update component set active_revision_id=$2,updated_at=now() where id=$1", [componentId, previous.rows[0].revision_id]);
    await appendAudit(client, {
      eventType: "generated_component.release_rolled_back", actorType: "system", objectType: "component", objectId: componentId,
      after: { releaseId: String(previous.rows[0].id), revisionId: previous.rows[0].revision_id ? String(previous.rows[0].revision_id) : null }, correlationId
    });
  });
}

export async function cancelGeneratedCandidateRelease(db: Db, config: GenerationRouteConfig, componentId: string, generationJobId: string, correlationId: string): Promise<void> {
  const active = await db.query(
    `select release.id,release.previous_release_id,c.code
       from local_component_release release
       join component c on c.id=release.component_id
      where release.component_id=$1 and release.state='ACTIVE' and release.generation_job_id=$2
      order by release.activated_at desc limit 1`,
    [componentId, generationJobId]
  );
  if (!active.rowCount) return;
  if (active.rows[0].previous_release_id) {
    await rollbackGeneratedRelease(db, config, componentId, correlationId);
    return;
  }
  const code = String(active.rows[0].code).toLowerCase();
  const componentRoot = path.join(config.GENERATED_COMPONENT_ROOT, code);
  await switchGeneratedCandidateRuntime({
    currentPath: path.join(componentRoot, "current"),
    previousReleasePath: null,
    componentCode: code,
    runPrivileged: async (operation, componentCode) => {
      await run(config.GENERATION_PRIVILEGED_HELPER, [operation, componentCode], { timeoutMs: 30_000 });
    }
  });
  await tx(db, async (client) => {
    await client.query("update local_component_release set state='ROLLED_BACK' where id=$1 and state='ACTIVE'", [active.rows[0].id]);
    await appendAudit(client, {
      eventType: "generated_component.release_cancelled", actorType: "system", objectType: "component", objectId: componentId,
      after: { generationJobId, releaseId: String(active.rows[0].id) }, correlationId
    });
  });
}


export async function waitForGeneratedRuntime(config: GenerationRouteConfig, component: ReservedGeneratedComponent, token: string): Promise<void> {
  const socketPath = path.join(config.RUNTIME_SOCKET_ROOT, `${component.code.toLowerCase()}.sock`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await stat(socketPath);
      const result = await run(process.execPath, [new URL("../generation/runtime-probe.mjs", import.meta.url).pathname, socketPath, token], { timeoutMs: 5_000 });
      if (result.stdout.includes("PASS")) return;
    } catch {
      // The candidate may still be starting; retry until the bounded deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  let status = "unavailable";
  try {
    const result = await run(config.GENERATION_PRIVILEGED_HELPER, ["status", component.code.toLowerCase()], { timeoutMs: 15_000 });
    status = result.stdout.trim().replace(/[^A-Za-z0-9_=.: -]/g, "").slice(0, 240) || status;
  } catch (error) {
    status = error instanceof Error ? error.message.replace(/[^A-Za-z0-9_=.: -]/g, "").slice(0, 240) : status;
  }
  throw new Error(`generated_runtime_probe_timeout:${status}`);
}


export async function verifyGeneratedHttpsRuntime(db: Db, config: GenerationRouteConfig, componentId: string, correlationId: string): Promise<void> {
  const rowResult = await db.query(
    `select c.code,c.hostname,c.active_revision_id,identity.stable_secret_name,r.manifest
       from component c
       join component_runtime_identity identity on identity.component_id=c.id
       join component_revision r on r.id=c.active_revision_id
      where c.id=$1 and c.registration_type='INTERNAL_GENERATED' and c.enabled=true and c.activation_state='ACTIVE'`,
    [componentId]
  );
  if (!rowResult.rowCount) throw new Error("generated_https_component_not_active");
  const row = rowResult.rows[0];
  const platform = await platformWorkerSecretPrincipal(db);
  const resolved = await resolveSecret(db, config, platform, String(row.stable_secret_name), correlationId);
  const base = `https://${String(row.hostname)}`;
  const discovery = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(10_000) });
  if (!discovery.ok) throw new Error(`generated_https_discovery_failed_${discovery.status}`);
  const discoveryJson = recordValue(await discovery.json());
  if (stringValue(discoveryJson?.resource) !== `${base}/mcp`) throw new Error("generated_https_discovery_resource_mismatch");
  const invoke = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${resolved.value}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "generation-https-check", method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!invoke.ok) throw new Error(`generated_https_mcp_failed_${invoke.status}`);
  const body = await invoke.json();
  const actual = responseTools(body);
  const manifest = row.manifest as ComponentManifest;
  const expected = manifest.tools.map((tool) => String(tool.name)).sort();
  if (canonical(actual) !== canonical(expected)) throw new Error("generated_https_tool_list_mismatch");
  let toolCallCount = 0;
  for (const tool of manifest.tools) {
    const scenario = manifest.e2eScenarios.find((candidate) => {
      const invocation = candidate.invocation as Record<string, unknown>;
      return invocation.kind === "TOOL" && invocation.name === tool.name;
    });
    if (!scenario) throw new Error(`generated_https_tool_fixture_missing:${String(tool.name)}`);
    const input = scenario.input as Record<string, unknown>;
    const expectedOutput = scenario.expected as Record<string, unknown>;
    const call = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${resolved.value}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `generation-https-call-${toolCallCount}`, method: "tools/call", params: { name: tool.name, arguments: input.json ?? {} } }),
      signal: AbortSignal.timeout(Math.max(15_000, Number(scenario.timeoutMs ?? 15_000)))
    });
    if (!call.ok) throw new Error(`generated_https_tool_call_http_${call.status}:${String(tool.name)}`);
    const callBody = await call.json();
    if (callBody?.error) throw new Error(`generated_https_tool_call_error:${String(tool.name)}:${String(callBody.error.message ?? "runtime_error")}`);
    if (canonical(callBody?.result?.structuredContent) !== canonical(expectedOutput.json)) throw new Error(`generated_https_tool_call_mismatch:${String(tool.name)}`);
    toolCallCount += 1;
  }
  if (toolCallCount !== manifest.tools.length) throw new Error("generated_https_tool_call_coverage_incomplete");
  await appendAudit(db, { eventType: "generated_component.https_conformance_passed", actorType: "system", objectType: "component", objectId: componentId, after: { hostname: row.hostname, toolCount: actual.length, toolCallCount }, correlationId });
}


function udsRequest(socketPath: string, method: string, requestPath: string, token?: string, payload?: unknown): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const request = http.request({ socketPath, method, path: requestPath, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json", "content-length": body.length } : {}) } }, (response) => {
      const chunks: Buffer[] = []; response.on("data", (chunk) => chunks.push(Buffer.from(chunk))); response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = {};
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        resolve({ status: response.statusCode ?? 0, json });
      });
    });
    request.on("error", reject); if (body) request.write(body); request.end();
  });
}

function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; const row=value as Record<string,unknown>; return `{${Object.keys(row).sort().map(key=>`${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`; }


async function verifyGeneratedAuthorizationEvidence(db: Db, config: GenerationRouteConfig, component: ReservedGeneratedComponent, revisionId: string, correlationId: string): Promise<void> {
  const probePrincipalId = randomUUID();
  const probePublicId = `KCML-GENERATION-PROBE-${randomUUID()}`;
  const probeToken = issueOpaqueSecret();
  const probeScope = "platform.control.readiness";
  const probeRoute = "/v1/kcml/readiness/probe";
  const call = (overrides: Partial<Parameters<typeof authorizeComponentCall>[1]> = {}) => authorizeComponentCall(db, {
    token: probeToken.value,
    audience: `https://${component.hostname}`,
    host: component.hostname,
    scope: probeScope,
    route: probeRoute,
    hmacKey: config.ACCESS_TOKEN_HMAC_KEY_BASE64,
    correlationId,
    ...overrides
  });
  let expiredConstraintEnforced = false;
  try {
    await db.query(
      `insert into principal(id,kind,public_id,status,policy_epoch,revocation_epoch,metadata)
       values ($1,'PLATFORM',$2,'ACTIVE',1,1,$3::jsonb)`,
      [probePrincipalId, probePublicId, JSON.stringify({ purpose: "internal_generation_readiness_probe", componentId: component.componentId })]
    );
    await db.query(
      `insert into principal_component_permission(source_principal_id,target_component_id,route_pattern,scope_name)
       values ($1,$2,$3,$4)`,
      [probePrincipalId, component.componentId, probeRoute, probeScope]
    );
    await db.query(
      `insert into principal_access_token(lookup_digest,key_id,fingerprint,source_principal_id,target_component_id,audience,scope_names,issued_policy_epoch,issued_revocation_epoch,expires_at)
       values ($1,$2,$3,$4,null,'*',$5::text[],1,1,'infinity')`,
      [hmacToken(probeToken.value, config.ACCESS_TOKEN_HMAC_KEY_BASE64), config.ACCESS_TOKEN_HMAC_KEY_ID, probeToken.fingerprint, probePrincipalId, [probeScope]]
    );
    const allowed = await call();
    const missingToken = await call({ token: `kca_missing_${randomUUID()}` });
    const wrongAudience = await call({ audience: "https://wrong-audience.invalid" });
    const missingScope = await call({ scope: "platform.control.scope-not-issued" });
    const wrongClientRejected = allowed.allow && !componentSourceIdentityMatches(allowed, { clientId: component.code, componentCode: component.code });

    const expiredSecret = issueOpaqueSecret();
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query("savepoint expired_token_probe");
      try {
        await client.query(
          `insert into principal_access_token(lookup_digest,key_id,fingerprint,source_principal_id,target_component_id,audience,scope_names,issued_policy_epoch,issued_revocation_epoch,expires_at)
           values ($1,$2,$3,$4,null,'*',$5::text[],1,1,now()-interval '1 second')`,
          [hmacToken(expiredSecret.value, config.ACCESS_TOKEN_HMAC_KEY_BASE64), config.ACCESS_TOKEN_HMAC_KEY_ID, expiredSecret.fingerprint, probePrincipalId, [probeScope]]
        );
      } catch (error) {
        expiredConstraintEnforced = Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23514");
        await client.query("rollback to savepoint expired_token_probe");
      }
      await client.query("rollback");
    } finally {
      client.release();
    }

    await db.query("update principal_component_permission set revoked_at=now() where source_principal_id=$1 and target_component_id=$2 and scope_name=$3", [probePrincipalId, component.componentId, probeScope]);
    const revokedPermission = await call();
    await db.query("update principal_component_permission set revoked_at=null where source_principal_id=$1 and target_component_id=$2 and scope_name=$3", [probePrincipalId, component.componentId, probeScope]);
    await db.query("update principal set revocation_epoch=revocation_epoch+1 where id=$1", [probePrincipalId]);
    const invalidEpoch = await call();

    const outcomes: Array<{ gate: typeof ACTIVATION_GATES[number]; pass: boolean; reasonCode: string; evidence: Record<string, unknown>; variant: string }> = [
      { gate: "NEGATIVE_AUTH_MISSING_TOKEN", pass: missingToken.reasonCode === "invalid_token", reasonCode: "unknown_bearer_rejected", evidence: { decision: missingToken }, variant: "unknown_bearer" },
      { gate: "NEGATIVE_AUTH_EXPIRED_TOKEN", pass: expiredConstraintEnforced, reasonCode: "expired_access_token_forbidden_by_database", evidence: { expiredConstraintEnforced }, variant: "long_lived_token_constraint" },
      { gate: "NEGATIVE_AUTH_WRONG_AUDIENCE", pass: wrongAudience.reasonCode === "invalid_audience", reasonCode: "wrong_audience_rejected", evidence: { decision: wrongAudience }, variant: "foreign_https_audience" },
      { gate: "NEGATIVE_AUTH_WRONG_CLIENT", pass: wrongClientRejected, reasonCode: "declared_client_binding_mismatch_rejected", evidence: { authenticatedClientId: allowed.sourceClientId, declaredClientId: component.code }, variant: "declared_client_mismatch" },
      { gate: "NEGATIVE_AUTH_MISSING_SCOPE", pass: missingScope.reasonCode === "insufficient_scope", reasonCode: "token_scope_missing_rejected", evidence: { decision: missingScope }, variant: "scope_not_issued" },
      { gate: "NEGATIVE_AUTH_REVOKED_PERMISSION", pass: revokedPermission.reasonCode === "insufficient_scope", reasonCode: "current_permission_revocation_rejected", evidence: { decision: revokedPermission }, variant: "live_permission_revocation" },
      { gate: "TOKEN_EPOCH_INVALIDATION", pass: invalidEpoch.reasonCode === "revoked_token", reasonCode: "revocation_epoch_change_rejected", evidence: { decision: invalidEpoch }, variant: "principal_revocation_epoch" }
    ];
    await tx(db, async (client) => {
      for (const outcome of outcomes) {
        await recordActiveGateEvidence(client, {
          componentId: component.componentId,
          revisionId,
          gate: outcome.gate,
          pass: outcome.pass,
          reasonCode: outcome.pass ? outcome.reasonCode : `${outcome.gate.toLowerCase()}_probe_failed`,
          evidence: outcome.evidence,
          correlationId,
          variant: outcome.variant
        });
      }
    });
    if (outcomes.some((outcome) => !outcome.pass)) throw new Error(`generated_authorization_probe_failed:${outcomes.filter((outcome) => !outcome.pass).map((outcome) => outcome.gate).join(",")}`);
  } finally {
    await db.query("delete from principal where id=$1", [probePrincipalId]).catch(() => undefined);
  }
}

async function verifyGeneratedSecretEvidence(db: Db, config: GenerationRouteConfig, component: ReservedGeneratedComponent, revisionId: string, correlationId: string): Promise<void> {
  const principal: SecretPrincipal = { kind: "COMPONENT", id: component.componentId, publicId: component.code, auditActorType: "component" };
  const grants = await db.query(
    `select secret.stable_name
       from secret_grant grant_row
       join secret_record secret on secret.id=grant_row.secret_id
      where grant_row.principal_kind='COMPONENT' and grant_row.revoked_at is null
        and (grant_row.principal_id=$1 or grant_row.principal_public_id=$2)
        and secret.status='ACTIVE' and secret.deleted_at is null
      order by secret.stable_name`,
    [component.componentId, component.code]
  );
  const grantCount = grants.rows.length;
  const resolved: Array<{ name: string; fingerprint: string; version: number }> = [];
  let allowed = true;
  for (const grant of grants.rows) {
    try {
      const value = await resolveSecret(db, config, principal, String(grant.stable_name), correlationId);
      resolved.push({ name: value.name, fingerprint: value.fingerprint, version: value.version });
    } catch {
      allowed = false;
    }
  }
  const deniedName = `KCML_GENERATION_DENIED_${randomUUID().replaceAll("-", "").toUpperCase()}`;
  let denied = false;
  try {
    await resolveSecret(db, config, principal, deniedName, correlationId);
  } catch (error) {
    denied = error instanceof Error && error.message === "secret_unavailable";
  }
  await tx(db, async (client) => {
    if (grantCount > 0) await recordActiveGateEvidence(client, {
      componentId: component.componentId,
      revisionId,
      gate: "SECRET_ALLOWED",
      pass: allowed,
      reasonCode: allowed ? "each_granted_secret_resolved" : "granted_secret_resolution_failed",
      evidence: { declaredGrantCount: grantCount, resolved },
      correlationId,
      variant: "all_current_grants"
    });
    await recordActiveGateEvidence(client, {
      componentId: component.componentId,
      revisionId,
      gate: "SECRET_DENIED",
      pass: denied,
      reasonCode: denied ? "ungranted_secret_denied" : "ungranted_secret_resolution_allowed",
      evidence: { deniedNameDigest: sha256File(Buffer.from(deniedName)), denied },
      correlationId,
      variant: "random_ungranted_name"
    });
  });
  if (!allowed || !denied) throw new Error(`generated_secret_probe_failed:${!allowed ? "allowed_resolution" : "ungranted_denial"}`);
}

async function recordGeneratedMeasuredGate(
  db: Db,
  component: ReservedGeneratedComponent,
  revisionId: string,
  gate: typeof ACTIVATION_GATES[number],
  pass: boolean,
  reasonCode: string,
  evidence: Record<string, unknown>,
  correlationId: string,
  variant: string
): Promise<void> {
  await tx(db, (client) => recordActiveGateEvidence(client, {
    componentId: component.componentId,
    revisionId,
    gate,
    pass,
    reasonCode: pass ? reasonCode : `${gate.toLowerCase()}_probe_failed`,
    evidence,
    correlationId,
    variant
  }));
}

async function verifyGeneratedPublicMcpBeforeActivation(
  db: Db,
  component: ReservedGeneratedComponent,
  revisionId: string,
  manifest: ComponentManifest,
  runtimeToken: string,
  correlationId: string
): Promise<void> {
  const startedAt = new Date().toISOString();
  const base = `https://${component.hostname}`;
  const list = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `generation-public-list-${randomUUID()}`, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!list.ok) throw new Error(`generated_public_mcp_list_http_${list.status}`);
  const listBody = await list.json();
  const listed = responseTools(listBody);
  const declared = manifest.tools.map((tool) => String(tool.name)).sort();
  if (canonical(listed) !== canonical(declared)) throw new Error("generated_public_mcp_tool_list_mismatch");
  await recordGeneratedMeasuredGate(db, component, revisionId, "TLS_IDENTITY", true,
    "canonical_https_tls_handshake_and_hostname_validation_passed",
    { hostname: component.hostname, url: `${base}/mcp`, transport: "HTTPS_CML_BOUNDARY" }, correlationId, "public_https_tls");
  await recordGeneratedMeasuredGate(db, component, revisionId, "EACH_TOOL_LISTED", true,
    "canonical_https_tools_list_matches_manifest", { hostname: component.hostname, declared, listed }, correlationId, "public_https_tools_list");

  const calls: Array<{ tool: string; leaseId: string; outputDigest: string }> = [];
  const negativeCalls: Array<{ tool: string; candidate: unknown; errorCode: number }> = [];
  const inputAjv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  for (const tool of manifest.tools) {
    const name = String(tool.name);
    const fixture = manifest.e2eScenarios.find((candidate) => {
      const invocation = candidate.invocation as Record<string, unknown>;
      return invocation.kind === "TOOL" && invocation.name === name;
    });
    if (!fixture) throw new Error(`generated_public_mcp_fixture_missing:${name}`);
    const input = fixture.input as JsonRecord;
    const expected = fixture.expected as JsonRecord;
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `generation-public-call-${randomUUID()}`, method: "tools/call", params: { name, arguments: input.json ?? {} } }),
      signal: AbortSignal.timeout(Math.max(15_000, Number(fixture.timeoutMs ?? 15_000)))
    });
    if (!response.ok) throw new Error(`generated_public_mcp_call_http_${response.status}:${name}`);
    const payload = await response.json();
    if (payload?.error) throw new Error(`generated_public_mcp_call_error:${name}:${String(payload.error.message ?? "runtime_error")}`);
    if (canonical(payload?.result?.structuredContent) !== canonical(expected.json)) throw new Error(`generated_public_mcp_output_mismatch:${name}`);
    const lease = await db.query(
      `select id,operation_name,input_digest,output_digest,success
         from component_operation_lease
        where source_principal_id=$1 and target_component_id=$2 and operation_kind='TOOL' and operation_name=$3
          and started_at >= $4::timestamptz and finished_at is not null and success is true
        order by finished_at desc limit 1`,
      [component.principalId, component.componentId, name, startedAt]
    );
    if (!lease.rowCount) throw new Error(`generated_public_mcp_operation_lease_missing:${name}`);
    calls.push({ tool: name, leaseId: String(lease.rows[0].id), outputDigest: String(lease.rows[0].output_digest ?? "") });

    const validateInput = inputAjv.compile(tool.inputSchema as object);
    const invalidCandidates: unknown[] = [null, [], {}, { __kcmlUnexpected: true }, "__kcml_invalid__", 42];
    const invalid = invalidCandidates.find((candidate) => !validateInput(candidate));
    if (invalid === undefined) throw new Error(`generated_public_mcp_negative_fixture_unavailable:${name}`);
    const beforeNegative = new Date().toISOString();
    const negative = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `generation-public-negative-${randomUUID()}`, method: "tools/call", params: { name, arguments: invalid } }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!negative.ok) throw new Error(`generated_public_mcp_negative_http_${negative.status}:${name}`);
    const negativePayload = await negative.json();
    if (Number(negativePayload?.error?.code) !== -32602) throw new Error(`generated_public_mcp_invalid_input_not_rejected:${name}`);
    const unexpectedLease = await db.query(
      `select id from component_operation_lease
        where source_principal_id=$1 and target_component_id=$2 and operation_kind='TOOL' and operation_name=$3
          and started_at >= $4::timestamptz
        order by started_at desc limit 1`,
      [component.principalId, component.componentId, name, beforeNegative]
    );
    if (unexpectedLease.rowCount) throw new Error(`generated_public_mcp_invalid_input_created_lease:${name}`);
    negativeCalls.push({ tool: name, candidate: invalid, errorCode: -32602 });
  }
  const evidence = { hostname: component.hostname, declaredTools: declared, calls };
  await recordGeneratedMeasuredGate(db, component, revisionId, "OPERATION_LEASE_ENFORCEMENT", calls.length === manifest.tools.length,
    "canonical_https_calls_created_successful_operation_leases", evidence, correlationId, "public_https_generated_runtime");
  await recordGeneratedMeasuredGate(db, component, revisionId, "EACH_TOOL_INPUT_NEGATIVE", negativeCalls.length === manifest.tools.length,
    "canonical_https_invalid_inputs_rejected_before_operation_lease", { calls: negativeCalls }, correlationId, "public_https_invalid_tool_input");

  const dependencies = await db.query(
    `select permission.target_component_id,permission.route_pattern,target.code target_code,target.hostname target_hostname
       from component_permission permission
       join component target on target.id=permission.target_component_id
      where permission.source_component_id=$1 and permission.target_component_id<>$1
        and permission.revoked_at is null and permission.access_level='INVOKE'
      order by target.code,permission.route_pattern`,
    [component.componentId]
  );
  if (dependencies.rowCount) {
    const dependencyEvidence: Array<Record<string, unknown>> = [];
    for (const dependency of dependencies.rows) {
      const match = /^\/mcp\/tools\/(.+)$/.exec(String(dependency.route_pattern));
      if (!match) throw new Error(`generated_dependency_route_not_canonical:${String(dependency.route_pattern)}`);
      const targetTool = match[1]!;
      const lease = await db.query(
        `select id,operation_name,success,finished_at
           from component_operation_lease
          where source_principal_id=$1 and target_component_id=$2 and operation_kind='TOOL' and operation_name=$3
            and started_at >= $4::timestamptz and finished_at is not null and success is true
          order by finished_at desc limit 1`,
        [component.principalId, dependency.target_component_id, targetTool, startedAt]
      );
      if (!lease.rowCount) throw new Error(`generated_dependency_runtime_dispatch_missing:${String(dependency.target_code)}:${targetTool}`);
      dependencyEvidence.push({ targetComponentCode: String(dependency.target_code), targetHostname: String(dependency.target_hostname), targetTool, leaseId: String(lease.rows[0].id) });
    }
    await recordGeneratedMeasuredGate(db, component, revisionId, "REGISTERED_TO_REGISTERED_DISPATCH", true,
      "canonical_public_source_calls_produced_target_operation_leases", { dependencies: dependencyEvidence }, correlationId, "canonical_generated_dependency_dispatch");
    await recordGeneratedMeasuredGate(db, component, revisionId, "DEPENDENCY_READY", true,
      "all_current_component_dependencies_invoked_successfully", { dependencies: dependencyEvidence }, correlationId, "canonical_generated_dependency_dispatch");
  }

  const outboundPermissions = await db.query(
    `select permission.id,target.target_key,target.base_url,permission.route_pattern,permission.scope_name
       from component_external_permission permission
       join component_external_target target on target.id=permission.external_target_id
      where permission.component_id=$1 and permission.revoked_at is null and target.status='ACTIVE' and target.target_key like 'generated-%'
      order by target.target_key,permission.route_pattern,permission.scope_name`,
    [component.componentId]
  );
  if (outboundPermissions.rowCount) {
    const outboundEvidence: Array<Record<string, unknown>> = [];
    for (const permission of outboundPermissions.rows) {
      const call = await db.query(
        `select id,route_path,scope_name,http_status,response_digest,completed_at
           from component_external_gateway_call
          where source_component_id=$1 and external_permission_id=$2 and status='SUCCEEDED'
            and created_at >= $3::timestamptz and completed_at is not null
          order by completed_at desc limit 1`,
        [component.componentId, permission.id, startedAt]
      );
      if (!call.rowCount) throw new Error(`generated_external_outbound_not_exercised:${String(permission.target_key)}:${String(permission.scope_name)}`);
      outboundEvidence.push({
        targetKey: String(permission.target_key), baseUrl: String(permission.base_url), routePattern: String(permission.route_pattern),
        scope: String(permission.scope_name), callId: String(call.rows[0].id), routePath: String(call.rows[0].route_path),
        httpStatus: Number(call.rows[0].http_status), responseDigest: String(call.rows[0].response_digest ?? "")
      });
    }
    await recordGeneratedMeasuredGate(db, component, revisionId, "EXTERNAL_TARGET_OUTBOUND", true,
      "canonical_cml_external_gateway_calls_succeeded", { calls: outboundEvidence }, correlationId, "generated_external_gateway_runtime");
  }
}

async function verifyGeneratedWebhookPublicIngress(
  db: Db,
  config: GenerationRouteConfig,
  component: ReservedGeneratedComponent,
  revisionId: string,
  manifest: ComponentManifest,
  correlationId: string
): Promise<void> {
  const webhookEndpoints = manifest.endpoints.filter((endpoint) => {
    const auth = recordValue(endpoint.auth);
    return stringValue(auth?.mode) === "EXTERNAL_WEBHOOK";
  });
  if (!webhookEndpoints.length) return;
  const componentSecretPrincipal: SecretPrincipal = { kind: "COMPONENT", id: component.componentId, publicId: component.code, auditActorType: "component" };
  const evidence: Array<Record<string, unknown>> = [];
  for (const endpoint of webhookEndpoints) {
    const endpointKey = String(endpoint.key);
    const endpointPath = String(endpoint.path);
    const method = String(endpoint.method);
    const auth = recordValue(endpoint.auth) ?? {};
    const verification = recordValue(auth.verification) ?? {};
    const verificationType = stringValue(verification.type);
    const base = `https://${component.hostname}${endpointPath}`;

    if (verificationType === "CHALLENGE_TOKEN" || verificationType === "CHALLENGE_AND_HMAC") {
      const secretName = stringValue(verification.challengeSecretName);
      const secret = await resolveSecret(db, config, componentSecretPrincipal, secretName, correlationId);
      const tokenQuery = stringValue(verification.challengeTokenQuery, "hub.verify_token");
      const valueQuery = stringValue(verification.challengeValueQuery, "hub.challenge");
      const challenge = `kcml-${randomUUID()}`;
      const url = new URL(base);
      url.searchParams.set(tokenQuery, secret.value);
      url.searchParams.set(valueQuery, challenge);
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
      const body = await response.text();
      if (!response.ok || body !== challenge) throw new Error(`generated_webhook_challenge_failed:${endpointKey}:${response.status}`);
      evidence.push({ endpointKey, kind: "challenge", status: response.status, challengeReturned: true, secretName });
    }

    if (verificationType === "HMAC_SHA256" || verificationType === "CHALLENGE_AND_HMAC") {
      const scenario = manifest.e2eScenarios.find((candidate) => {
        const invocation = candidate.invocation as Record<string, unknown>;
        return invocation.kind === "ENDPOINT" && invocation.name === endpointKey;
      });
      if (!scenario) throw new Error(`generated_webhook_callback_fixture_missing:${endpointKey}`);
      const input = scenario.input as JsonRecord;
      const expected = scenario.expected as JsonRecord;
      if (!Object.hasOwn(input, "json") || !Object.hasOwn(expected, "json")) throw new Error(`generated_webhook_json_fixture_required:${endpointKey}`);
      const bytes = Buffer.from(JSON.stringify(input.json));
      const secretName = stringValue(verification.signatureSecretName);
      const secret = await resolveSecret(db, config, componentSecretPrincipal, secretName, correlationId);
      const signatureHeader = stringValue(verification.signatureHeader, "x-hub-signature-256");
      const signaturePrefix = stringValue(verification.signaturePrefix, "sha256=");
      const signature = `${signaturePrefix}${createHmac("sha256", secret.value).update(bytes).digest("hex")}`;
      const response = await fetch(base, {
        method,
        headers: { "content-type": "application/json", [signatureHeader]: signature },
        body: bytes,
        signal: AbortSignal.timeout(Math.max(15_000, Number(scenario.timeoutMs ?? 15_000)))
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || canonical(payload) !== canonical(expected.json)) throw new Error(`generated_webhook_callback_failed:${endpointKey}:${response.status}`);
      evidence.push({ endpointKey, kind: "signed_callback", status: response.status, signatureHeader, secretName });
    }
  }
  await recordGeneratedMeasuredGate(db, component, revisionId, "EXTERNAL_PRINCIPAL_INBOUND", true,
    "public_provider_webhook_verification_and_runtime_dispatch_passed", { endpoints: evidence }, correlationId, "external_webhook_public_ingress");
}

async function verifyGeneratedRuntimeStateAndTransitions(
  db: Db,
  component: ReservedGeneratedComponent,
  revisionId: string,
  manifest: ComponentManifest,
  socketPath: string,
  runtimeToken: string,
  correlationId: string
): Promise<void> {
  const state = await udsRequest(socketPath, "POST", "/v1/kcml/control/state", runtimeToken, {});
  if (state.status !== 200) throw new Error(`generated_runtime_state_http_${state.status}`);
  const stateJson = recordValue(state.json) ?? {};
  const actualStates = statePayload(state.json);
  const stateEvidence: Array<Record<string, unknown>> = [];
  const stateAjv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  for (const declaredState of manifest.states.states) {
    const key = String(declaredState.key);
    if (!Object.hasOwn(actualStates, key)) throw new Error(`generated_runtime_state_missing:${key}`);
    const validate = stateAjv.compile(declaredState.schema as object);
    const pass = validate(actualStates[key]);
    if (!pass) throw new Error(`generated_runtime_state_schema_failed:${key}:${JSON.stringify(validate.errors ?? [])}`);
    stateEvidence.push({ key, valid: true });
  }
  await recordGeneratedMeasuredGate(db, component, revisionId, "STATE_FULL_SNAPSHOT", true,
    "runtime_state_snapshot_observed", { state: recordValue(stateJson.state) ?? null, declaredStates: stateEvidence }, correlationId, "runtime_state_probe");
  await recordGeneratedMeasuredGate(db, component, revisionId, "EACH_STATE_SCHEMA", true,
    "each_declared_state_schema_validated_against_runtime", { states: stateEvidence }, correlationId, "runtime_state_probe");

  if (!manifest.states.transitions.length) return;
  const transitions: Array<Record<string, unknown>> = [];
  for (const declared of manifest.states.transitions) {
    const input = { from: String(declared.from), to: String(declared.to), trigger: String(declared.trigger) };
    const response = await udsRequest(socketPath, "POST", "/v1/kcml/runtime/transition", runtimeToken, input);
    if (response.status !== 200) throw new Error(`generated_runtime_transition_failed:${input.from}:${input.to}:${response.status}`);
    const states = statePayload(response.json);
    for (const stateContract of manifest.states.states) {
      const key = String(stateContract.key);
      if (!Object.hasOwn(states, key)) continue;
      const validate = stateAjv.compile(stateContract.schema as object);
      if (!validate(states[key])) throw new Error(`generated_runtime_transition_state_invalid:${input.from}:${input.to}:${key}`);
    }
    transitions.push({ ...input, status: response.status });
  }
  await recordGeneratedMeasuredGate(db, component, revisionId, "EACH_STATE_TRANSITION", true,
    "each_declared_transition_executed", { transitions }, correlationId, "runtime_transition_probe");
}

async function verifyGeneratedRuntimeSecretsAndStorage(
  db: Db,
  component: ReservedGeneratedComponent,
  revisionId: string,
  socketPath: string,
  runtimeToken: string,
  correlationId: string
): Promise<void> {
  const grants = await db.query(
    `select distinct secret.stable_name
       from secret_grant grant_row
       join secret_record secret on secret.id=grant_row.secret_id
      where grant_row.principal_kind='COMPONENT' and grant_row.revoked_at is null
        and (grant_row.principal_id=$1 or grant_row.principal_public_id=$2)
        and secret.status='ACTIVE' and secret.deleted_at is null
      order by secret.stable_name`,
    [component.componentId, component.code]
  );
  const runtimeResolutions: Array<Record<string, unknown>> = [];
  for (const row of grants.rows) {
    const name = String(row.stable_name);
    const response = await udsRequest(socketPath, "POST", "/v1/kcml/runtime/secret-probe", runtimeToken, { name });
    const payload = recordValue(response.json) ?? {};
    if (response.status !== 200 || payload.resolved !== true || stringValue(payload.name) !== name) throw new Error(`generated_runtime_secret_resolve_failed:${name}:${response.status}`);
    runtimeResolutions.push({ name, fingerprint: stringValue(payload.fingerprint) });
  }
  if (grants.rowCount) await recordGeneratedMeasuredGate(db, component, revisionId, "SECRET_ALLOWED_RUNTIME", true,
    "runtime_resolved_each_current_component_secret_grant",
    { grants: runtimeResolutions, declaredGrantCount: grants.rowCount }, correlationId, "runtime_secret_api");

  const storage = await udsRequest(socketPath, "POST", "/v1/kcml/runtime/storage-probe", runtimeToken, {});
  const storagePayload = recordValue(storage.json) ?? {};
  if (storage.status !== 200 || storagePayload.persistent !== true) throw new Error(`generated_runtime_storage_probe_failed:${storage.status}`);
  await recordGeneratedMeasuredGate(db, component, revisionId, "PERSISTENT_STORAGE_MOUNT", true,
    "runtime_persistent_storage_round_trip_passed", { stateDir: stringValue(storagePayload.stateDir), digest: stringValue(storagePayload.digest) }, correlationId, "runtime_storage_round_trip");
}

async function verifyGeneratedWorkerSingleton(
  db: Db,
  config: GenerationRouteConfig,
  component: ReservedGeneratedComponent,
  revisionId: string,
  statePid: number,
  correlationId: string
): Promise<void> {
  const status = await run(config.GENERATION_PRIVILEGED_HELPER, ["status", component.code.toLowerCase()], { timeoutMs: 15_000 });
  const values = Object.fromEntries(status.stdout.trim().split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((pair) => pair.length === 2));
  const mainPid = Number(values.MainPID ?? 0);
  const pass = values.ActiveState === "active" && mainPid > 0 && mainPid === statePid;
  await recordGeneratedMeasuredGate(db, component, revisionId, "WORKER_SINGLE_ACTIVE", pass,
    "systemd_single_active_worker_matches_runtime_pid", { activeState: values.ActiveState ?? null, mainPid, runtimePid: statePid, restarts: Number(values.NRestarts ?? 0) }, correlationId, "systemd_runtime_identity");
  if (!pass) throw new Error(`generated_runtime_worker_singleton_failed:${values.ActiveState ?? "unknown"}:${mainPid}:${statePid}`);
}

export async function verifyGeneratedComponentConformance(db: Db, config: GenerationRouteConfig, component: ReservedGeneratedComponent, revisionId: string, manifest: ComponentManifest, runtimeToken: string, correlationId: string): Promise<void> {
  const socketPath = path.join(config.RUNTIME_SOCKET_ROOT, `${component.code.toLowerCase()}.sock`);

  let watchdogEvidence: Record<string, unknown>;
  try {
    watchdogEvidence = await probeUdsComponentRuntime(socketPath);
    await db.query("update component_runtime_target set status='HEALTHY',last_probe_at=now(),last_dispatch_error=null where component_id=$1 and revision_id=$2", [component.componentId, revisionId]);
    await recordComponentMonitoringWatchdog(db, { componentId: component.componentId, pass: true, evidence: watchdogEvidence, correlationId });
  } catch (error) {
    watchdogEvidence = { socketPath, error: error instanceof Error ? error.message : "runtime_probe_failed" };
    await db.query("update component_runtime_target set status='FAILED',last_probe_at=now(),last_dispatch_error=$3 where component_id=$1 and revision_id=$2", [component.componentId, revisionId, String(watchdogEvidence.error)]);
    await recordComponentMonitoringWatchdog(db, { componentId: component.componentId, pass: false, evidence: watchdogEvidence, correlationId });
    throw error;
  }

  const missing = await udsRequest(socketPath, "POST", "/mcp", undefined, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const wrong = await udsRequest(socketPath, "POST", "/mcp", "kca_" + "x".repeat(88), { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  if (missing.status !== 401 || wrong.status !== 401) throw new Error("generated_runtime_negative_auth_failed");
  const initialized = await udsRequest(socketPath, "POST", "/mcp", runtimeToken, { jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
  const listed = await udsRequest(socketPath, "POST", "/mcp", runtimeToken, { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
  if (initialized.status !== 200 || listed.status !== 200) throw new Error("generated_runtime_mcp_handshake_failed");
  const listedNames = responseTools(listed.json);
  const expectedNames = manifest.tools.map((tool) => String(tool.name)).sort();
  if (canonical(listedNames) !== canonical(expectedNames)) throw new Error("generated_runtime_tool_list_mismatch");

  await verifyGeneratedPublicMcpBeforeActivation(db, component, revisionId, manifest, runtimeToken, correlationId);

  const disabled = await udsRequest(socketPath, "POST", "/v1/kcml/control/disable", runtimeToken, {});
  const disabledReady = await udsRequest(socketPath, "GET", "/ready");
  const enabled = await udsRequest(socketPath, "POST", "/v1/kcml/control/enable", runtimeToken, {});
  const enabledReady = await udsRequest(socketPath, "GET", "/ready");
  if (disabled.status !== 200 || disabledReady.status !== 503 || enabled.status !== 200 || enabledReady.status !== 200) throw new Error("generated_runtime_enable_disable_contract_failed");
  await recordGeneratedMeasuredGate(db, component, revisionId, "DISABLE_CONTROL", true, "runtime_disable_ack_and_readiness_closed", { ackStatus: disabled.status, readyStatus: disabledReady.status }, correlationId, "runtime_control_cycle");
  await recordGeneratedMeasuredGate(db, component, revisionId, "ENABLE_CONTROL", true, "runtime_enable_ack_and_readiness_opened", { ackStatus: enabled.status, readyStatus: enabledReady.status }, correlationId, "runtime_control_cycle");
  await recordGeneratedMeasuredGate(db, component, revisionId, "DRAIN_HANDOFF", true, "disable_closed_readiness_before_reenable", { disabledReadyStatus: disabledReady.status, enabledReadyStatus: enabledReady.status }, correlationId, "runtime_control_cycle");

  await verifyGeneratedRuntimeStateAndTransitions(db, component, revisionId, manifest, socketPath, runtimeToken, correlationId);
  const state = await udsRequest(socketPath, "POST", "/v1/kcml/control/state", runtimeToken, {});
  const statePid = Number(recordValue(recordValue(state.json)?.state)?.pid ?? 0);
  if (!Number.isInteger(statePid) || statePid <= 0) throw new Error("generated_runtime_state_pid_missing");
  await verifyGeneratedWorkerSingleton(db, config, component, revisionId, statePid, correlationId);

  await verifyGeneratedAuthorizationEvidence(db, config, component, revisionId, correlationId);
  await verifyGeneratedSecretEvidence(db, config, component, revisionId, correlationId);
  await verifyGeneratedRuntimeSecretsAndStorage(db, component, revisionId, socketPath, runtimeToken, correlationId);
  await verifyGeneratedWebhookPublicIngress(db, config, component, revisionId, manifest, correlationId);

  const gates = await gateResults(db, component.componentId, manifest, {});
  await tx(db, (client) => persistGateEvidence(client, component.componentId, revisionId, gates, correlationId));
  const failed = gates.filter((gate) => gate.status !== "PASS" && gate.status !== "NOT_APPLICABLE");
  if (failed.length) throw new Error(`generated_cml_conformance_failed:${failed.map((gate) => `${gate.gate}:${gate.reasonCode}`).join(",")}`);

  await tx(db, async (client) => {
    await client.query("update component_revision set validation_state='APPROVED',approved_at=now() where id=$1", [revisionId]);
    await client.query("update principal set status='ACTIVE',updated_at=now() where id=$1", [component.principalId]);
    await client.query("update component set lifecycle_state='APPROVED',activation_state='READY_FOR_ACTIVATION',operational_state='HEALTHY',monitoring_state='HEALTHY',updated_at=now() where id=$1", [component.componentId]);
    await client.query("update local_component_release set conformance_passed_at=now() where component_id=$1 and revision_id=$2 and state='ACTIVE'", [component.componentId, revisionId]);
    await appendAudit(client, { eventType: "generated_component.cml_conformance_passed", actorType: "system", objectType: "component", objectId: component.componentId, after: { gateCount: gates.length, watchdogEvidence }, correlationId });
  });
}
