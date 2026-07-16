import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "docs/onboarding-catalogs/mcp-1.7.json");
const schema = JSON.parse(fs.readFileSync(path.join(root, "apps/server/src/contracts/mcp-manifest-1.5.schema.json"), "utf8"));

const gates = {
  intake: ["archive_policy", "manifest_schema", "secret_scan", "dependency_policy"],
  ci: ["path_policy", "lint", "typecheck", "unit_tests", "contract_tests", "sast", "sca", "license", "sbom", "reproducible_build"],
  supply_chain: ["source_commit", "image_signature", "image_digest", "provenance"],
  deploy: ["runtime_isolation", "worker_readiness"],
  preflight: ["dns", "tls_san", "host_routing"],
  trial: ["oauth_metadata", "audience_binding", "negative_auth", "mcp_initialize", "mcp_tools_list", "safe_tools_call", "cross_host", "schema_contract", "correlation_chain", "logging_redaction", "audit_persistence", "monitoring_probes"]
};

const requiredChecks = [
  "path-policy", "manifest-schema", "lint", "typecheck", "unit-tests", "contract-tests",
  "secret-scan", "sast", "sca-license", "sbom", "reproducible-build"
];

const semanticRules = [
  ["effect_class_annotations_mismatch", "Tool annotations must exactly represent the declared effect class."],
  ["input_schema_digest_mismatch", "contractDigests.inputSchema must equal the canonical SHA-256 digest of tool.inputSchema."],
  ["output_schema_digest_mismatch", "contractDigests.outputSchema must equal the canonical SHA-256 digest of tool.outputSchema."],
  ["error_catalog_mismatch", "protocol.errorCatalog and errorCatalog must be canonically identical."],
  ["egress_allowlist_mismatch", "runtime.egressAllowlist and dependencies.networkPolicy.outboundAllowlist must contain the same values."],
  ["data_export_policy_mismatch", "exportDestinations must be empty when exportAllowed is false."],
  ["duplicate_auto_quarantine_rule", "Every auto-quarantine rule must occur exactly once."],
  ["load_profile_exceeds_concurrency", "The expected load concurrency must not exceed behavior.maxConcurrency."],
  ["monitoring_stale_window_too_short", "staleAfterSeconds must be at least the longest configured probe interval."],
  ["review_interval_mismatch", "reviewDueAt must equal approvedAt plus intervalDays, within one second."],
  ["review_interval_exceeds_policy", "Sensitive services require review within 180 days; all others within 365 days."],
  ["compatibility_window_invalid", "The compatibility window must not end before review approval."],
  ["duplicate_secret_reference", "Secret reference URIs must be unique."],
  ["previous_revision_mismatch", "INITIAL changes require a null previous revision; later changes require a previous revision."],
  ["manifest_evidence_missing", "Every evidence reference in the manifest must resolve to an allowed file in the uploaded ZIP."],
  ["json_schema_invalid", "Both tool schemas must compile as strict JSON Schema Draft 2020-12 documents."]
].map(([code, description]) => ({ code, description }));

const errorCodes = [
  "invalid_integration_token", "integration_token_kind_mismatch", "invalid_idempotency_key", "idempotency_key_reused",
  "multipart_required", "invalid_manifest_json", "manifest_and_source_required", "invalid_source_part", "source_must_be_zip",
  "invalid_manifest", "manifest_evidence_missing", "empty_or_invalid_zip", "archive_too_large", "expanded_archive_too_large",
  "too_many_files", "unsafe_archive_path", "duplicate_archive_path", "archive_path_too_deep", "symlink_not_allowed",
  "special_file_not_allowed", "reserved_path_not_allowed", "secret_configuration_not_allowed", "custom_dockerfile_not_allowed",
  "binary_artifact_not_allowed", "source_file_not_allowed", "binary_content_not_allowed", "secret_detected",
  "runtime_dependency_not_allowed", "development_dependency_not_allowed", "dependency_version_must_be_exact",
  "entrypoint_missing", "tsconfig_missing", "lockfile_missing", "automated_tests_missing", "package_json_missing",
  "invalid_package_json", "invalid_package_name", "package_must_use_esm", "node24_engine_required", "test_script_required",
  "package_script_not_allowed", "invalid_package_script", "invalid_tsconfig_json", "tsconfig_inheritance_not_allowed",
  "tsconfig_policy_failed", "tsconfig_extension_not_allowed", "tsconfig_include_policy_failed", "source_revision_not_allowed",
  "idempotency_key_and_if_match_required", "lock_version_conflict", "job_terminal", "not_found"
];

const errorResponse = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message", "correlationId"],
  properties: {
    error: { type: "string", pattern: "^[a-z][a-z0-9_.]{1,95}$" },
    message: { type: "string" },
    correlationId: { type: "string", format: "uuid" }
  }
};

const idParameter = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const idempotencyParameter = { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" } };
const ifMatchParameter = { name: "If-Match", in: "header", required: true, description: "Quoted lockVersion ETag returned by the latest job response.", schema: { type: "string", pattern: "^\\\"[0-9]+\\\"$" } };
const multipartRequest = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["manifest", "source"],
        properties: {
          manifest: { type: "string", contentMediaType: "application/json", description: "UTF-8 JSON conforming to manifest schema 1.5." },
          source: { type: "string", contentEncoding: "binary", contentMediaType: "application/zip", maxLength: 10_485_760 }
        }
      }
    }
  }
};

const standardErrors = {
  "400": { description: "Invalid request, manifest, archive or optimistic-lock headers.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
  "401": { description: "Missing, expired, revoked or incorrectly bound integration token.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
  "409": { description: "State, idempotency or lock-version conflict.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
  "412": { description: "If-Match does not equal the current lockVersion.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
  "413": { description: "HTTP request envelope exceeds the route body limit.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
  "429": { description: "Rate limit exceeded.", headers: { "Retry-After": { schema: { type: "integer", minimum: 1 } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
};

const catalog = {
  version: "1.7",
  serviceKind: "MCP",
  publishedAt: "2026-07-16",
  manifestSchemaVersion: "1.5",
  canonicalDigest: "",
  manifestExamplePath: "docs/onboarding-manifest-v1.5.example.json",
  humanCatalogFile: "Connect_in_Catalog_KajovoMCPCML_v1.7.docx",
  compatibility: {
    supersedesCatalogVersions: ["1.6"],
    acceptedNewManifestSchemaVersions: ["1.5"],
    acceptedStoredManifestSchemaVersions: ["1.4", "1.5"],
    breakingManifestChange: false,
    note: "Catalog 1.7 corrects and completes the published contract. Manifest payload schema remains 1.5; schema 1.4 is read-only for already stored registrations."
  },
  submittedArtifacts: [
    { name: "manifest", mediaType: "application/json", required: true },
    { name: "source", mediaType: "application/zip", required: true },
    { name: "evidence", location: "evidence/** inside source ZIP", required: true, rule: "Every manifest evidence reference must resolve to an uploaded allowed text file." }
  ],
  generatedArtifacts: ["GitHub pull request", "required CI check receipts", "immutable OCI image", "SBOM", "provenance attestation", "image signature"],
  archivePolicy: {
    maxArchiveBytes: 10_485_760,
    maxExpandedBytes: 52_428_800,
    maxFiles: 1000,
    runtime: "Node.js 24, ESM, TypeScript, pnpm lockfile",
    runtimeDependencies: ["@kcml/handler-sdk", "zod"],
    developmentDependencies: ["@types/node", "eslint", "typescript", "vitest"],
    dependencyVersions: "Exact semantic versions only; ranges and tags are rejected.",
    allowedScripts: ["test", "lint", "typecheck", "build"],
    requiredFiles: ["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/index.ts", "at least one src/**/*.test.ts or src/**/*.spec.ts"],
    forbidden: ["symlinks and special files", "binary artifacts", "secrets and local secret configuration", "custom Dockerfiles", "node_modules", ".git", ".github", "tsconfig inheritance/plugins/paths/baseUrl"],
    tsconfig: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, rootDir: "src", outDir: "dist", include: ["src/**/*.ts"] }
  },
  pipelineGates: Object.entries(gates).flatMap(([stage, names]) => names.map((name) => ({ name, stage }))),
  requiredCiChecks: requiredChecks,
  semanticRules,
  errorCodes,
  jsonSchema: schema,
  programmerApi: {
    openapi: "3.1.0",
    info: {
      title: "KCML MCP onboarding programmer API",
      version: "1.7",
      description: "Authenticated, idempotent intake for one MCP onboarding job bound to one integration token. /v1/onboardings aliases remain available, but new clients should use the service-onboardings paths documented here."
    },
    servers: [{ url: "https://{registerHost}", variables: { registerHost: { default: "register.example.invalid", description: "Value returned in the authenticated integration intent." } } }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/service-onboardings": {
        post: {
          operationId: "createMcpOnboarding",
          summary: "Create the onboarding job and upload revision 1",
          parameters: [idempotencyParameter],
          requestBody: multipartRequest,
          responses: {
            "202": { description: "Job accepted.", headers: { ETag: { description: "Quoted lockVersion for optimistic concurrency.", schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/JobResponse" } } } },
            "415": { description: "Multipart or ZIP media type required.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            ...standardErrors
          }
        }
      },
      "/v1/service-onboardings/{id}": {
        get: {
          operationId: "getMcpOnboarding",
          summary: "Read the token-bound job, gates and transition events",
          parameters: [idParameter],
          responses: {
            "200": { description: "Current job state.", headers: { ETag: { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/JobResponse" } } } },
            "404": { description: "Job not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            ...standardErrors
          }
        }
      },
      "/v1/service-onboardings/{id}/revision": {
        put: {
          operationId: "replaceMcpOnboardingRevision",
          summary: "Replace a failed or requested revision with a complete manifest and source ZIP",
          parameters: [idParameter, idempotencyParameter, ifMatchParameter],
          requestBody: multipartRequest,
          responses: {
            "202": { description: "Revision accepted.", headers: { ETag: { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/JobResponse" } } } },
            "415": { description: "Multipart or ZIP media type required.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            ...standardErrors
          }
        }
      },
      "/v1/service-onboardings/{id}/cancel": {
        post: {
          operationId: "cancelMcpOnboarding",
          summary: "Cancel a non-terminal token-bound onboarding job",
          parameters: [idParameter],
          responses: {
            "200": { description: "Job cancelled.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { const: true } } } } } },
            ...standardErrors
          }
        }
      }
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "KCML integration token" } },
      schemas: {
        ErrorResponse: errorResponse,
        JobResponse: { type: "object", additionalProperties: false, required: ["job"], properties: { job: { $ref: "#/components/schemas/OnboardingJob" } } },
        OnboardingJob: {
          type: "object",
          required: ["id", "state", "correlationId", "lockVersion", "sourceRevision", "programmerAction", "createdAt", "updatedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            state: { enum: ["CREATED", "SOURCE_UPLOADED", "PR_CREATED", "CI_RUNNING", "AWAITING_REVISION", "MERGED", "ARTIFACT_BUILDING", "DEPLOYING", "REGISTERED_DISABLED", "TRIAL_TESTING", "ACTIVE", "FAILED", "QUARANTINED", "CANCELLED"] },
            correlationId: { type: "string", format: "uuid" },
            lockVersion: { type: "integer", minimum: 0 },
            sourceRevision: { type: "integer", minimum: 1 },
            code: { type: ["string", "null"] }, hostname: { type: ["string", "null"] }, resource: { type: ["string", "null"], format: "uri" },
            toolName: { type: ["string", "null"] }, serverId: { type: ["string", "null"] }, manifestDigest: { type: ["string", "null"] }, sourceDigest: { type: ["string", "null"] },
            githubBranch: { type: ["string", "null"] }, githubPrNumber: { type: ["integer", "null"] }, githubPrUrl: { type: ["string", "null"] }, sourceCommit: { type: ["string", "null"] },
            buildId: { type: ["string", "null"] }, imageReference: { type: ["string", "null"] }, imageDigest: { type: ["string", "null"] }, sbomDigest: { type: ["string", "null"] }, provenanceDigest: { type: ["string", "null"] },
            blockingErrorCode: { type: ["string", "null"] }, blockingErrorDetail: { type: ["string", "null"] }, programmerAction: { type: "object" },
            gates: { type: "array", items: { type: "object" } }, events: { type: "array", items: { type: "object" } },
            createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, completedAt: { type: ["string", "null"], format: "date-time" }
          }
        }
      }
    }
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

catalog.canonicalDigest = `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(catalog))).digest("hex")}`;
const rendered = `${JSON.stringify(catalog, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== rendered) {
    console.error("MCP onboarding catalog is stale. Run: node scripts/generate-mcp-onboarding-catalog.mjs");
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, rendered);
}
