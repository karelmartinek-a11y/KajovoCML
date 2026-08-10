import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import { z } from "zod";
import type { ExternalApiGatewayConfig, ExternalApiRegistrationConfig, EgressClientConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { closeAlert, raiseAlert } from "./alerts.js";
import { fetchThroughEgress } from "./egress-client.js";
import type { ExternalApiRegistrationManifest } from "./managed-service-types.js";
import { digestCanonicalJson } from "./registration.js";

const ajv = new Ajv2020({ strict: true, allErrors: true });

const ownerSchema = z.object({
  service: z.string().trim().min(2).max(160),
  technical: z.string().trim().min(2).max(160),
  security: z.string().trim().min(2).max(160),
  operations: z.string().trim().min(2).max(160)
}).strict();

const contactsSchema = z.object({
  serviceEmail: z.string().email().max(254),
  technicalEmail: z.string().email().max(254),
  securityEmail: z.string().email().max(254),
  operationsOnCall: z.string().trim().min(5).max(300)
}).strict();

const governanceSchema = z.object({
  criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  classification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
  containsPersonalData: z.boolean(),
  exportAllowed: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
  loggingPolicy: z.string().trim().min(5).max(500),
  redactionFields: z.array(z.string().trim().min(1).max(80)).max(50)
}).strict();

const evidenceRefSchema = z.string().regex(/^evidence\/[a-z0-9][a-z0-9_./-]{1,240}$/i);

const operationSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{2,119}$/),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().regex(/^\/[A-Za-z0-9._~/%{}:-]*$/),
  requiredScopes: z.array(z.string().regex(/^[a-z][a-z0-9._:-]{2,119}$/)).min(1).max(20),
  idempotency: z.enum(["READ_ONLY", "IDEMPOTENT", "NON_IDEMPOTENT"]),
  requestSchema: z.record(z.string(), z.unknown()),
  responseSchema: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().min(100).max(60000),
  maxPayloadBytes: z.number().int().min(1).max(5_242_880)
}).strict();

const externalApiManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  serviceKind: z.literal("EXTERNAL_API"),
  environment: z.enum(["production", "staging"]),
  registrationRevision: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/i),
  displayName: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(2000),
  serviceIdentity: z.object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/),
    region: z.string().trim().min(2).max(80),
    basePath: z.string().regex(/^\/[A-Za-z0-9._~/-]*$/)
  }).strict(),
  owners: ownerSchema,
  contacts: contactsSchema,
  governance: governanceSchema,
  review: z.object({
    intervalDays: z.number().int().min(1).max(365),
    approvedAt: z.string().datetime({ offset: true }),
    reviewDueAt: z.string().datetime({ offset: true })
  }).strict(),
  auth: z.object({
    mode: z.literal("NONE"),
    tokenEndpointUrl: z.null(),
    jwksUrl: z.null(),
    authMetadataUrl: z.null(),
    gatewayEnforced: z.literal(true)
  }).strict(),
  endpoints: z.object({
    baseUrl: z.string().url().startsWith("https://"),
    healthcheckUrl: z.string().url().startsWith("https://").nullable(),
    readinessUrl: z.string().url().startsWith("https://").nullable()
  }).strict(),
  operations: z.array(operationSchema).min(1).max(100),
  rateLimit: z.object({
    windowSeconds: z.number().int().min(1).max(86400),
    maxRequests: z.number().int().min(1).max(100000)
  }).strict(),
  timeoutMs: z.number().int().min(100).max(60000),
  monitoringProfile: z.object({
    staleAfterSeconds: z.number().int().min(30).max(7200),
    probeIntervals: z.object({
      healthSeconds: z.number().int().min(15).max(300),
      readinessSeconds: z.number().int().min(15).max(300),
      tlsSeconds: z.number().int().min(60).max(3600),
      acceptanceSeconds: z.number().int().min(30).max(600)
    }).strict(),
    alertRules: z.array(z.object({
      probeType: z.string().min(2).max(120),
      severity: z.enum(["WARNING", "HIGH", "CRITICAL"]),
      consecutiveFailures: z.number().int().min(1).max(20)
    }).strict()).min(1).max(50),
    runbookRef: evidenceRefSchema
  }).strict(),
  loggingContract: z.object({
    correlationHeader: z.string().trim().min(2).max(80),
    redactHeaders: z.array(z.string().trim().min(2).max(80)).max(50)
  }).strict(),
  stateContract: z.object({
    operationalStatePath: z.string().regex(/^\/[A-Za-z0-9._~/%-]*$/),
    apiAcceptancePath: z.string().regex(/^\/[A-Za-z0-9._~/%-]*$/)
  }).strict(),
  egressPolicy: z.object({
    redirectsAllowed: z.literal(false),
    allowlist: z.array(z.string().regex(/^[a-z0-9.-]+(?::\d+)?$/i)).min(1).max(50)
  }).strict(),
  errorCatalog: z.array(z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/),
    description: z.string().trim().min(5).max(500),
    classification: z.enum(["FIXABLE", "TRANSIENT", "SECURITY_BLOCKER", "INTERNAL"]),
    retryable: z.boolean()
  }).strict()).min(1).max(100),
  evidence: z.object({
    contractRefs: z.array(evidenceRefSchema).min(1).max(50),
    securityRefs: z.array(evidenceRefSchema).min(1).max(50),
    runbookRefs: z.array(evidenceRefSchema).min(1).max(50)
  }).strict()
}).strict();

type ExternalOperation = ExternalApiRegistrationManifest["operations"][number];
type ExternalApiProbeGate = { status: "PASS" | "FAIL"; evidence: Record<string, unknown> };
type ExternalApiProbeGates = {
  G01_SCHEMA: ExternalApiProbeGate;
  G02_INTENT_BINDING: ExternalApiProbeGate;
  G03_OWNERSHIP: ExternalApiProbeGate;
  G04_ARTIFACT_INTEGRITY: ExternalApiProbeGate;
  G05_ENDPOINT_SAFETY: ExternalApiProbeGate;
  G06_AUTH_ACCEPTANCE: ExternalApiProbeGate;
  G07_SCOPE_ENFORCEMENT: ExternalApiProbeGate;
  G08_STATE_CONTRACTS: ExternalApiProbeGate;
  G09_LOGGING: ExternalApiProbeGate;
  G10_MONITORING: ExternalApiProbeGate;
  G11_DISABLE_ENFORCEMENT: ExternalApiProbeGate;
  G12_PERMISSION_MUTATION: ExternalApiProbeGate;
  G13_RESILIENCE: ExternalApiProbeGate;
  G14_REGISTRATION_FINALIZATION: ExternalApiProbeGate;
};
type ExternalApiIntentContext = {
  serviceKind: string;
  allowedPipeline: string;
  descriptor: Record<string, unknown>;
  manifestDigest: string;
  correlationId: string;
};

const acceptanceStateSchema = z.object({
  serviceKind: z.literal("EXTERNAL_API"),
  schemaVersion: z.literal("1.0"),
  gatewayEnforced: z.boolean(),
  directBypassBlocked: z.boolean(),
  requiredGatewayHeaders: z.array(z.string()).min(1),
  operations: z.array(z.object({
    operationId: z.string(),
    method: z.string(),
    path: z.string(),
    requiredScopes: z.array(z.string())
  })),
  logging: z.object({
    correlationHeader: z.string(),
    redactHeaders: z.array(z.string())
  }),
  monitoring: z.object({
    staleAfterSeconds: z.number().int().positive(),
    probeIntervals: z.object({
      healthSeconds: z.number().int().positive(),
      readinessSeconds: z.number().int().positive(),
      tlsSeconds: z.number().int().positive(),
      acceptanceSeconds: z.number().int().positive()
    })
  }),
  disableMode: z.string(),
  permissionMutationMode: z.string(),
  redirectsAllowed: z.boolean().optional(),
  maxSupportedTimeoutMs: z.number().int().positive().optional()
}).passthrough();

const operationalStateSchema = z.object({
  healthy: z.boolean(),
  ready: z.boolean(),
  recentRequests: z.array(z.record(z.string(), z.unknown())).optional()
}).passthrough();

function compileValidator(schema: Record<string, unknown>): ValidateFunction {
  return ajv.compile(schema as AnySchema);
}

function validateJsonSchemas(manifest: ExternalApiRegistrationManifest): void {
  for (const operation of manifest.operations) {
    compileValidator(operation.requestSchema);
    compileValidator(operation.responseSchema);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function passGate(evidence: Record<string, unknown>): ExternalApiProbeGate {
  return { status: "PASS", evidence };
}

function failGate(evidence: Record<string, unknown>): ExternalApiProbeGate {
  return { status: "FAIL", evidence };
}

function gateEvidence(input: {
  gate: keyof ExternalApiProbeGates;
  correlationId: string;
  code: string;
  classification: "OK" | "FIXABLE" | "TRANSIENT" | "SECURITY_BLOCKER" | "INTERNAL";
  retryable: boolean;
  remediation: string;
  evidenceRefs: string[];
  detail: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    code: input.code,
    classification: input.classification,
    retryable: input.retryable,
    gate: input.gate,
    correlationId: input.correlationId,
    remediation: input.remediation,
    evidenceRefs: input.evidenceRefs,
    detail: input.detail
  };
}

function normalizeDescriptor(input: Record<string, unknown>): { serviceOwner: string | null; technicalOwner: string | null; criticality: string | null } {
  return {
    serviceOwner: typeof input.serviceOwner === "string" ? input.serviceOwner.trim() : null,
    technicalOwner: typeof input.technicalOwner === "string" ? input.technicalOwner.trim() : null,
    criticality: typeof input.criticality === "string" ? input.criticality.trim() : null
  };
}

function evaluateOwnershipGate(
  manifest: ExternalApiRegistrationManifest,
  descriptor: Record<string, unknown>
): ExternalApiProbeGate {
  const intent = normalizeDescriptor(descriptor);
  const mismatches = [
    intent.serviceOwner === manifest.owners.service ? null : "serviceOwner",
    intent.technicalOwner === manifest.owners.technical ? null : "technicalOwner",
    intent.criticality === manifest.governance.criticality ? null : "criticality"
  ].filter((value): value is string => value !== null);
  return mismatches.length
    ? failGate({
      mismatches,
      descriptor: intent,
      manifestOwners: {
        service: manifest.owners.service,
        technical: manifest.owners.technical,
        criticality: manifest.governance.criticality
      }
    })
    : passGate({
      serviceOwner: manifest.owners.service,
      technicalOwner: manifest.owners.technical,
      criticality: manifest.governance.criticality
    });
}

function validateManifestInvariants(manifest: ExternalApiRegistrationManifest): void {
  validateJsonSchemas(manifest);
  const scopeNames = manifest.operations.flatMap((operation) => operation.requiredScopes);
  if (!scopeNames.length) throw new Error("scope_catalog_empty");
  if (new Set(manifest.operations.map((operation) => operation.operationId)).size !== manifest.operations.length) throw new Error("duplicate_operation_id");
  if (new Set(manifest.operations.map((operation) => `${operation.method}:${operation.path}`)).size !== manifest.operations.length) {
    throw new Error("duplicate_operation_route");
  }
  if (!manifest.endpoints.baseUrl.startsWith("https://")) throw new Error("base_url_must_be_https");
  const approvedAt = new Date(manifest.review.approvedAt).getTime();
  const reviewDueAt = new Date(manifest.review.reviewDueAt).getTime();
  if (!Number.isFinite(approvedAt) || !Number.isFinite(reviewDueAt)) throw new Error("review_dates_invalid");
  if (Math.abs(reviewDueAt - (approvedAt + manifest.review.intervalDays * 86_400_000)) > 1_000) throw new Error("review_interval_mismatch");
  const manifestBaseUrl = new URL(manifest.endpoints.baseUrl);
  const manifestHost = `${manifestBaseUrl.hostname.toLowerCase()}:${manifestBaseUrl.port || "443"}`;
  if (!manifest.egressPolicy.allowlist.some((entry) => entry.toLowerCase() === manifestHost)) throw new Error("base_url_not_in_allowlist");
  if (manifest.monitoringProfile.staleAfterSeconds < Math.max(
    manifest.monitoringProfile.probeIntervals.healthSeconds,
    manifest.monitoringProfile.probeIntervals.readinessSeconds,
    manifest.monitoringProfile.probeIntervals.tlsSeconds,
    manifest.monitoringProfile.probeIntervals.acceptanceSeconds
  )) throw new Error("monitoring_stale_window_too_short");
}

export function validateExternalApiManifest(input: unknown): { manifest: ExternalApiRegistrationManifest; digest: string } {
  const manifest = externalApiManifestSchema.parse(input);
  validateManifestInvariants(manifest);
  return {
    manifest,
    digest: `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`
  };
}

export function externalApiEvidenceReferences(manifest: ExternalApiRegistrationManifest): string[] {
  return uniqueSorted([
    ...manifest.evidence.contractRefs,
    ...manifest.evidence.securityRefs,
    ...manifest.evidence.runbookRefs,
    manifest.monitoringProfile.runbookRef
  ]);
}

export function externalApiScopeCatalog(manifest: ExternalApiRegistrationManifest): string[] {
  return uniqueSorted(manifest.operations.flatMap((operation) => operation.requiredScopes));
}

function templatePattern(pathTemplate: string): { matcher: RegExp; keys: string[] } {
  const keys: string[] = [];
  const escaped = pathTemplate.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{([A-Za-z0-9_]+)\\\}/g, (_match, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { matcher: new RegExp(`^${escaped}$`), keys };
}

export function matchExternalApiOperation(
  manifest: ExternalApiRegistrationManifest,
  method: string,
  path: string
): { operation: ExternalOperation; params: Record<string, string> } | null {
  for (const operation of manifest.operations) {
    if (operation.method !== method.toUpperCase()) continue;
    const compiled = templatePattern(operation.path);
    const match = compiled.matcher.exec(path);
    if (!match) continue;
    const params = Object.fromEntries(compiled.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? "")]));
    return { operation, params };
  }
  return null;
}

export function validateExternalApiRequest(operation: ExternalOperation, body: unknown): void {
  const validator = compileValidator(operation.requestSchema);
  if (!validator(body)) throw Object.assign(new Error("request_schema_invalid"), { detail: validator.errors });
}

export function validateExternalApiResponse(operation: ExternalOperation, body: unknown): void {
  const validator = compileValidator(operation.responseSchema);
  if (!validator(body)) throw Object.assign(new Error("response_schema_invalid"), { detail: validator.errors });
}

async function egressJsonRequest<T>(
  config: EgressClientConfig,
  manifest: ExternalApiRegistrationManifest,
  correlationId: string,
  purpose: string,
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
  options?: { body?: Buffer; headers?: Record<string, string>; managedServiceId?: string | null; maxBytes?: number }
): Promise<{ status: number; body: Buffer; json: T | null }> {
  const response = await fetchThroughEgress(config, {
    url,
    method,
    headers: options?.headers,
    body: options?.body,
    allowlist: manifest.egressPolicy.allowlist,
    purpose,
    correlationId,
    managedServiceId: options?.managedServiceId ?? null
  });
  if (options?.maxBytes && response.body.length > options.maxBytes) throw new Error("response_too_large");
  return {
    status: response.status,
    body: response.body,
    json: response.body.length ? JSON.parse(response.body.toString("utf8")) as T : null
  };
}

export async function probeExternalApiManifest(
  config: ExternalApiRegistrationConfig,
  manifest: ExternalApiRegistrationManifest,
  context: ExternalApiIntentContext
): Promise<ExternalApiProbeGates> {
  const baseUrl = new URL(manifest.endpoints.baseUrl);
  const evidenceRefs = externalApiEvidenceReferences(manifest);
  const tlsProbe = await egressJsonRequest<Record<string, unknown>>(
    config,
    manifest,
    context.correlationId,
    "external_api.probe.tls",
    baseUrl.toString(),
    "HEAD",
    { maxBytes: 16_384 }
  ).then(
    () => passGate(gateEvidence({
      gate: "G05_ENDPOINT_SAFETY",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_TLS_OK",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs,
      detail: { host: baseUrl.hostname }
    })),
    (error: unknown) => failGate(gateEvidence({
      gate: "G05_ENDPOINT_SAFETY",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_TLS_FAILED",
      classification: "SECURITY_BLOCKER",
      retryable: false,
      remediation: "Fix the upstream TLS endpoint or egress allowlist before registration is retried.",
      evidenceRefs,
      detail: { error: error instanceof Error ? error.message : "tls_failed" }
    }))
  );
  const healthcheckUrl = manifest.endpoints.healthcheckUrl;
  const healthProbe = healthcheckUrl
    ? await (async () => {
      const response = await egressJsonRequest<Record<string, unknown>>(
        config,
        manifest,
        context.correlationId,
        "external_api.probe.health",
        healthcheckUrl,
        "GET",
        { maxBytes: 256_000 }
      );
      if (response.status !== 200) throw new Error(`health_status_${response.status}`);
      return passGate(gateEvidence({
        gate: "G08_STATE_CONTRACTS",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_HEALTH_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { url: healthcheckUrl, status: response.status }
      }));
    })().catch((error: unknown) => failGate(gateEvidence({
      gate: "G08_STATE_CONTRACTS",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_HEALTH_FAILED",
      classification: "TRANSIENT",
      retryable: true,
      remediation: "Restore the health endpoint and retry registration after the probe returns HTTP 200.",
      evidenceRefs,
      detail: { error: error instanceof Error ? error.message : "health_failed" }
    })))
    : passGate(gateEvidence({
      gate: "G08_STATE_CONTRACTS",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_HEALTH_SKIPPED",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs,
      detail: { skipped: true }
    }));
  const readinessUrl = manifest.endpoints.readinessUrl;
  const readinessProbe = readinessUrl
    ? await (async () => {
      const response = await egressJsonRequest<Record<string, unknown>>(
        config,
        manifest,
        context.correlationId,
        "external_api.probe.readiness",
        readinessUrl,
        "GET",
        { maxBytes: 256_000 }
      );
      if (response.status !== 200) throw new Error(`readiness_status_${response.status}`);
      return passGate(gateEvidence({
        gate: "G08_STATE_CONTRACTS",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_READINESS_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { url: readinessUrl, status: response.status }
      }));
    })().catch((error: unknown) => failGate(gateEvidence({
      gate: "G08_STATE_CONTRACTS",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_READINESS_FAILED",
      classification: "TRANSIENT",
      retryable: true,
      remediation: "Restore the readiness endpoint and retry registration after the probe returns HTTP 200.",
      evidenceRefs,
      detail: { error: error instanceof Error ? error.message : "readiness_failed" }
    })))
    : passGate(gateEvidence({
      gate: "G08_STATE_CONTRACTS",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_READINESS_SKIPPED",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs,
      detail: { skipped: true }
    }));
  const operationalStateUrl = new URL(manifest.stateContract.operationalStatePath, manifest.endpoints.baseUrl).toString();
  const operationalState = await egressJsonRequest<z.infer<typeof operationalStateSchema>>(
    config,
    manifest,
    context.correlationId,
    "external_api.probe.operational_state",
    operationalStateUrl,
    "GET",
    { maxBytes: 256_000 }
  ).then((response) => ({
    response,
    parsed: operationalStateSchema.parse(response.json ?? {})
  })).catch((error: unknown) => ({ error }));
  const acceptanceStateUrl = new URL(manifest.stateContract.apiAcceptancePath, manifest.endpoints.baseUrl).toString();
  const acceptanceState = await egressJsonRequest<z.infer<typeof acceptanceStateSchema>>(
    config,
    manifest,
    context.correlationId,
    "external_api.probe.acceptance",
    acceptanceStateUrl,
    "GET",
    { maxBytes: 256_000 }
  ).then((response) => ({
    response,
    parsed: acceptanceStateSchema.parse(response.json ?? {})
  })).catch((error: unknown) => ({ error }));
  const scopeCatalog = externalApiScopeCatalog(manifest);
  const lowerRedactedHeaders = manifest.loggingContract.redactHeaders.map((header) => header.toLowerCase());
  const pathPrefixValid = manifest.operations.every((operation) => operation.path.startsWith(manifest.serviceIdentity.basePath));
  const acceptanceOperationsMatch = "parsed" in acceptanceState
    ? digestCanonicalJson(acceptanceState.parsed.operations.map((operation) => ({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      requiredScopes: [...operation.requiredScopes].sort()
    }))) === digestCanonicalJson(manifest.operations.map((operation) => ({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      requiredScopes: [...operation.requiredScopes].sort()
    })))
    : false;
  return {
    G01_SCHEMA: passGate(gateEvidence({
      gate: "G01_SCHEMA",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_SCHEMA_VALID",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs,
      detail: { schemaVersion: manifest.schemaVersion, operationCount: manifest.operations.length }
    })),
    G02_INTENT_BINDING: context.serviceKind === "EXTERNAL_API" && context.allowedPipeline === "EXTERNAL_API_REGISTRATION"
      ? passGate(gateEvidence({
        gate: "G02_INTENT_BINDING",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_INTENT_BOUND",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { serviceKind: context.serviceKind, allowedPipeline: context.allowedPipeline }
      }))
      : failGate(gateEvidence({
        gate: "G02_INTENT_BINDING",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_INTENT_MISMATCH",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Issue a new integration intent for EXTERNAL_API registration and retry with that token.",
        evidenceRefs,
        detail: { serviceKind: context.serviceKind, allowedPipeline: context.allowedPipeline }
      })),
    G03_OWNERSHIP: (() => {
      const ownership = evaluateOwnershipGate(manifest, context.descriptor);
      return ownership.status === "PASS"
        ? passGate(gateEvidence({
          gate: "G03_OWNERSHIP",
          correlationId: context.correlationId,
          code: "EXTERNAL_API_OWNERSHIP_BOUND",
          classification: "OK",
          retryable: false,
          remediation: "No action required.",
          evidenceRefs,
          detail: ownership.evidence
        }))
        : failGate(gateEvidence({
          gate: "G03_OWNERSHIP",
          correlationId: context.correlationId,
          code: "EXTERNAL_API_OWNERSHIP_MISMATCH",
          classification: "SECURITY_BLOCKER",
          retryable: false,
          remediation: "Align the integration intent ownership descriptor with the manifest owners before retrying registration.",
          evidenceRefs,
          detail: ownership.evidence
        }));
    })(),
    G04_ARTIFACT_INTEGRITY: passGate(gateEvidence({
      gate: "G04_ARTIFACT_INTEGRITY",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_EVIDENCE_BOUND",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs,
      detail: {
        manifestDigest: context.manifestDigest,
        evidenceRefCount: evidenceRefs.length
      }
    })),
    G05_ENDPOINT_SAFETY: tlsProbe,
    G06_AUTH_ACCEPTANCE: manifest.auth.mode === "NONE"
      && manifest.auth.gatewayEnforced
      && manifest.auth.tokenEndpointUrl === null
      && manifest.auth.jwksUrl === null
      && manifest.auth.authMetadataUrl === null
      && "parsed" in acceptanceState
      && acceptanceState.parsed.gatewayEnforced
      && acceptanceState.parsed.directBypassBlocked
      ? passGate(gateEvidence({
        gate: "G06_AUTH_ACCEPTANCE",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_GATEWAY_AUTH_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { mode: manifest.auth.mode, gatewayEnforced: true, directBypassBlocked: true }
      }))
      : failGate(gateEvidence({
        gate: "G06_AUTH_ACCEPTANCE",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_GATEWAY_AUTH_INVALID",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Ensure the backend accepts only KCML gateway-mediated traffic and exposes the acceptance contract accordingly.",
        evidenceRefs,
        detail: {
        mode: manifest.auth.mode,
        gatewayEnforced: manifest.auth.gatewayEnforced,
        tokenEndpointUrl: manifest.auth.tokenEndpointUrl,
        jwksUrl: manifest.auth.jwksUrl,
        authMetadataUrl: manifest.auth.authMetadataUrl,
        acceptanceProbe: "parsed" in acceptanceState ? acceptanceState.parsed : null
      }
      })),
    G07_SCOPE_ENFORCEMENT: scopeCatalog.length > 0 && pathPrefixValid && acceptanceOperationsMatch
      ? passGate(gateEvidence({
        gate: "G07_SCOPE_ENFORCEMENT",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_SCOPE_POLICY_MATCH",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { scopeCount: scopeCatalog.length, basePath: manifest.serviceIdentity.basePath }
      }))
      : failGate(gateEvidence({
        gate: "G07_SCOPE_ENFORCEMENT",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_SCOPE_POLICY_MISMATCH",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Align the backend acceptance catalog with the manifest operations and scopes before registration.",
        evidenceRefs,
        detail: { scopeCount: scopeCatalog.length, basePath: manifest.serviceIdentity.basePath, pathPrefixValid, acceptanceOperationsMatch }
      })),
    G08_STATE_CONTRACTS: healthProbe.status === "PASS" && readinessProbe.status === "PASS" && "parsed" in operationalState
      && operationalState.parsed.healthy && operationalState.parsed.ready
      ? passGate(gateEvidence({
        gate: "G08_STATE_CONTRACTS",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_STATE_CONTRACTS_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: {
          health: healthProbe.evidence,
          readiness: readinessProbe.evidence,
          operationalState: operationalState.parsed
        }
      }))
      : failGate(gateEvidence({
        gate: "G08_STATE_CONTRACTS",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_STATE_CONTRACTS_FAILED",
        classification: "TRANSIENT",
        retryable: true,
        remediation: "Restore the state endpoints so health, readiness and operational state all report success.",
        evidenceRefs,
        detail: {
          health: healthProbe.evidence,
          readiness: readinessProbe.evidence,
          operationalState: "parsed" in operationalState ? operationalState.parsed : { error: operationalState.error instanceof Error ? operationalState.error.message : "operational_state_failed" }
        }
      })),
    G09_LOGGING: ["authorization", "cookie", "set-cookie"].every((header) => lowerRedactedHeaders.includes(header))
      && "parsed" in acceptanceState
      && acceptanceState.parsed.logging.correlationHeader === manifest.loggingContract.correlationHeader
      ? passGate(gateEvidence({
        gate: "G09_LOGGING",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_LOGGING_CONTRACT_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { correlationHeader: manifest.loggingContract.correlationHeader, redactHeaders: lowerRedactedHeaders }
      }))
      : failGate(gateEvidence({
        gate: "G09_LOGGING",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_LOGGING_CONTRACT_MISMATCH",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Ensure the backend acceptance contract matches the published correlation header and redact list.",
        evidenceRefs,
        detail: { correlationHeader: manifest.loggingContract.correlationHeader, redactHeaders: lowerRedactedHeaders }
      })),
    G10_MONITORING: manifest.monitoringProfile.alertRules.length > 0
      && "parsed" in acceptanceState
      && acceptanceState.parsed.monitoring.staleAfterSeconds === manifest.monitoringProfile.staleAfterSeconds
      ? passGate(gateEvidence({
        gate: "G10_MONITORING",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_MONITORING_CONTRACT_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: {
          staleAfterSeconds: manifest.monitoringProfile.staleAfterSeconds,
          alertRuleCount: manifest.monitoringProfile.alertRules.length
        }
      }))
      : failGate(gateEvidence({
        gate: "G10_MONITORING",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_MONITORING_CONTRACT_MISMATCH",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Align the acceptance monitoring contract with the manifest stale window and probe schedule.",
        evidenceRefs,
        detail: { staleAfterSeconds: manifest.monitoringProfile.staleAfterSeconds, alertRuleCount: manifest.monitoringProfile.alertRules.length }
      })),
    G11_DISABLE_ENFORCEMENT: manifest.auth.gatewayEnforced && manifest.egressPolicy.redirectsAllowed === false
      && "parsed" in acceptanceState && acceptanceState.parsed.disableMode === "CENTRAL_GATEWAY"
      ? passGate(gateEvidence({
        gate: "G11_DISABLE_ENFORCEMENT",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_DISABLE_CONTRACT_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { gatewayEnforced: manifest.auth.gatewayEnforced, redirectsAllowed: manifest.egressPolicy.redirectsAllowed }
      }))
      : failGate(gateEvidence({
        gate: "G11_DISABLE_ENFORCEMENT",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_DISABLE_CONTRACT_MISMATCH",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Publish a backend acceptance contract that confirms central gateway disable enforcement.",
        evidenceRefs,
        detail: { gatewayEnforced: manifest.auth.gatewayEnforced, redirectsAllowed: manifest.egressPolicy.redirectsAllowed }
      })),
    G12_PERMISSION_MUTATION: "parsed" in acceptanceState && acceptanceState.parsed.permissionMutationMode === "KCML_PERMISSION_EPOCH"
      ? passGate(gateEvidence({
        gate: "G12_PERMISSION_MUTATION",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_PERMISSION_EPOCH_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: { scopeCount: scopeCatalog.length, operationIds: manifest.operations.map((operation) => operation.operationId) }
      }))
      : failGate(gateEvidence({
        gate: "G12_PERMISSION_MUTATION",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_PERMISSION_EPOCH_MISSING",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "The backend acceptance contract must explicitly support KCML permission-epoch enforcement.",
        evidenceRefs,
        detail: { scopeCount: scopeCatalog.length, operationIds: manifest.operations.map((operation) => operation.operationId) }
      })),
    G13_RESILIENCE: (!("parsed" in acceptanceState) || acceptanceState.parsed.redirectsAllowed === false)
      && (!("parsed" in acceptanceState) || !acceptanceState.parsed.maxSupportedTimeoutMs || manifest.timeoutMs <= acceptanceState.parsed.maxSupportedTimeoutMs)
      ? passGate(gateEvidence({
        gate: "G13_RESILIENCE",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_RESILIENCE_OK",
        classification: "OK",
        retryable: false,
        remediation: "No action required.",
        evidenceRefs,
        detail: {
          redirectsAllowed: manifest.egressPolicy.redirectsAllowed,
          timeoutMs: manifest.timeoutMs,
          rateLimit: manifest.rateLimit
        }
      }))
      : failGate(gateEvidence({
        gate: "G13_RESILIENCE",
        correlationId: context.correlationId,
        code: "EXTERNAL_API_RESILIENCE_MISMATCH",
        classification: "SECURITY_BLOCKER",
        retryable: false,
        remediation: "Match the acceptance contract to the manifest resilience constraints before registration.",
        evidenceRefs,
        detail: {
          redirectsAllowed: manifest.egressPolicy.redirectsAllowed,
          timeoutMs: manifest.timeoutMs,
          rateLimit: manifest.rateLimit
        }
      })),
    G14_REGISTRATION_FINALIZATION: passGate(gateEvidence({
      gate: "G14_REGISTRATION_FINALIZATION",
      correlationId: context.correlationId,
      code: "EXTERNAL_API_FINAL_STATE_REGISTERED_DISABLED",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs,
      detail: { finalState: "REGISTERED_DISABLED", apiState: "DISABLED" }
    }))
  };
}


export type ExternalApiGatewayService = {
  managedServiceId: string;
  code: string;
  hostname: string;
  resourceUri: string;
  manifest: ExternalApiRegistrationManifest;
  upstreamBaseUrl: string;
  loggingContract: ExternalApiRegistrationManifest["loggingContract"];
  timeoutMs: number;
};

export type ExternalApiMonitoringTarget = {
  managedServiceId: string;
  code: string;
  lifecycleState: string;
  apiState: string;
  manifest: ExternalApiRegistrationManifest;
};

async function latestManagedServiceProbes(db: Db, managedServiceId: string, probeTypes: string[]): Promise<Map<string, { status: string; checkedAt: number }>> {
  const probes = await db.query(
    `select distinct on (probe_type) probe_type, status, checked_at
       from managed_service_probe_result
      where managed_service_id = $1
        and probe_type = any($2::text[])
      order by probe_type, checked_at desc, id desc`,
    [managedServiceId, probeTypes]
  );
  const latest = new Map<string, { status: string; checkedAt: number }>();
  for (const row of probes.rows as Array<Record<string, unknown>>) {
    latest.set(String(row.probe_type), {
      status: String(row.status),
      checkedAt: new Date(row.checked_at as string | number | Date).getTime()
    });
  }
  return latest;
}

export async function listExternalApiMonitoringTargets(db: Db): Promise<ExternalApiMonitoringTarget[]> {
  const result = await db.query(
    `select ms.id, ms.code, ms.lifecycle_state, ms.api_state, revision.manifest
       from managed_service ms
       join managed_service_revision revision on revision.id = ms.active_revision_id
      where ms.service_kind = 'EXTERNAL_API'
        and ms.monitoring_enabled = true
        and ms.active_revision_id is not null
        and ms.lifecycle_state in ('REGISTERED_DISABLED','TRIAL','ACTIVE')`
  );
  return result.rows.map((row) => ({
    managedServiceId: String(row.id),
    code: String(row.code),
    lifecycleState: String(row.lifecycle_state),
    apiState: String(row.api_state),
    manifest: validateExternalApiManifest(row.manifest).manifest
  }));
}

async function evaluateManagedServiceProbeAlert(
  client: pg.PoolClient,
  managedServiceId: string,
  code: string,
  probeType: string,
  status: "PASS" | "FAIL" | "STALE",
  evidence: Record<string, unknown>,
  rules: ExternalApiRegistrationManifest["monitoringProfile"]["alertRules"],
  correlationId: string
): Promise<void> {
  const alertType = `managed_service.monitoring.${probeType}`;
  if (status === "PASS") {
    await closeAlert(client, { managedServiceId, alertType, reason: "probe_recovered", correlationId });
    return;
  }
  const rule = rules.find((candidate) => candidate.probeType === probeType);
  if (!rule) return;
  const recent = await client.query(
    `select status
       from managed_service_probe_result
      where managed_service_id = $1
        and probe_type = $2
      order by checked_at desc, id desc
      limit $3`,
    [managedServiceId, probeType, rule.consecutiveFailures]
  );
  if (recent.rows.length < rule.consecutiveFailures || recent.rows.some((row) => String(row.status) === "PASS")) return;
  await raiseAlert(client, {
    managedServiceId,
    severity: rule.severity,
    alertType,
    title: `${code}: managed-service probe ${probeType} failed`,
    detail: { probeType, status, evidence, consecutiveFailures: rule.consecutiveFailures },
    correlationId
  });
}

export async function runExternalApiMonitoringTarget(db: Db, config: EgressClientConfig, target: ExternalApiMonitoringTarget): Promise<void> {
  const correlationId = randomUUID();
  const latest = await latestManagedServiceProbes(db, target.managedServiceId, ["health", "readiness", "tls", "acceptance"]);
  const intervals = target.manifest.monitoringProfile.probeIntervals;
  const staleAfterMs = target.manifest.monitoringProfile.staleAfterSeconds * 1000;
  const due = (probeType: "health" | "readiness" | "tls" | "acceptance"): boolean => {
    const last = latest.get(probeType);
    const intervalSeconds = probeType === "health"
      ? intervals.healthSeconds
      : probeType === "readiness"
        ? intervals.readinessSeconds
        : probeType === "tls"
          ? intervals.tlsSeconds
          : intervals.acceptanceSeconds;
    return !last || Date.now() - last.checkedAt >= intervalSeconds * 1000;
  };
  const results: Array<{ probeType: "health" | "readiness" | "tls" | "acceptance"; status: "PASS" | "FAIL" | "STALE"; evidence: Record<string, unknown> }> = [];
  const runProbe = async (
    probeType: "health" | "readiness" | "tls" | "acceptance",
    fn: () => Promise<Record<string, unknown>>
  ): Promise<void> => {
    const last = latest.get(probeType);
    if (!due(probeType)) {
      if (last && Date.now() - last.checkedAt > staleAfterMs) {
        results.push({
          probeType,
          status: "STALE",
          evidence: gateEvidence({
            gate: "G10_MONITORING",
            correlationId,
            code: "EXTERNAL_API_MONITORING_STALE",
            classification: "TRANSIENT",
            retryable: true,
            remediation: "Allow the monitor to refresh this probe before enabling or continuing runtime traffic.",
            evidenceRefs: externalApiEvidenceReferences(target.manifest),
            detail: { probeType, lastCheckedAt: new Date(last.checkedAt).toISOString() }
          })
        });
      }
      return;
    }
    try {
      results.push({ probeType, status: "PASS", evidence: await fn() });
    } catch (error) {
      results.push({
        probeType,
        status: "FAIL",
        evidence: gateEvidence({
          gate: "G10_MONITORING",
          correlationId,
          code: `EXTERNAL_API_${probeType.toUpperCase()}_FAIL`,
          classification: probeType === "tls" || probeType === "acceptance" ? "SECURITY_BLOCKER" : "TRANSIENT",
          retryable: probeType !== "tls",
          remediation: probeType === "tls"
            ? "Repair TLS or egress policy before runtime traffic resumes."
            : "Restore the backend endpoint and let the monitor retry.",
          evidenceRefs: externalApiEvidenceReferences(target.manifest),
          detail: { probeType, error: error instanceof Error ? error.message : "probe_failed" }
        })
      });
    }
  };

  await runProbe("health", async () => {
    const url = target.manifest.endpoints.healthcheckUrl ?? `${target.manifest.endpoints.baseUrl.replace(/\/$/, "")}/health`;
    const response = await egressJsonRequest<Record<string, unknown>>(config, target.manifest, correlationId, "external_api.monitor.health", url, "GET", {
      managedServiceId: target.managedServiceId,
      maxBytes: 256_000
    });
    if (response.status !== 200) throw new Error(`health_status_${response.status}`);
    return gateEvidence({
      gate: "G10_MONITORING",
      correlationId,
      code: "EXTERNAL_API_HEALTH_OK",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs: externalApiEvidenceReferences(target.manifest),
      detail: { status: response.status, url }
    });
  });
  await runProbe("readiness", async () => {
    const url = target.manifest.endpoints.readinessUrl ?? `${target.manifest.endpoints.baseUrl.replace(/\/$/, "")}/ready`;
    const response = await egressJsonRequest<Record<string, unknown>>(config, target.manifest, correlationId, "external_api.monitor.readiness", url, "GET", {
      managedServiceId: target.managedServiceId,
      maxBytes: 256_000
    });
    if (response.status !== 200) throw new Error(`readiness_status_${response.status}`);
    return gateEvidence({
      gate: "G10_MONITORING",
      correlationId,
      code: "EXTERNAL_API_READINESS_OK",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs: externalApiEvidenceReferences(target.manifest),
      detail: { status: response.status, url }
    });
  });
  await runProbe("tls", async () => {
    const response = await egressJsonRequest<Record<string, unknown>>(config, target.manifest, correlationId, "external_api.monitor.tls", target.manifest.endpoints.baseUrl, "HEAD", {
      managedServiceId: target.managedServiceId,
      maxBytes: 16_384
    });
    if (response.status >= 400) throw new Error(`tls_status_${response.status}`);
    return gateEvidence({
      gate: "G10_MONITORING",
      correlationId,
      code: "EXTERNAL_API_TLS_OK",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs: externalApiEvidenceReferences(target.manifest),
      detail: { status: response.status, url: target.manifest.endpoints.baseUrl }
    });
  });
  await runProbe("acceptance", async () => {
    const url = new URL(target.manifest.stateContract.apiAcceptancePath, target.manifest.endpoints.baseUrl).toString();
    const response = await egressJsonRequest<z.infer<typeof acceptanceStateSchema>>(config, target.manifest, correlationId, "external_api.monitor.acceptance", url, "GET", {
      managedServiceId: target.managedServiceId,
      maxBytes: 256_000
    });
    if (response.status !== 200) throw new Error(`acceptance_status_${response.status}`);
    const acceptance = acceptanceStateSchema.parse(response.json ?? {});
    if (!acceptance.gatewayEnforced || !acceptance.directBypassBlocked) throw new Error("acceptance_contract_invalid");
    return gateEvidence({
      gate: "G10_MONITORING",
      correlationId,
      code: "EXTERNAL_API_ACCEPTANCE_OK",
      classification: "OK",
      retryable: false,
      remediation: "No action required.",
      evidenceRefs: externalApiEvidenceReferences(target.manifest),
      detail: { url, gatewayEnforced: acceptance.gatewayEnforced, directBypassBlocked: acceptance.directBypassBlocked }
    });
  });

  await tx(db, async (client) => {
    for (const result of results) {
      await client.query(
        `insert into managed_service_probe_result(managed_service_id, probe_type, status, latency_ms, evidence, correlation_id)
         values ($1,$2,$3,0,$4,$5)`,
        [target.managedServiceId, result.probeType, result.status, JSON.stringify(result.evidence), correlationId]
      );
      await evaluateManagedServiceProbeAlert(client, target.managedServiceId, target.code, result.probeType, result.status, result.evidence, target.manifest.monitoringProfile.alertRules, correlationId);
    }
    const failures = results.filter((result) => result.status !== "PASS");
    await client.query(
      `update managed_service
          set operational_state = $2::operational_state,
              updated_at = now()
        where id = $1`,
      [
        target.managedServiceId,
        failures.length === 0 ? "HEALTHY" : failures.some((result) => ["health", "readiness", "tls", "acceptance"].includes(result.probeType)) ? "UNHEALTHY" : "DEGRADED"
      ]
    );
    await closeAlert(client, { managedServiceId: target.managedServiceId, alertType: "managed_service.monitoring.internal_error", reason: "monitor_cycle_recovered", correlationId });
  });
}

export async function recordExternalApiMonitoringInternalError(db: Db, target: ExternalApiMonitoringTarget, error: unknown): Promise<void> {
  const correlationId = randomUUID();
  const message = error instanceof Error ? error.message.slice(0, 500) : "monitoring_internal_error";
  await tx(db, async (client) => {
    await client.query(
      `insert into managed_service_probe_result(managed_service_id, probe_type, status, evidence, correlation_id)
       values ($1,'internal_error','FAIL',$2,$3)`,
      [
        target.managedServiceId,
        JSON.stringify(gateEvidence({
          gate: "G10_MONITORING",
          correlationId,
          code: "EXTERNAL_API_MONITOR_INTERNAL_ERROR",
          classification: "INTERNAL",
          retryable: true,
          remediation: "Inspect the monitor worker and rerun the probe cycle.",
          evidenceRefs: externalApiEvidenceReferences(target.manifest),
          detail: { error: message }
        })),
        correlationId
      ]
    );
    await raiseAlert(client, {
      managedServiceId: target.managedServiceId,
      severity: "CRITICAL",
      alertType: "managed_service.monitoring.internal_error",
      title: `${target.code}: managed-service monitor internal error`,
      detail: { error: message },
      correlationId
    });
  });
}

export async function loadExternalApiGatewayService(db: Db, hostname: string): Promise<ExternalApiGatewayService | null> {
  const result = await db.query(
    `select
        ms.id,
        ms.code,
        ms.public_hostname,
        ms.resource_uri,
        revision.manifest,
        profile.base_url,
        profile.timeout_ms
      from managed_service ms
      join managed_service_revision revision on revision.id = ms.active_revision_id
      join external_api_service_profile profile on profile.managed_service_id = ms.id
     where lower(ms.public_hostname) = lower($1)
       and ms.service_kind = 'EXTERNAL_API'`,
    [hostname]
  );
  if (!result.rowCount) return null;
  const manifest = validateExternalApiManifest(result.rows[0].manifest).manifest;
  return {
    managedServiceId: String(result.rows[0].id),
    code: String(result.rows[0].code),
    hostname: String(result.rows[0].public_hostname),
    resourceUri: String(result.rows[0].resource_uri),
    manifest,
    upstreamBaseUrl: String(result.rows[0].base_url),
    loggingContract: manifest.loggingContract,
    timeoutMs: Number(result.rows[0].timeout_ms ?? manifest.timeoutMs)
  };
}

function responseJson(response: Buffer): unknown {
  if (!response.length) return {};
  return JSON.parse(response.toString("utf8"));
}

export async function proxyExternalApiOperation(db: Db, params: {
  config: ExternalApiGatewayConfig;
  service: ExternalApiGatewayService;
  operation: ExternalOperation;
  requestPath: string;
  queryString: string;
  body: Buffer;
  principalId: string;
  correlationId: string;
}): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[]> }> {
  const upstream = new URL(`${params.service.upstreamBaseUrl.replace(/\/$/, "")}${params.requestPath}${params.queryString}`);
  const parsedRequestBody = params.body.length ? JSON.parse(params.body.toString("utf8")) : {};
  validateExternalApiRequest(params.operation, parsedRequestBody);
  const started = Date.now();
  const response = await fetchThroughEgress(params.config, {
    url: upstream.toString(),
    method: params.operation.method,
    headers: {
      "content-type": "application/json",
      "x-kcml-gateway-mode": "managed-service",
      "x-kcml-managed-service": params.service.code,
      "x-kcml-principal-id": params.principalId,
      "x-kcml-operation-id": params.operation.operationId,
      "x-correlation-id": params.correlationId
    },
    body: params.body,
    allowlist: params.service.manifest.egressPolicy.allowlist,
    purpose: `external_api.runtime.${params.operation.operationId}`,
    correlationId: params.correlationId,
    managedServiceId: params.service.managedServiceId,
    ttlSeconds: Math.ceil(Math.min(params.operation.timeoutMs, params.service.timeoutMs) / 1000) + 30
  });
  if (response.body.length > params.operation.maxPayloadBytes) throw Object.assign(new Error("response_too_large"), { statusCode: 502 });
  const parsedResponse = responseJson(response.body);
  validateExternalApiResponse(params.operation, parsedResponse);
  await db.query(
    `insert into managed_service_usage_event(
        managed_service_id, credential_id, scope_name, request_digest, response_digest, outcome, latency_ms, classification, correlation_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      params.service.managedServiceId,
      params.principalId,
      params.operation.requiredScopes.join(" "),
      `sha256:${createHash("sha256").update(params.body).digest("hex")}`,
      `sha256:${createHash("sha256").update(response.body).digest("hex")}`,
      response.status >= 200 && response.status < 400 ? "SUCCEEDED" : "FAILED",
      Date.now() - started,
      response.status >= 500 ? "upstream_5xx" : response.status >= 400 ? "upstream_4xx" : null,
      params.correlationId
    ]
  );
  await db.query(
    `insert into managed_service_runtime_log_event(managed_service_id, level, event_name, fields, correlation_id)
     values ($1,'info','external_api.gateway.request',$2,$3)`,
    [
      params.service.managedServiceId,
      JSON.stringify({
        operationId: params.operation.operationId,
        path: params.requestPath,
        status: response.status,
        principalId: params.principalId
      }),
      params.correlationId
    ]
  );
  return {
    status: response.status,
    body: response.body,
    headers: { "content-type": "application/json" }
  };
}
