import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import type { Db } from "../db.js";

const errorCatalogEntrySchema = z.object({
  code: z.string().min(1).max(120),
  description: z.string().min(1).max(500)
}).strict();

const protocolSchema = z.object({
  protocolVersion: z.literal("2025-11-25"),
  transport: z.literal("streamable-http"),
  capabilities: z.array(z.literal("tools")).min(1).max(1),
  errorCatalog: z.array(errorCatalogEntrySchema).min(1).max(50)
}).strict();

const networkPolicySchema = z.object({
  outboundAllowlist: z.array(z.string().min(1).max(200)).max(20),
  dnsPolicy: z.enum(["strict", "none"]),
  databaseRole: z.string().min(1).max(120),
  filesystemPolicy: z.string().min(1).max(200)
}).strict();

const dataClassificationSchema = z.object({
  input: z.string().min(1).max(120),
  output: z.string().min(1).max(120),
  containsPersonalData: z.boolean(),
  loggingPolicy: z.string().min(1).max(500),
  redactionFields: z.array(z.string().min(1).max(80)).max(50),
  retentionPolicy: z.string().min(1).max(500)
}).strict();

const dependenciesSchema = z.object({
  runtime: z.array(z.object({
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(120)
  }).strict()).max(50),
  externalServices: z.array(z.string().min(1).max(200)).max(50),
  secretRefs: z.array(z.string().min(1).max(200)).max(50),
  networkPolicy: networkPolicySchema,
  dataClassification: dataClassificationSchema
}).strict();

const changeSchema = z.object({
  changeClass: z.enum(["INITIAL", "PATCH", "MINOR", "MAJOR"]),
  migrationRef: z.string().min(1).max(500),
  rollbackRef: z.string().min(1).max(500),
  decommissionRef: z.string().min(1).max(500),
  previousApprovedRevision: z.string().min(1).max(80).nullable(),
  reviewDueAt: z.string().datetime()
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal("1.3"),
  registrationRevision: z.string().min(1),
  environment: z.enum(["production", "staging"]),
  identity: z.object({
    code: z.string().regex(/^KCML[0-9]{4,}$/i),
    hostname: z.string().regex(/^kcml[0-9]{4,}[.][a-z0-9.-]+$/i),
    resource: z.string().url()
  }),
  handlerKey: z.string().regex(/^[a-z0-9_-]+$/),
  handlerVersion: z.string().min(1),
  displayName: z.string().min(1),
  businessPurpose: z.string().min(10),
  owners: z.object({
    service: z.string().min(1),
    technical: z.string().min(1),
    security: z.string().min(1),
    operations: z.string().min(1)
  }),
  tool: z.object({
    name: z.string().regex(/^[a-z0-9_-]+$/),
    title: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
    annotations: z.object({
      readOnlyHint: z.boolean(),
      destructiveHint: z.boolean(),
      idempotentHint: z.boolean(),
      openWorldHint: z.boolean(),
      taskSupport: z.literal("forbidden")
    })
  }),
  contractDigests: z.object({
    inputSchema: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    outputSchema: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }),
  behavior: z.object({
    effectClass: z.enum(["READ_ONLY", "IDEMPOTENT_WRITE", "NON_IDEMPOTENT_WRITE"]),
    timeoutMs: z.number().int().min(100).max(60_000),
    maxConcurrency: z.number().int().min(1).max(100),
    requestMaxBytes: z.number().int().min(1),
    responseMaxBytes: z.number().int().min(1),
    rateLimit: z.object({ windowSeconds: z.number().int().min(1), maxRequests: z.number().int().min(1) }),
    shutdownPolicy: z.enum(["COMPLETE_IN_FLIGHT", "CANCEL_SAFE", "COMPENSATE"]),
    idempotencyPolicy: z.string().min(1),
    retryPolicy: z.object({ automaticRetry: z.literal(false) })
  }),
  testContract: z.object({
    safeInput: z.record(z.unknown()),
    expectedResult: z.record(z.unknown()),
    cleanupOrCompensation: z.string().min(1)
  }),
  protocol: protocolSchema,
  dependencies: dependenciesSchema,
  monitoringProfile: z.object({
    sloTargets: z.record(z.unknown()),
    probeIntervals: z.record(z.unknown()),
    alertRules: z.array(z.record(z.unknown())).min(1),
    runbookRef: z.string().min(1),
    primaryAlertChannel: z.string().min(1),
    backupAlertChannel: z.string().min(1)
  }),
  errorCatalog: z.array(errorCatalogEntrySchema).min(1).max(50),
  approvals: z.object({
    architecture: z.string().min(1),
    security: z.string().min(1),
    operations: z.string().min(1)
  }),
  artifact: z.object({
    sourceCommit: z.string().min(1),
    buildId: z.string().min(1),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sbomDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }),
  change: changeSchema
}).strict();

const onboardingManifestSchema = z.object({
  schemaVersion: z.literal("1.4"),
  registrationRevision: z.string().min(1).max(80),
  environment: z.enum(["production", "staging"]),
  handlerKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/),
  handlerVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i),
  displayName: z.string().min(1).max(120),
  businessPurpose: z.string().min(10).max(2_000),
  owners: z.object({
    service: z.string().min(1).max(160),
    technical: z.string().min(1).max(160),
    security: z.string().min(1).max(160),
    operations: z.string().min(1).max(160)
  }).strict(),
  source: z.object({
    runtime: z.literal("nodejs22-typescript"),
    entrypoint: z.literal("src/index.ts"),
    testCommand: z.literal("pnpm test")
  }).strict(),
  runtime: z.object({
    memoryMb: z.number().int().min(64).max(512),
    cpuCores: z.number().min(0.1).max(2),
    pidsLimit: z.number().int().min(16).max(256),
    egressAllowlist: z.array(z.string().regex(/^[a-z0-9.-]+(?::\d+)?$/i)).max(20).default([])
  }).strict(),
  tool: z.object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(2_000),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
    annotations: z.object({
      readOnlyHint: z.boolean(),
      destructiveHint: z.boolean(),
      idempotentHint: z.boolean(),
      openWorldHint: z.boolean(),
      taskSupport: z.literal("forbidden")
    }).strict()
  }).strict(),
  behavior: z.object({
    effectClass: z.enum(["READ_ONLY", "IDEMPOTENT_WRITE", "NON_IDEMPOTENT_WRITE"]),
    timeoutMs: z.number().int().min(100).max(60_000),
    maxConcurrency: z.number().int().min(1).max(32),
    requestMaxBytes: z.number().int().min(1).max(1_048_576),
    responseMaxBytes: z.number().int().min(1).max(5_242_880),
    rateLimit: z.object({ windowSeconds: z.number().int().min(1), maxRequests: z.number().int().min(1) }).strict(),
    shutdownPolicy: z.enum(["COMPLETE_IN_FLIGHT", "CANCEL_SAFE", "COMPENSATE"]),
    idempotencyPolicy: z.string().min(1).max(500),
    retryPolicy: z.object({ automaticRetry: z.literal(false) }).strict()
  }).strict(),
  testContract: z.object({
    safeInput: z.record(z.unknown()),
    expectedResult: z.record(z.unknown()),
    cleanupOrCompensation: z.string().min(1).max(1_000)
  }).strict(),
  protocol: protocolSchema,
  dependencies: dependenciesSchema,
  monitoringProfile: z.object({
    sloTargets: z.record(z.unknown()),
    probeIntervals: z.record(z.unknown()),
    alertRules: z.array(z.record(z.unknown())).min(1).max(50),
    runbookRef: z.string().min(1).max(500),
    primaryAlertChannel: z.string().min(1).max(200),
    backupAlertChannel: z.string().min(1).max(200)
  }).strict(),
  errorCatalog: z.array(errorCatalogEntrySchema).min(1).max(50),
  change: changeSchema
}).strict();

function assertAnnotationPolicy(annotations: {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}, effectClass: "READ_ONLY" | "IDEMPOTENT_WRITE" | "NON_IDEMPOTENT_WRITE"): void {
  if (effectClass === "READ_ONLY") {
    if (!annotations.readOnlyHint || annotations.destructiveHint || !annotations.idempotentHint) {
      throw new Error("effect_class_annotations_mismatch");
    }
    return;
  }
  if (effectClass === "IDEMPOTENT_WRITE") {
    if (annotations.readOnlyHint || annotations.destructiveHint || !annotations.idempotentHint) {
      throw new Error("effect_class_annotations_mismatch");
    }
    return;
  }
  if (annotations.readOnlyHint || annotations.idempotentHint) {
    throw new Error("effect_class_annotations_mismatch");
  }
}

export type RegistrationManifest = z.infer<typeof manifestSchema>;
export type OnboardingManifest = z.infer<typeof onboardingManifestSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateJsonSchemas(inputSchema: Record<string, unknown>, outputSchema: Record<string, unknown>): void {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.compile(inputSchema);
  ajv.compile(outputSchema);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function digestCanonicalJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function validateManifestIdentity(manifest: RegistrationManifest, baseDomain: string): void {
  const expectedHostname = `${manifest.identity.code.toLowerCase()}.${baseDomain}`;
  if (manifest.identity.hostname.toLowerCase() !== expectedHostname.toLowerCase()) {
    throw new Error("identity_hostname_mismatch");
  }
  if (manifest.identity.resource !== `https://${manifest.identity.hostname}/mcp`) {
    throw new Error("identity_resource_mismatch");
  }
}

export function validateManifest(input: unknown, baseDomain: string): { manifest: RegistrationManifest; digest: string } {
  const manifest = manifestSchema.parse(input);
  validateJsonSchemas(manifest.tool.inputSchema, manifest.tool.outputSchema);
  validateManifestIdentity(manifest, baseDomain);
  assertAnnotationPolicy(manifest.tool.annotations, manifest.behavior.effectClass);
  if (manifest.contractDigests.inputSchema !== digestCanonicalJson(manifest.tool.inputSchema)) throw new Error("input_schema_digest_mismatch");
  if (manifest.contractDigests.outputSchema !== digestCanonicalJson(manifest.tool.outputSchema)) throw new Error("output_schema_digest_mismatch");
  const canonical = canonicalJson(manifest);
  return {
    manifest,
    digest: `sha256:${createHash("sha256").update(canonical).digest("hex")}`
  };
}

export function validateOnboardingManifest(input: unknown): { manifest: OnboardingManifest; digest: string } {
  const manifest = onboardingManifestSchema.parse(input);
  validateJsonSchemas(manifest.tool.inputSchema, manifest.tool.outputSchema);
  assertAnnotationPolicy(manifest.tool.annotations, manifest.behavior.effectClass);
  const canonical = canonicalJson(manifest);
  return {
    manifest,
    digest: `sha256:${createHash("sha256").update(canonical).digest("hex")}`
  };
}

export async function allocateKcml(db: Db, baseDomain: string): Promise<{ code: string; hostname: string; number: number }> {
  const result = await db.query("select nextval('kcml_number_seq') as number");
  const number = Number(result.rows[0].number);
  const code = `KCML${String(number).padStart(4, "0")}`;
  return { number, code, hostname: `${code.toLowerCase()}.${baseDomain}` };
}
