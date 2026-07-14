import { describe, expect, it } from "vitest";
import { digestCanonicalJson, validateManifest, validateOnboardingManifest } from "./registration.js";

const inputSchema = { type: "object", additionalProperties: false, properties: {} };
const outputSchema = { type: "object", additionalProperties: false, properties: {} };
const protocol = {
  protocolVersion: "2025-11-25",
  transport: "streamable-http",
  capabilities: ["tools"],
  errorCatalog: [{ code: "E_TEST", description: "Test error" }]
};
const dependencies = {
  runtime: [{ name: "nodejs22", version: "22.0.0" }],
  externalServices: ["auth"],
  secretRefs: ["vault://kcml/test"],
  networkPolicy: {
    outboundAllowlist: ["auth.example.com"],
    dnsPolicy: "strict",
    databaseRole: "kcml_reader",
    filesystemPolicy: "read-only"
  },
  dataClassification: {
    input: "internal",
    output: "internal",
    containsPersonalData: false,
    loggingPolicy: "redacted",
    redactionFields: ["token"],
    retentionPolicy: "30 days"
  }
};

const validManifest = {
  schemaVersion: "1.3",
  registrationRevision: "rev-1",
  environment: "production",
  identity: { code: "KCML0001", hostname: "kcml0001.hcasc.cz", resource: "https://kcml0001.hcasc.cz/mcp" },
  handlerKey: "example",
  handlerVersion: "1.0.0",
  displayName: "Example",
  businessPurpose: "A concrete production purpose.",
  owners: { service: "svc", technical: "tech", security: "sec", operations: "ops" },
  tool: {
    name: "example",
    title: "example",
    description: "Example tool",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, taskSupport: "forbidden" }
  },
  contractDigests: { inputSchema: digestCanonicalJson(inputSchema), outputSchema: digestCanonicalJson(outputSchema) },
  behavior: {
    effectClass: "READ_ONLY",
    timeoutMs: 1000,
    maxConcurrency: 1,
    requestMaxBytes: 1024,
    responseMaxBytes: 1024,
    rateLimit: { windowSeconds: 60, maxRequests: 10 },
    shutdownPolicy: "COMPLETE_IN_FLIGHT",
    idempotencyPolicy: "read only",
    retryPolicy: { automaticRetry: false }
  },
  testContract: { safeInput: {}, expectedResult: {}, cleanupOrCompensation: "none required" },
  protocol,
  dependencies,
  monitoringProfile: {
    sloTargets: {},
    probeIntervals: {},
    alertRules: [{ severity: "critical" }],
    runbookRef: "docs/runbooks/example.md",
    primaryAlertChannel: "primary",
    backupAlertChannel: "backup"
  },
  errorCatalog: [{ code: "E_TEST", description: "Test error" }],
  approvals: { architecture: "approved", security: "approved", operations: "approved" },
  artifact: {
    sourceCommit: "abc123",
    buildId: "build-1",
    digest: `sha256:${"a".repeat(64)}`,
    sbomDigest: `sha256:${"b".repeat(64)}`
  },
  change: {
    changeClass: "MINOR",
    migrationRef: "migrations/001.sql",
    rollbackRef: "rollback",
    decommissionRef: "decommission",
    previousApprovedRevision: null,
    reviewDueAt: "2027-01-01T00:00:00.000Z"
  }
};

describe("registration manifest", () => {
  it("accepts strict complete manifests", () => {
    expect(validateManifest(validManifest, "hcasc.cz").digest).toMatch(/^sha256:/);
  });

  it("rejects unknown fields and automatic retry", () => {
    expect(() => validateManifest({ ...validManifest, extra: true }, "hcasc.cz")).toThrow();
    expect(() => validateManifest({ ...validManifest, behavior: { ...validManifest.behavior, retryPolicy: { automaticRetry: true } } }, "hcasc.cz")).toThrow();
  });

  it("binds the digest to nested contract values", () => {
    const original = validateManifest(validManifest, "hcasc.cz").digest;
    const changed = validateManifest({
      ...validManifest,
      behavior: { ...validManifest.behavior, timeoutMs: validManifest.behavior.timeoutMs + 1 }
    }, "hcasc.cz").digest;
    expect(changed).not.toBe(original);
  });
});

const onboardingManifest = {
  schemaVersion: "1.4",
  registrationRevision: "rev-1",
  environment: "production",
  handlerKey: "example-handler",
  handlerVersion: "1.0.0",
  displayName: "Example",
  businessPurpose: "A concrete production purpose.",
  owners: { service: "svc", technical: "tech", security: "sec", operations: "ops" },
  source: { runtime: "nodejs22-typescript", entrypoint: "src/index.ts", testCommand: "pnpm test" },
  runtime: { memoryMb: 128, cpuCores: 0.5, pidsLimit: 32, egressAllowlist: ["api.example.com"] },
  tool: {
    title: "Example",
    description: "Example tool",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, taskSupport: "forbidden" }
  },
  behavior: {
    effectClass: "READ_ONLY", timeoutMs: 1000, maxConcurrency: 1, requestMaxBytes: 1024, responseMaxBytes: 1024,
    rateLimit: { windowSeconds: 60, maxRequests: 10 }, shutdownPolicy: "COMPLETE_IN_FLIGHT", idempotencyPolicy: "read only", retryPolicy: { automaticRetry: false }
  },
  testContract: { safeInput: {}, expectedResult: {}, cleanupOrCompensation: "none required" },
  protocol,
  dependencies,
  monitoringProfile: { sloTargets: {}, probeIntervals: {}, alertRules: [{ severity: "critical" }], runbookRef: "docs/runbooks/example.md", primaryAlertChannel: "primary", backupAlertChannel: "backup" },
  errorCatalog: [{ code: "E_TEST", description: "Test error" }],
  change: {
    changeClass: "MINOR",
    migrationRef: "migrations/001.sql",
    rollbackRef: "rollback",
    decommissionRef: "decommission",
    previousApprovedRevision: null,
    reviewDueAt: "2027-01-01T00:00:00.000Z"
  }
};

describe("automated onboarding manifest", () => {
  it("accepts the isolated Node.js 22 contract", () => {
    expect(validateOnboardingManifest(onboardingManifest).digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects runtime expansion, unknown fields and automatic retries", () => {
    expect(() => validateOnboardingManifest({ ...onboardingManifest, runtime: { ...onboardingManifest.runtime, memoryMb: 2048 } })).toThrow();
    expect(() => validateOnboardingManifest({ ...onboardingManifest, bypassActivation: true })).toThrow();
    expect(() => validateOnboardingManifest({ ...onboardingManifest, behavior: { ...onboardingManifest.behavior, retryPolicy: { automaticRetry: true } } })).toThrow();
  });
});
