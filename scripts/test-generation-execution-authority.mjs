#!/usr/bin/env node
import assert from "node:assert/strict";
import { GENERATION_EXECUTION_AUTHORITY_MATRIX } from "../apps/server/src/domain/generation.ts";
import { recoverGenerationTechnicalFailure } from "../apps/server/src/generation/generation-failure-recovery.mjs";

const matrixByPath = new Map(GENERATION_EXECUTION_AUTHORITY_MATRIX.map((entry) => [entry.path, entry]));
assert.deepEqual([...matrixByPath.keys()], ["CREATE", "OWNER_FOLLOW_UP", "TECHNICAL_RETRY", "AUTOMATIC_REPAIR", "REMEDIATION"]);
assert.equal(matrixByPath.get("CREATE")?.authorityKind, "OWNER_APPROVED");
assert.equal(matrixByPath.get("OWNER_FOLLOW_UP")?.approvalRequired, true);
assert.equal(matrixByPath.get("TECHNICAL_RETRY")?.sourceSpecification, "current frozen authority lineage");
assert.equal(matrixByPath.get("AUTOMATIC_REPAIR")?.authorityKind, "INHERITED_TECHNICAL");
assert.equal(matrixByPath.get("REMEDIATION")?.sourceSpecification, "same job frozen authority lineage");

const runRecovery = async ({ phase, jobKind, attempts, maxAttempts }) => {
  const states = [];
  const events = [];
  const cleaned = [];
  let restored = 0;
  const result = await recoverGenerationTechnicalFailure({
    phase,
    jobKind,
    attempts,
    maxAttempts,
    componentIds: ["component-1"],
    errorMessage: "typed_validation_failure",
    setState: async (state, params) => states.push({ state, params }),
    appendEvent: async (phaseName, eventType, message, details) => events.push({ phase: phaseName, eventType, message, details }),
    failClosedComponent: async () => { throw new Error("not expected for this phase"); },
    cleanupCandidate: async (componentId) => cleaned.push(componentId),
    restoreRepairBase: async () => { restored += 1; }
  });
  return { result, states, events, cleaned, restored };
};

const technicalRetry = await runRecovery({ phase: "INTEGRATING", jobKind: "CREATE", attempts: 1, maxAttempts: 3 });
assert.deepEqual(technicalRetry.result, { action: "RETRY_INTEGRATING", candidateAbandoned: false });
assert.deepEqual(technicalRetry.cleaned, []);
assert.equal(technicalRetry.restored, 0);
assert.equal(technicalRetry.states[0]?.state, "INTEGRATING");
assert.equal(technicalRetry.events[0]?.eventType, "generation.integration_remediation_scheduled");

const repairRemediation = await runRecovery({ phase: "VALIDATING", jobKind: "REPAIR", attempts: 1, maxAttempts: 3 });
assert.deepEqual(repairRemediation.result, { action: "REIMPLEMENT", candidateAbandoned: true });
assert.deepEqual(repairRemediation.cleaned, ["component-1"]);
assert.equal(repairRemediation.restored, 1);
assert.equal(repairRemediation.states[0]?.state, "IMPLEMENTING");
assert.equal(repairRemediation.events[0]?.eventType, "generation.repair_remediation_scheduled");

const exhausted = await runRecovery({ phase: "VALIDATING", jobKind: "REPAIR", attempts: 4, maxAttempts: 3 });
assert.deepEqual(exhausted.result, { action: "FAILED", candidateAbandoned: true });
assert.deepEqual(exhausted.cleaned, ["component-1"]);
assert.equal(exhausted.restored, 1);
assert.equal(exhausted.states[0]?.state, "FAILED");
assert.equal(exhausted.events[0]?.eventType, "generation.failed");

console.log("PASS execution authority preserves frozen specification for technical retry, remediation and automatic repair");
