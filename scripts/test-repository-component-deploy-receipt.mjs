import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(path.join(root, "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json"), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);

assert.equal(schema.$id, "https://kajovocml.hcasc.cz/contracts/repository-component-deploy-receipt-1.0.schema.json");

const validReceipt = {
  schemaVersion: "1.0",
  repositoryKey: "alpha-service",
  requestedGitRef: "refs/heads/main",
  sourceCommit: "a".repeat(40),
  imageReference: `ghcr.io/example/kajovocml-components/alpha-service@sha256:${"b".repeat(64)}`,
  imageDigest: `sha256:${"b".repeat(64)}`,
  componentVersion: "1.2.3",
  buildRunId: "12345",
  deployRunId: "67890",
  deployRunAttempt: "2",
  workflow: ".github/workflows/repository-component-deploy.yml",
  runtimeKind: "UDS",
  runtimeLocation: "/var/lib/kcml/repository-components/alpha-service/live/worker.sock",
  runtimeIdentifier: "kcml-repository-component-alpha-service",
  previousImageDigest: `sha256:${"c".repeat(64)}`,
  deployedAt: "2026-07-23T08:00:00Z",
  health: {
    status: "PASS",
    checkedAt: "2026-07-23T08:00:01Z",
    evidenceDigest: `sha256:${"d".repeat(64)}`
  }
};

assert.equal(validate(validReceipt), true, JSON.stringify(validate.errors));

const invalidReceipt = {
  ...validReceipt,
  imageReference: "ghcr.io/example/kajovocml-components/alpha-service:mutable-tag"
};

assert.equal(validate(invalidReceipt), false);
assert.ok(validate.errors?.some((error) => error.instancePath === "/imageReference"));

process.stdout.write("repository component deploy receipt schema checks passed\n");
