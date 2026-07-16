import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { MCP_ONBOARDING_GATES, ONBOARDING_JOB_STATES } from "./onboarding.js";
import { onboardingCatalogDigest } from "./onboarding-catalog.js";
import { validateOnboardingManifest, type RegistrationManifest15 } from "./registration.js";
import { MCP_ARCHIVE_POLICY } from "./upload-validation.js";
import { REQUIRED_ONBOARDING_CHECKS } from "../onboarding/github.js";

const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const mcpCatalog = readJson("../../../../docs/onboarding-catalogs/mcp-1.7.json");
const mcpManifestSchema = readJson("../contracts/mcp-manifest-1.5.schema.json");
const externalCatalog = readJson("../../../../docs/onboarding-catalogs/external-api-1.0.json");
const mcpExample = readJson("../../../../docs/onboarding-manifest-v1.5.example.json");
const externalExample = readJson("../../../../docs/service-manifest-external-api-v1.0.example.json");

describe("machine-readable onboarding catalogs", () => {
  it("publishes complete JSON Schema and programmer API contracts for both service kinds", () => {
    expect(mcpCatalog).toMatchObject({
      version: "1.7",
      serviceKind: "MCP",
      manifestSchemaVersion: "1.5",
      programmerApi: { openapi: "3.1.0" }
    });
    expect(externalCatalog).toMatchObject({
      version: "1.0",
      serviceKind: "EXTERNAL_API",
      programmerApi: { openapi: "3.1.0" }
    });
    expect(mcpCatalog.jsonSchema).toEqual(mcpManifestSchema);
    expect((mcpCatalog.programmerApi as { paths: Record<string, unknown> }).paths).toEqual(expect.objectContaining({
      "/v1/service-onboardings": expect.any(Object),
      "/v1/service-onboardings/{id}": expect.any(Object),
      "/v1/service-onboardings/{id}/revision": expect.any(Object),
      "/v1/service-onboardings/{id}/cancel": expect.any(Object)
    }));
    const programmerApi = mcpCatalog.programmerApi as {
      components: { schemas: { ErrorResponse: Record<string, unknown>; OnboardingJob: { properties: { state: { enum: string[] } } } } };
    };
    expect(programmerApi.components.schemas.OnboardingJob.properties.state.enum).toEqual(ONBOARDING_JOB_STATES);
    expect(programmerApi.components.schemas.ErrorResponse).toMatchObject({
      required: ["error", "message", "correlationId"],
      properties: {
        error: { type: "string" },
        message: { type: "string" },
        correlationId: { type: "string", format: "uuid" }
      }
    });
  });

  it("binds the published digest to canonical catalog content", () => {
    expect(mcpCatalog.canonicalDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(mcpCatalog.canonicalDigest).toBe(onboardingCatalogDigest(mcpCatalog));
    const tampered = clone(mcpCatalog);
    tampered.version = "1.7-tampered";
    expect(onboardingCatalogDigest(tampered)).not.toBe(mcpCatalog.canonicalDigest);
  });

  it("keeps gates, CI checks and archive limits aligned with executable policy", () => {
    expect(mcpCatalog.pipelineGates).toEqual(MCP_ONBOARDING_GATES.map(([name, stage]) => ({ name, stage })));
    expect(mcpCatalog.requiredCiChecks).toEqual(REQUIRED_ONBOARDING_CHECKS);
    expect(mcpCatalog.archivePolicy).toMatchObject({
      maxArchiveBytes: MCP_ARCHIVE_POLICY.maxArchiveBytes,
      maxExpandedBytes: MCP_ARCHIVE_POLICY.maxExpandedBytes,
      maxFiles: MCP_ARCHIVE_POLICY.maxFiles,
      runtimeDependencies: MCP_ARCHIVE_POLICY.runtimeDependencies,
      developmentDependencies: MCP_ARCHIVE_POLICY.developmentDependencies,
      allowedScripts: MCP_ARCHIVE_POLICY.allowedScripts
    });
  });

  it("validates the published MCP example against catalog schema and runtime", () => {
    const validate = ajv.compile(mcpCatalog.jsonSchema as AnySchema);
    expect(validate(mcpExample), JSON.stringify(validate.errors)).toBe(true);
    expect(validateOnboardingManifest(mcpExample).manifest.schemaVersion).toBe("1.5");
  });

  it.each([
    ["nested required property", (manifest: RegistrationManifest15) => { delete (manifest.monitoringProfile.sloTargets as Partial<RegistrationManifest15["monitoringProfile"]["sloTargets"]>).p95LatencyMs; }],
    ["nested unknown property", (manifest: RegistrationManifest15) => { Object.assign(manifest.behavior.rateLimit, { unpublished: true }); }],
    ["bounded integer", (manifest: RegistrationManifest15) => { manifest.behavior.maxConcurrency = 33; }],
    ["literal retry policy", (manifest: RegistrationManifest15) => { (manifest.behavior.retryPolicy as { automaticRetry: boolean }).automaticRetry = true; }],
    ["secret reference URI", (manifest: RegistrationManifest15) => { manifest.dependencies.secretReferences = [{ reference: "plain-secret", owner: "Security Owner", rotationDays: 90, lastRotatedAt: "2026-07-01T00:00:00Z" }]; }]
  ])("rejects %s consistently in published schema and runtime", (_name, mutate) => {
    const invalid = clone(mcpExample) as unknown as RegistrationManifest15;
    mutate(invalid);
    const validate = ajv.compile(mcpCatalog.jsonSchema as AnySchema);
    expect(validate(invalid)).toBe(false);
    expect(() => validateOnboardingManifest(invalid)).toThrow();
  });

  it.each([
    ["effect_class_annotations_mismatch", (manifest: RegistrationManifest15) => { manifest.tool.annotations.readOnlyHint = false; }],
    ["data_export_policy_mismatch", (manifest: RegistrationManifest15) => { manifest.dataGovernance.exportDestinations = ["US"]; }],
    ["load_profile_exceeds_concurrency", (manifest: RegistrationManifest15) => { manifest.testContract.loadProfile.expectedConcurrency = 5; }],
    ["monitoring_stale_window_too_short", (manifest: RegistrationManifest15) => { manifest.monitoringProfile.staleAfterSeconds = 30; }],
    ["previous_revision_mismatch", (manifest: RegistrationManifest15) => { manifest.change.previousApprovedRevision = "2026-01-01.1"; }]
  ])("documents and enforces semantic rule %s", (code, mutate) => {
    expect((mcpCatalog.semanticRules as Array<{ code: string }>).map((rule) => rule.code)).toContain(code);
    const invalid = clone(mcpExample) as unknown as RegistrationManifest15;
    mutate(invalid);
    expect(() => validateOnboardingManifest(invalid)).toThrow(code);
  });

  it("validates the published EXTERNAL_API example against its v1.0 catalog schema", () => {
    const validate = ajv.compile(externalCatalog.jsonSchema as AnySchema);
    expect(validate(externalExample), JSON.stringify(validate.errors)).toBe(true);
  });
});
