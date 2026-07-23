import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Ajv2020 } from "ajv/dist/2020.js";
import { finalizeRepositoryComponentManifest } from "./finalize-repository-component-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kcml-finalizer-"));

const sourceManifest = {
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
  outboundPolicies: [],
  monitoring: { probes: [{ kind: "runtime", intervalSeconds: 60 }], staleAfterSeconds: 180, disableAfterSeconds: 600 },
  auditPolicy: { technicalAudit: "PLATFORM", payloadProtection: "ENCRYPTED", retentionDays: 365 }
};

const receipt = {
  schemaVersion: "1.0",
  repositoryKey: "inventory-agent",
  requestedGitRef: "refs/heads/main",
  sourceCommit: "a".repeat(40),
  imageReference: `ghcr.io/example/kajovocml-components/inventory-agent@sha256:${"b".repeat(64)}`,
  imageDigest: `sha256:${"b".repeat(64)}`,
  componentVersion: "1.0.0",
  buildRunId: "101",
  deployRunId: "202",
  deployRunAttempt: "1",
  workflow: ".github/workflows/repository-component-deploy.yml",
  runtimeKind: "UDS",
  runtimeLocation: "/var/lib/kcml/repository-components/inventory-agent/live/worker.sock",
  runtimeIdentifier: "kcml-repository-component-inventory-agent",
  previousImageDigest: null,
  deployedAt: "2026-07-23T09:00:00Z",
  health: { status: "PASS", checkedAt: "2026-07-23T09:00:01Z", evidenceDigest: `sha256:${"c".repeat(64)}` }
};

const finalized = finalizeRepositoryComponentManifest({
  repositoryKey: "inventory-agent",
  sourceManifest,
  receipt
});

assert.equal(finalized.artifact.digest, receipt.imageDigest);
assert.equal(finalized.artifact.imageReference, receipt.imageReference);
assert.equal(finalized.runtime.runtimeDigest, receipt.imageDigest);
assert.equal(finalized.runtime.socketPath, receipt.runtimeLocation);

const schema = JSON.parse(fs.readFileSync(path.join(root, "apps/server/src/contracts/component-manifest-2026.07.22-compliance.1.schema.json"), "utf8"));
const validate = new Ajv2020({ strict: true, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(finalized), true, JSON.stringify(validate.errors));

const sourcePath = path.join(tempDir, "source.json");
const receiptPath = path.join(tempDir, "receipt.json");
const outputPath = path.join(tempDir, "final.json");
fs.writeFileSync(sourcePath, JSON.stringify(sourceManifest, null, 2));
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
execFileSync("node", [
  "scripts/finalize-repository-component-manifest.mjs",
  "--repository-key", "inventory-agent",
  "--source-manifest", sourcePath,
  "--receipt", receiptPath,
  "--output", outputPath
], { cwd: root, stdio: "inherit" });

const fromCli = JSON.parse(fs.readFileSync(outputPath, "utf8"));
assert.equal(fromCli.runtime.socketPath, receipt.runtimeLocation);

assert.throws(() => finalizeRepositoryComponentManifest({
  repositoryKey: "other-key",
  sourceManifest,
  receipt
}), /receipt_repository_key_mismatch/);

process.stdout.write("repository component manifest finalizer checks passed\n");
