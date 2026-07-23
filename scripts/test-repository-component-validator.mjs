import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY_COMPONENT_CATALOG_PATH,
  REPOSITORY_COMPONENT_SOURCE_MANIFEST_SCHEMA_PATH
} from "./repository-component-contract.mjs";
import { validateRepositoryComponents } from "./validate-repository-components.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kcml-validator-"));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode });
}

function copySupportFiles(targetRoot) {
  for (const relative of [
    REPOSITORY_COMPONENT_CATALOG_PATH,
    REPOSITORY_COMPONENT_SOURCE_MANIFEST_SCHEMA_PATH,
    "apps/server/src/contracts/component-manifest-2026.07.22-compliance.1.schema.json"
  ]) {
    const target = path.join(targetRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
  }
}

function baseDescriptor(key) {
  return {
    catalogVersion: "1.1",
    repositoryKey: key,
    kind: "AI_AGENT",
    displayName: "Inventory agent",
    businessPurpose: "Deterministically validates warehouse inventory updates before they are published.",
    owners: { service: "Operations", technical: "Platform Engineering" },
    runtime: "nodejs24-typescript",
    entrypoint: "src/index.ts",
    maintenanceMode: "IN_REPOSITORY",
    registration: { manifest: "manifest.kcml.json", intake: "/v2/component-onboardings", identityAssignedBy: "KCML" }
  };
}

function baseSourceManifest() {
  return {
    schemaVersion: "2026.07.22-compliance.1",
    registrationRevision: "1.0.0",
    displayName: "Inventory component",
    businessPurpose: "Returns deterministic inventory state for controlled warehouse workflows.",
    kind: "inventory-api",
    owners: [{ name: "Inventory", team: "Operations" }],
    contacts: [{ type: "EMAIL", value: "inventory@example.com" }],
    criticality: { level: "HIGH", reviewIntervalDays: 90 },
    artifact: {
      type: "OCI_IMAGE",
      provenance: { issuer: "https://github.com/karelmartinek-a11y/KajovoCML" },
      buildContract: {
        workflow: ".github/workflows/repository-component-deploy.yml",
        registryPathTemplate: "ghcr.io/<owner>/kajovocml-components/<repository-key>:<commit-sha>",
        finalizeWithReceipt: "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json"
      }
    },
    runtime: {
      transport: "UDS",
      executionMode: "LONG_RUNNING",
      lifecycle: { prepareRequired: true, gracefulShutdownSeconds: 30, singleActiveWorker: true },
      readinessMode: "DEPENDENCY_AWARE",
      persistentState: { required: true, mountPath: "/var/lib/kcml-data", survivesRestart: true, survivesUpgrade: true, survivesRollback: true },
      secretGrants: [{ name: "MAIL_RECEPCE_PASS" }, { name: "API_KEY_VECTOR" }],
      egressGrants: [{ type: "TCP_TLS", targetHost: "imap.example.com", port: 993, servername: "imap.example.com", scope: "mail.sync", protocol: "TCP_TLS" }],
      resources: { cpuMillis: 200, memoryMiB: 128, maxConcurrency: 8 }
    },
    capabilities: ["mcp.tools.call"],
    tools: [{
      name: "inventory.lookup",
      title: "Inventory lookup",
      description: "Looks up inventory.",
      inputSchema: { type: "object", required: ["sku"], additionalProperties: false, properties: { sku: { type: "string" } } },
      outputSchema: { type: "object", required: ["available"], additionalProperties: false, properties: { available: { type: "boolean" } } },
      scope: "inventory.lookup",
      timeoutMs: 5000,
      limits: { requestMaxBytes: 1024, responseMaxBytes: 1024 }
    }],
    endpoints: [],
    pulses: { incoming: [], outgoing: [] },
    states: { states: [{ key: "LIFECYCLE", category: "OPERATIONAL", schema: { type: "object", properties: { enabled: { type: "boolean" } } } }], transitions: [] },
    controlPlane: {
      enable: { path: "/v1/kcml/control/enable", requestSchema: { type: "object" }, responseSchema: { type: "object" } },
      disable: { path: "/v1/kcml/control/disable", requestSchema: { type: "object" }, responseSchema: { type: "object" } },
      state: { path: "/v1/kcml/control/state", requestSchema: { type: "object" }, responseSchema: { type: "object" } },
      heartbeat: { path: "/v1/kcml/control/heartbeat", requestSchema: { type: "object" }, responseSchema: { type: "object" } }
    },
    e2eScenarios: [{
      scenarioKey: "lookup",
      variantKey: "known",
      invocation: { kind: "TOOL", name: "inventory.lookup" },
      input: { mediaType: "application/json", json: { sku: "A-1" } },
      expected: { mediaType: "application/json", json: { available: true } },
      timeoutMs: 5000,
      deterministic: true,
      cleanup: { required: false }
    }],
    documentationEvidence: [{
      key: "runbook",
      path: "evidence/runbook.md",
      digest: `sha256:${"a".repeat(64)}`,
      content: { mediaType: "text/markdown", base64: "IyBSdW5ib29r" }
    }],
    secretPolicy: { authorizationAuthority: "KCML", allSecretsRequireGrant: true, auditLevel: "FULL" },
    outboundPolicies: [{ type: "TCP_TLS", targetHost: "imap.example.com", port: 993, servername: "imap.example.com", scope: "mail.sync", protocol: "TCP_TLS" }],
    monitoring: { probes: [{ kind: "runtime", intervalSeconds: 60 }], staleAfterSeconds: 180, disableAfterSeconds: 600 },
    auditPolicy: { technicalAudit: "PLATFORM", payloadProtection: "ENCRYPTED", retentionDays: 365 }
  };
}

function baseFinalManifest() {
  return {
    ...baseSourceManifest(),
    artifact: {
      type: "OCI_IMAGE",
      digest: `sha256:${"b".repeat(64)}`,
      provenance: { issuer: "https://github.com/karelmartinek-a11y/KajovoCML" },
      imageReference: `ghcr.io/example/kajovocml-components/alpha-service@sha256:${"b".repeat(64)}`
    },
    runtime: {
      transport: "UDS",
      executionMode: "LONG_RUNNING",
      runtimeDigest: `sha256:${"b".repeat(64)}`,
      socketPath: "/var/lib/kcml/repository-components/alpha-service/live/worker.sock",
      lifecycle: { prepareRequired: true, gracefulShutdownSeconds: 30, singleActiveWorker: true },
      readinessMode: "DEPENDENCY_AWARE",
      persistentState: { required: true, mountPath: "/var/lib/kcml-data", survivesRestart: true, survivesUpgrade: true, survivesRollback: true },
      secretGrants: [{ name: "MAIL_RECEPCE_PASS" }, { name: "API_KEY_VECTOR" }],
      egressGrants: [{ type: "TCP_TLS", targetHost: "imap.example.com", port: 993, servername: "imap.example.com", scope: "mail.sync", protocol: "TCP_TLS" }],
      resources: { cpuMillis: 200, memoryMiB: 128, maxConcurrency: 8 }
    }
  };
}

function createValidComponent(targetRoot, key, manifest = baseSourceManifest()) {
  const dir = path.join(targetRoot, "components", key);
  writeJson(path.join(dir, "component.kcml.json"), baseDescriptor(key));
  writeJson(path.join(dir, "manifest.kcml.json"), manifest);
  writeText(path.join(dir, "README.md"), "# Component\n");
  writeJson(path.join(dir, "package.json"), {
    name: key,
    private: true,
    type: "module",
    engines: { node: ">=24.0.0" },
    scripts: { lint: "eslint src", typecheck: "tsc --noEmit -p tsconfig.json", test: "vitest run", build: "tsc -p tsconfig.json" },
    dependencies: { zod: "4.0.0" },
    devDependencies: { "@types/node": "24.0.0", eslint: "9.30.1", typescript: "5.8.3", vitest: "3.2.4" }
  });
  writeText(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeText(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext" } }));
  writeText(path.join(dir, "src/index.ts"), "export async function start(context) { await context.runtime.reportReady({ ready: true, status: \"PREPARED\", dependencySummary: { phase: \"start\" } }); }\nexport async function stop() { return undefined; }\nexport async function invoke(input, context) { return { ok: true, input, context }; }\n");
  writeText(path.join(dir, "src/invoke.test.ts"), "import { describe, it, expect } from \"vitest\";\ndescribe(\"invoke\", () => it(\"works\", () => expect(true).toBe(true)));\n");
  writeText(path.join(dir, "evidence/architecture.md"), "# Architecture\n");
  writeText(path.join(dir, "evidence/threat-model.md"), "# Threat model\n");
  writeText(path.join(dir, "evidence/runbook.md"), "# Runbook\n");
  return dir;
}

function expectFailure(name, failures, fragment) {
  assert.ok(failures.some((failure) => failure.includes(fragment)), `${name}: missing failure fragment ${fragment}\n${failures.join("\n")}`);
}

copySupportFiles(tempRoot);

{
  const scenario = path.join(tempRoot, "valid-source");
  copySupportFiles(scenario);
  createValidComponent(scenario, "alpha-service");
  assert.deepEqual(validateRepositoryComponents({ rootDir: scenario }), []);
}

{
  const scenario = path.join(tempRoot, "missing-long-running-hooks");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  writeText(path.join(dir, "src/index.ts"), "export async function invoke(input, context) { return { ok: true, input, context }; }\n");
  const failures = validateRepositoryComponents({ rootDir: scenario });
  expectFailure("missing-long-running-hooks", failures, "LONG_RUNNING component missing export start(context)");
  expectFailure("missing-long-running-hooks", failures, "LONG_RUNNING component missing export stop(context)");
}

{
  const scenario = path.join(tempRoot, "valid-final");
  copySupportFiles(scenario);
  createValidComponent(scenario, "alpha-service", baseFinalManifest());
  assert.deepEqual(validateRepositoryComponents({ rootDir: scenario }), []);
}

{
  const scenario = path.join(tempRoot, "missing-files");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  fs.rmSync(path.join(dir, "README.md"));
  fs.rmSync(path.join(dir, "evidence/runbook.md"));
  const failures = validateRepositoryComponents({ rootDir: scenario });
  expectFailure("missing-files", failures, "missing README.md");
  expectFailure("missing-files", failures, "missing evidence/runbook.md");
}

{
  const scenario = path.join(tempRoot, "invalid-path");
  copySupportFiles(scenario);
  createValidComponent(scenario, "invalid-Key");
  const failures = validateRepositoryComponents({ rootDir: scenario });
  expectFailure("invalid-path", failures, "invalid repository key");
}

{
  const scenario = path.join(tempRoot, "non-exact-version");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  pkg.dependencies.zod = "^4.0.0";
  writeJson(path.join(dir, "package.json"), pkg);
  expectFailure("non-exact-version", validateRepositoryComponents({ rootDir: scenario }), "dependency zod must use exact version");
}

{
  const scenario = path.join(tempRoot, "disallowed-dependency");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  pkg.dependencies.axios = "1.8.0";
  writeJson(path.join(dir, "package.json"), pkg);
  expectFailure("disallowed-dependency", validateRepositoryComponents({ rootDir: scenario }), "runtime dependency not allowed axios");
}

{
  const scenario = path.join(tempRoot, "symlink");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  fs.symlinkSync("README.md", path.join(dir, "src/readme-link.md"));
  expectFailure("symlink", validateRepositoryComponents({ rootDir: scenario }), "symlink forbidden src/readme-link.md");
}

{
  const scenario = path.join(tempRoot, "dockerfile");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  writeText(path.join(dir, "Dockerfile"), "FROM scratch\n");
  expectFailure("dockerfile", validateRepositoryComponents({ rootDir: scenario }), "custom Dockerfile forbidden Dockerfile");
}

{
  const scenario = path.join(tempRoot, "secret");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  writeText(path.join(dir, "src/secret.ts"), "export const token = \"kci_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd\";\n");
  expectFailure("secret", validateRepositoryComponents({ rootDir: scenario }), "secret-like material");
}

{
  const scenario = path.join(tempRoot, "cross-component");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  createValidComponent(scenario, "beta-service");
  writeText(path.join(dir, "src/index.ts"), "import { invoke as other } from \"../../beta-service/src/index.ts\";\nexport async function invoke(input, context) { return other(input, context); }\n");
  expectFailure("cross-component", validateRepositoryComponents({ rootDir: scenario, repositoryKey: "alpha-service" }), "cross-component import forbidden");
}

{
  const scenario = path.join(tempRoot, "apps-import");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  writeText(path.join(scenario, "apps/server/src/private.ts"), "export const secret = true;\n");
  writeText(path.join(dir, "src/index.ts"), "import { secret } from \"../../../apps/server/src/private.ts\";\nexport async function invoke() { return { secret }; }\n");
  expectFailure("apps-import", validateRepositoryComponents({ rootDir: scenario }), "private apps import forbidden");
}

{
  const scenario = path.join(tempRoot, "db");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  pkg.dependencies.pg = "8.13.1";
  writeJson(path.join(dir, "package.json"), pkg);
  writeText(path.join(dir, "src/index.ts"), "import pg from \"pg\";\nexport async function invoke() { return { ok: Boolean(pg) }; }\n");
  const failures = validateRepositoryComponents({ rootDir: scenario });
  expectFailure("db", failures, "direct database dependency forbidden pg");
  expectFailure("db", failures, "direct database import forbidden");
}

{
  const scenario = path.join(tempRoot, "binary");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  const binary = path.join(dir, "src/native");
  fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]), { mode: 0o755 });
  expectFailure("binary", validateRepositoryComponents({ rootDir: scenario }), "binary executable forbidden src/native");
}

{
  const scenario = path.join(tempRoot, "missing-tests");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  fs.rmSync(path.join(dir, "src/invoke.test.ts"));
  expectFailure("missing-tests", validateRepositoryComponents({ rootDir: scenario }), "missing recursive src test");
}

{
  const scenario = path.join(tempRoot, "ignored-generated");
  copySupportFiles(scenario);
  const dir = createValidComponent(scenario, "alpha-service");
  writeText(path.join(dir, "node_modules/secret.txt"), "kci_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd\n");
  writeText(path.join(dir, "dist/secret.txt"), "password = very-secret-and-should-be-ignored\n");
  assert.deepEqual(validateRepositoryComponents({ rootDir: scenario }), []);
}

process.stdout.write("repository component validator checks passed\n");
