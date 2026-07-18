import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = "2026.07.20";
const protocol = "2025-11-25";
const outputPath = path.join(root, `docs/onboarding-catalogs/component-${release}.json`);
const schemaPath = path.join(root, `apps/server/src/contracts/component-manifest-${release}.schema.json`);
const examplePath = path.join(root, `docs/onboarding-manifest-${release}.example.json`);

const aiComponents = [
  ["AI-CLS-001", "AGENT_ROUTER"],
  ["AI-QRP-002", "AGENT_WORKER"],
  ["AI-LYL-003", "AGENT_WORKER"],
  ["AI-GRP-004", "AGENT_WORKER"],
  ["AI-BIZ-005", "AGENT_WORKER"],
  ["AI-IND-006", "AGENT_WORKER"],
  ["AI-HIS-007", "AGENT_CONTEXT"],
  ["AI-BRD-008", "AGENT_REVIEW"],
  ["AI-QA-009", "AGENT_QA"]
];
const mcpComponents = [
  ["MCP-RX-WA-001", "EVENT_INGRESS"],
  ["MCP-RX-MS-002", "EVENT_INGRESS"],
  ["MCP-RX-EM-003", "EVENT_INGRESS"],
  ["MCP-RX-BC-004", "EVENT_INGRESS"],
  ["MCP-PMS-RO-005", "ISOLATED_HANDLER"],
  ["MCP-PMS-RW-006", "STATEFUL_HANDLER"],
  ["MCP-TX-WA-007", "ASYNC_EGRESS"],
  ["MCP-TX-MS-008", "ASYNC_EGRESS"],
  ["MCP-TX-EM-009", "ASYNC_EGRESS"],
  ["MCP-TX-BC-010", "ASYNC_EGRESS"],
  ["MCP-WFC-011", "STATEFUL_SERVICE"]
];
const managedServices = ["KCML-AUTH-001", "KCML-CTL-002", "KCML-MON-003", "KCML-AUD-004", "KCML-SEC-005"];
const blueprintIds = [...aiComponents, ...mcpComponents].map(([componentId]) => componentId);

const gatesByStage = {
  intake: ["archive_policy", "manifest_schema", "token_scope", "authorization_snapshot", "secret_scan", "dependency_policy"],
  ci: ["path_policy", "lint", "typecheck", "unit_tests", "contract_tests", "sast", "sca", "license", "sbom", "reproducible_build"],
  supply_chain: ["source_commit", "artifact_digest", "artifact_signature", "provenance"],
  deploy: ["runtime_isolation", "worker_readiness", "agent_runtime_profile", "mcp_runtime_profile"],
  preflight: ["dns", "tls_san", "host_path_method_endpoint", "route_acl"],
  trial: ["negative_auth", "mcp_initialize", "pulse_acl", "ack_then_event", "schema_contract", "correlation_chain", "logging_redaction", "technical_audit", "business_audit", "monitoring_probes", "recertification"]
};

const requiredChecks = [
  "path-policy", "manifest-schema", "lint", "typecheck", "unit-tests", "contract-tests",
  "secret-scan", "sast", "sca-license", "sbom", "reproducible-build", "artifact-signature"
];

const errorCodes = [
  "invalid_integration_token", "integration_token_kind_mismatch", "implementation_token_scope_mismatch",
  "blueprint_component_not_allowed", "duplicate_blueprint_component", "max_child_jobs_exceeded",
  "invalid_idempotency_key", "idempotency_key_reused", "multipart_required", "invalid_manifest_json",
  "manifest_and_source_required", "invalid_source_part", "source_must_be_zip", "invalid_manifest",
  "manifest_evidence_missing", "old_manifest_schema_not_accepted", "component_identity_forbidden",
  "handler_retry_must_be_false", "audit_policy_mismatch", "public_endpoint_forbidden_for_ai",
  "public_endpoint_required_for_mcp", "facade_tool_count_mismatch", "mcp_protocol_mismatch",
  "ack_then_event_contract_invalid", "route_acl_invalid", "archive_too_large", "expanded_archive_too_large",
  "too_many_files", "unsafe_archive_path", "secret_detected", "dependency_version_must_be_exact",
  "source_revision_not_allowed", "idempotency_key_and_if_match_required", "lock_version_conflict",
  "job_terminal", "not_found", "gone"
];

const ref = (name) => ({ $ref: `#/$defs/${name}` });
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `urn:kcml:schema:component-manifest:${release}`,
  title: `KajovoCML component manifest ${release}`,
  oneOf: [{ $ref: "#/$defs/aiAgentManifest" }, { $ref: "#/$defs/mcpServerManifest" }, { $ref: "#/$defs/managedServiceManifest" }],
  discriminator: { propertyName: "componentType" },
  $defs: {
    sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    timestamp: { type: "string", format: "date-time" },
    email: { type: "string", format: "email", maxLength: 254 },
    blueprintId: { enum: [...blueprintIds, ...managedServices] },
    contact: {
      type: "object", additionalProperties: false, required: ["name", "email"],
      properties: { name: { type: "string", minLength: 2, maxLength: 160 }, email: ref("email") }
    },
    endpoint: {
      type: "object", additionalProperties: false,
      required: ["endpointId", "path", "methods", "authMode", "requestSchema", "responseSchema", "limits", "timeoutMs", "rateLimit", "idempotency", "signatureProfile", "eventMapping"],
      properties: {
        endpointId: { type: "string", pattern: "^[A-Z0-9][A-Z0-9_-]{2,63}$" },
        path: { type: "string", pattern: "^/" },
        methods: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] } },
        authMode: { enum: ["KCML_BEARER", "SIGNED_WEBHOOK", "MUTUAL_TLS"] },
        requestSchema: { type: "object" },
        responseSchema: { type: "object" },
        limits: { type: "object", additionalProperties: false, required: ["requestBytes", "responseBytes"], properties: { requestBytes: { type: "integer", minimum: 1, maximum: 1048576 }, responseBytes: { type: "integer", minimum: 1, maximum: 5242880 } } },
        timeoutMs: { type: "integer", minimum: 100, maximum: 60000 },
        rateLimit: { type: "object", additionalProperties: false, required: ["windowSeconds", "maxRequests"], properties: { windowSeconds: { type: "integer", minimum: 1, maximum: 86400 }, maxRequests: { type: "integer", minimum: 1, maximum: 100000 } } },
        idempotency: { enum: ["REQUIRED", "OPTIONAL", "FORBIDDEN"] },
        signatureProfile: { type: "string", minLength: 3, maxLength: 120 },
        eventMapping: { type: "object", additionalProperties: false, required: ["pulseType", "correlationIdSource"], properties: { pulseType: { type: "string", minLength: 3, maxLength: 160 }, correlationIdSource: { type: "string", minLength: 3, maxLength: 160 } } }
      }
    },
    pulse: {
      type: "object", additionalProperties: false,
      required: ["pulseType", "direction", "schema", "routeAcl", "scopes", "executionMode", "timeoutMs", "resultPulseTypes", "deadlineMs", "retry", "idempotency"],
      properties: {
        pulseType: { type: "string", minLength: 3, maxLength: 160 },
        direction: { enum: ["INCOMING", "OUTGOING"] },
        schema: { type: "object" },
        routeAcl: { type: "array", minItems: 1, items: { type: "string", minLength: 3, maxLength: 160 } },
        scopes: { type: "array", items: { type: "string", minLength: 3, maxLength: 160 } },
        executionMode: { enum: ["SYNC", "ACK_THEN_EVENT", "ASYNC"] },
        timeoutMs: { type: "integer", minimum: 100, maximum: 60000 },
        resultPulseTypes: { type: "array", items: { type: "string", minLength: 3, maxLength: 160 } },
        deadlineMs: { type: "integer", minimum: 100, maximum: 86400000 },
        retry: { type: "object", additionalProperties: false, required: ["transportRetry", "retryable", "requiresIdempotencyKey"], properties: { transportRetry: { type: "boolean" }, retryable: { type: "boolean" }, requiresIdempotencyKey: { type: "boolean" } } },
        idempotency: { enum: ["REQUIRED", "OPTIONAL", "FORBIDDEN"] }
      }
    },
    common: {
      type: "object",
      required: [
        "schemaVersion", "releaseVersion", "registrationRevision", "environment", "componentType",
        "registrationType", "blueprint", "pulseEnvelopeVersion", "displayName", "businessPurpose",
        "owners", "contacts", "criticality", "review", "source", "runtime", "dependencies",
        "networkPolicy", "dataGovernance", "pulseContract", "retryPolicy", "auditPolicy",
        "monitoringProfile", "maintenance", "autoQuarantine", "evidence", "change", "integrity"
      ],
      properties: {
        schemaVersion: { const: release },
        releaseVersion: { const: release },
        registrationRevision: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$" },
        environment: { enum: ["production", "staging"] },
        componentType: { enum: ["AI_AGENT", "MCP_SERVER", "KCML_MANAGED_SERVICE"] },
        registrationType: { enum: ["KAJA_CLIENT", "MCP_SERVER", "MANAGED_PLATFORM_SERVICE"] },
        blueprint: { type: "object", additionalProperties: false, required: ["componentId", "version"], properties: { componentId: ref("blueprintId"), version: { const: release } } },
        pulseEnvelopeVersion: { const: release },
        displayName: { type: "string", minLength: 3, maxLength: 120 },
        businessPurpose: { type: "string", minLength: 20, maxLength: 2000 },
        owners: { type: "array", minItems: 1, maxItems: 8, items: ref("contact") },
        contacts: { type: "array", minItems: 1, maxItems: 8, items: ref("contact") },
        criticality: { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        review: { type: "object", additionalProperties: false, required: ["intervalDays", "approvedAt", "reviewDueAt", "recertificationEvaluator"], properties: { intervalDays: { type: "integer", minimum: 1, maximum: 365 }, approvedAt: ref("timestamp"), reviewDueAt: ref("timestamp"), recertificationEvaluator: { const: "KCML-SEC-005" } } },
        source: { type: "object", additionalProperties: false, required: ["runtime", "entrypoint", "testCommand"], properties: { runtime: { const: "nodejs24-typescript" }, entrypoint: { const: "src/index.ts" }, testCommand: { const: "pnpm test" } } },
        runtime: { type: "object", additionalProperties: true, required: ["memoryMb", "cpuCores", "pidsLimit"], properties: { memoryMb: { type: "integer", minimum: 64, maximum: 1024 }, cpuCores: { type: "number", minimum: 0.1, maximum: 4 }, pidsLimit: { type: "integer", minimum: 16, maximum: 512 } } },
        dependencies: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "version", "checksum"], properties: { name: { type: "string" }, version: { type: "string", pattern: "^[0-9][0-9A-Za-z.+-]*$" }, checksum: ref("sha256") } } },
        networkPolicy: { type: "object", additionalProperties: false, required: ["outboundAllowlist", "dnsPolicy", "filesystemPolicy"], properties: { outboundAllowlist: { type: "array", items: { type: "string" } }, dnsPolicy: { const: "strict" }, filesystemPolicy: { enum: ["read-only", "isolated-runtime-only"] } } },
        dataGovernance: { type: "object", additionalProperties: false, required: ["classification", "containsPersonalData", "retentionDays"], properties: { classification: { enum: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] }, containsPersonalData: { type: "boolean" }, retentionDays: { type: "integer", minimum: 1, maximum: 3650 } } },
        pulseContract: { type: "object", additionalProperties: false, required: ["incoming", "outgoing"], properties: { incoming: { type: "array", items: ref("pulse") }, outgoing: { type: "array", items: ref("pulse") } } },
        retryPolicy: { type: "object", additionalProperties: false, required: ["handlerRetry"], properties: { handlerRetry: { const: false } } },
        auditPolicy: { type: "object", additionalProperties: false, required: ["technicalAudit", "businessAudit"], properties: { technicalAudit: { const: "PLATFORM" }, businessAudit: { const: "COMPONENT" } } },
        monitoringProfile: { type: "object", additionalProperties: true, required: ["slo", "probes"], properties: { slo: { type: "object" }, probes: { type: "array", minItems: 1, items: { type: "string" } } } },
        maintenance: { type: "object", additionalProperties: true },
        autoQuarantine: { type: "object", additionalProperties: false, required: ["enabled", "rules"], properties: { enabled: { const: true }, rules: { type: "array", minItems: 1, items: { type: "string" } } } },
        evidence: { type: "object", additionalProperties: true },
        change: { type: "object", additionalProperties: true, required: ["changeClass"], properties: { changeClass: { enum: ["INITIAL", "PATCH", "MINOR", "MAJOR"] } } },
        integrity: { type: "object", additionalProperties: false, required: ["manifestDigest", "sourceDigest"], properties: { manifestDigest: ref("sha256"), sourceDigest: ref("sha256") } }
      }
    },
    aiAgentManifest: {
      allOf: [
        { $ref: "#/$defs/common" },
        {
          type: "object",
          required: ["componentType", "registrationType", "agentKey", "agentVersion", "executionProfile", "modelPolicy", "promptPolicy", "toolScopesAllowlist", "memoryPolicy", "fallbackPolicy", "publicEndpoints"],
          properties: {
            componentType: { const: "AI_AGENT" }, registrationType: { const: "KAJA_CLIENT" },
            agentKey: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{1,62}$" },
            agentVersion: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?$" },
            executionProfile: { type: "object" }, modelPolicy: { type: "object" }, promptPolicy: { type: "object" },
            toolScopesAllowlist: { type: "array", items: { type: "string" } },
            memoryPolicy: { type: "object" }, fallbackPolicy: { type: "object" },
            publicEndpoints: { type: "array", maxItems: 0 }
          }
        }
      ]
    },
    mcpServerManifest: {
      allOf: [
        { $ref: "#/$defs/common" },
        {
          type: "object",
          required: ["componentType", "registrationType", "handlerKey", "handlerVersion", "facadeTools", "protocol", "publicEndpoints", "handlerContract"],
          properties: {
            componentType: { const: "MCP_SERVER" }, registrationType: { const: "MCP_SERVER" },
            handlerKey: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{1,62}$" },
            handlerVersion: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?$" },
            facadeTools: { type: "array", minItems: 1, maxItems: 1, items: { type: "object", additionalProperties: false, required: ["name", "inputSchema", "outputSchema"], properties: { name: { type: "string" }, inputSchema: { type: "object" }, outputSchema: { type: "object" } } } },
            protocol: { type: "object", additionalProperties: false, required: ["protocolVersion", "transport", "capabilities"], properties: { protocolVersion: { const: protocol }, transport: { const: "streamable-http" }, capabilities: { type: "array", prefixItems: [{ const: "tools" }], minItems: 1, maxItems: 1 } } },
            publicEndpoints: { type: "array", minItems: 1, items: ref("endpoint") },
            handlerContract: { type: "object", additionalProperties: true }
          }
        }
      ]
    },
    managedServiceManifest: {
      allOf: [
        { $ref: "#/$defs/common" },
        { type: "object", required: ["componentType", "registrationType", "managedServiceId"], properties: { componentType: { const: "KCML_MANAGED_SERVICE" }, registrationType: { const: "MANAGED_PLATFORM_SERVICE" }, managedServiceId: { enum: managedServices } } }
      ]
    }
  }
};

const example = {
  schemaVersion: release,
  releaseVersion: release,
  registrationRevision: "2026-07-20.1",
  environment: "production",
  componentType: "MCP_SERVER",
  registrationType: "MCP_SERVER",
  blueprint: { componentId: "MCP-RX-WA-001", version: release },
  pulseEnvelopeVersion: release,
  displayName: "WhatsApp event ingress",
  businessPurpose: "Receives approved WhatsApp ingress events and maps them into strict KCML pulses.",
  owners: [{ name: "Example Service Owner", email: "service@example.com" }],
  contacts: [{ name: "Example Operations", email: "ops@example.com" }],
  criticality: "HIGH",
  review: { intervalDays: 180, approvedAt: "2026-07-20T00:00:00.000Z", reviewDueAt: "2027-01-16T00:00:00.000Z", recertificationEvaluator: "KCML-SEC-005" },
  source: { runtime: "nodejs24-typescript", entrypoint: "src/index.ts", testCommand: "pnpm test" },
  runtime: { memoryMb: 256, cpuCores: 0.5, pidsLimit: 64 },
  dependencies: [{ name: "node", version: "24.0.0", checksum: "sha256:61df8c17ef87f64d8bea5e68e6f19ed9bdaf904cbc70c9b2597e9293758d9944" }],
  networkPolicy: { outboundAllowlist: [], dnsPolicy: "strict", filesystemPolicy: "isolated-runtime-only" },
  dataGovernance: { classification: "CONFIDENTIAL", containsPersonalData: true, retentionDays: 365 },
  pulseContract: {
    incoming: [{ pulseType: "wa.message.received", direction: "INCOMING", schema: { type: "object" }, routeAcl: ["AI-CLS-001"], scopes: ["pulse:ingress"], executionMode: "ACK_THEN_EVENT", timeoutMs: 3000, resultPulseTypes: ["wa.message.accepted"], deadlineMs: 60000, retry: { transportRetry: true, retryable: true, requiresIdempotencyKey: true }, idempotency: "REQUIRED" }],
    outgoing: [{ pulseType: "wa.message.accepted", direction: "OUTGOING", schema: { type: "object" }, routeAcl: ["AI-CLS-001"], scopes: ["pulse:publish"], executionMode: "ASYNC", timeoutMs: 3000, resultPulseTypes: [], deadlineMs: 60000, retry: { transportRetry: false, retryable: false, requiresIdempotencyKey: true }, idempotency: "REQUIRED" }]
  },
  retryPolicy: { handlerRetry: false },
  auditPolicy: { technicalAudit: "PLATFORM", businessAudit: "COMPONENT" },
  monitoringProfile: { slo: { availabilityPercent: 99.9 }, probes: ["runtime", "route_acl", "artifact_drift", "recertification"] },
  maintenance: { rollbackRef: "evidence/rollback.md" },
  autoQuarantine: { enabled: true, rules: ["CROSS_HOST", "ARTIFACT_DRIFT", "ROUTE_ACL_DRIFT"] },
  evidence: { architectureRef: "evidence/architecture.md", securityRef: "evidence/security.md" },
  change: { changeClass: "INITIAL" },
  integrity: { manifestDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000", sourceDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
  handlerKey: "whatsapp_ingress",
  handlerVersion: "1.0.0",
  facadeTools: [{ name: "ingress", inputSchema: { type: "object" }, outputSchema: { type: "object" } }],
  protocol: { protocolVersion: protocol, transport: "streamable-http", capabilities: ["tools"] },
  publicEndpoints: [{
    endpointId: "WA_INGRESS", path: "/events/whatsapp", methods: ["POST"], authMode: "SIGNED_WEBHOOK",
    requestSchema: { type: "object" }, responseSchema: { type: "object" },
    limits: { requestBytes: 262144, responseBytes: 65536 }, timeoutMs: 3000,
    rateLimit: { windowSeconds: 60, maxRequests: 600 }, idempotency: "REQUIRED",
    signatureProfile: "whatsapp-hmac-v1", eventMapping: { pulseType: "wa.message.received", correlationIdSource: "header:x-correlation-id" }
  }],
  handlerContract: { export: "handle", listener: "forbidden" }
};

const catalog = {
  version: release,
  serviceKind: "COMPONENT",
  publishedAt: "2026-07-20",
  blueprintVersion: release,
  catalogVersion: release,
  manifestSchemaVersion: release,
  pulseEnvelopeVersion: release,
  policyBaseline: "2026-07-20",
  mcpProtocolVersion: protocol,
  canonicalDigest: "",
  manifestExamplePath: `docs/onboarding-manifest-${release}.example.json`,
  humanCatalogFiles: [
    `docs/releases/${release}/KajovoCML_Onboarding_Catalog_${release}.docx`,
    `docs/releases/${release}/KajovoCML_Onboarding_Catalog_${release}.pdf`,
    `docs/releases/${release}/KajovoCML_Blueprint_AI_Agents_MCP_Servers_${release}.docx`,
    `docs/releases/${release}/KajovoCML_Blueprint_AI_Agents_MCP_Servers_${release}.pdf`
  ],
  compatibility: {
    supersedesCatalogVersions: ["1.7", "1.8"],
    acceptedNewManifestSchemaVersions: [release],
    acceptedStoredManifestSchemaVersions: ["1.4", "1.5", release],
    breakingManifestChange: true,
    legacyOnboardingPath: { path: "/v1/onboardings", status: 410 }
  },
  blueprintComponents: {
    aiAgents: aiComponents.map(([componentId, role]) => ({ componentId, role, registrationType: "KAJA_CLIENT" })),
    mcpServers: mcpComponents.map(([componentId, role]) => ({ componentId, role, registrationType: "MCP_SERVER" })),
    managedServices: managedServices.map((componentId) => ({ componentId, registrationType: "MANAGED_PLATFORM_SERVICE" }))
  },
  implementationTokens: {
    tokenTypes: ["SINGLE_COMPONENT", "BLUEPRINT_RELEASE"],
    blueprintRelease: {
      releaseVersion: release,
      allowedBlueprintComponentIds: blueprintIds,
      allowedRegistrationTypes: ["KAJA_CLIENT", "MCP_SERVER"],
      maxChildJobs: 20,
      autoActivateAfterPass: true,
      manualApprovalRequiredAfterIssuance: false,
      ttlHours: 24,
      maxTtlDays: 30,
      secret: { bytes: 64, prefix: "kci_", storage: "HMAC digest only" }
    }
  },
  submittedArtifacts: [
    { name: "manifest", mediaType: "application/json", required: true },
    { name: "source", mediaType: "application/zip", required: true },
    { name: "evidence", location: "evidence/** inside source ZIP", required: true }
  ],
  generatedArtifacts: ["child onboarding jobs", "authorization snapshot", "GitHub pull request", "required CI check receipts", "immutable artifact", "SBOM", "provenance attestation", "artifact signature"],
  pipelineGates: Object.entries(gatesByStage).flatMap(([stage, names]) => names.map((name) => ({ name, stage }))),
  requiredCiChecks: requiredChecks,
  semanticRules: errorCodes.map((code) => ({ code, description: code.replaceAll("_", " ") })),
  errorCodes,
  jsonSchema: schema,
  programmerApi: {
    openapi: "3.1.0",
    info: { title: "KajovoCML component onboarding programmer API", version: release },
    servers: [{ url: "https://{registerHost}", variables: { registerHost: { default: "register.example.invalid" } } }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/service-onboardings": { post: { operationId: "createServiceOnboarding", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], responses: { "202": { description: "Accepted" } } } },
      "/v1/service-onboardings/{id}": { get: { operationId: "getServiceOnboarding", responses: { "200": { description: "Current job" } } } },
      "/v1/service-onboardings/{id}/revision": { put: { operationId: "putServiceOnboardingRevision", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }, { name: "If-Match", in: "header", required: true, schema: { type: "string" } }], responses: { "202": { description: "Accepted" } } } },
      "/v1/service-onboardings/{id}/cancel": { post: { operationId: "cancelServiceOnboarding", responses: { "200": { description: "Cancelled" } } } },
      "/v1/integration-intent": { get: { operationId: "getIntegrationIntent", responses: { "200": { description: "Token scope and release intent" } } } }
    },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "KCML implementation token" } } }
  }
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "canonicalDigest")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function render(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

catalog.canonicalDigest = `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(catalog))).digest("hex")}`;

const outputs = new Map([
  [outputPath, render(catalog)],
  [schemaPath, render(schema)],
  [examplePath, render(example)]
]);

if (process.argv.includes("--check")) {
  let stale = false;
  for (const [file, rendered] of outputs) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== rendered) {
      console.error(`Generated onboarding artifact is stale: ${path.relative(root, file)}`);
      stale = true;
    }
  }
  if (stale) process.exitCode = 1;
} else {
  for (const [file, rendered] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rendered);
  }
}
