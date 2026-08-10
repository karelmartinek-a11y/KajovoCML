#!/usr/bin/env node
import assert from "node:assert/strict";
import { attemptGeneratedRepairEnqueueWithCmlEvidence } from "../apps/server/src/onboarding/generated-repair-enqueue.mjs";

const componentId = "component-123";
const correlationId = "corr-456";
const sourceEvidence = { source: "component_monitoring_watchdog", probe: "readiness" };
let attempts = 0;
const alerts = [];
const audits = [];
const closes = [];
const withTransaction = async (operation) => operation({ tx: true });
const raiseAlert = async (_client, input) => { alerts.push(input); return { id: "alert-1" }; };
const appendAudit = async (_client, input) => { audits.push(input); };
const closeAlert = async (_client, input) => { closes.push(input); };

const first = await attemptGeneratedRepairEnqueueWithCmlEvidence({
  componentId,
  correlationId,
  evidence: sourceEvidence,
  enqueue: async () => { attempts += 1; throw new Error("database_unique_or_dependency_failure"); },
  withTransaction,
  raiseAlert,
  appendAudit,
  closeAlert
});
assert.equal(first, null);
assert.equal(attempts, 1);
assert.equal(alerts.length, 1);
assert.equal(audits.length, 1);
assert.equal(alerts[0].severity, "HIGH");
assert.equal(alerts[0].alertType, `component.repair.enqueue_failed.${componentId}`);
assert.deepEqual(alerts[0].detail, {
  componentId,
  correlationId,
  technicalReason: "database_unique_or_dependency_failure",
  source: "component_monitoring_watchdog"
});
assert.equal(audits[0].eventType, "generated_component.repair_enqueue_failed");
assert.equal(audits[0].objectId, componentId);
assert.equal(audits[0].correlationId, correlationId);
assert.equal(audits[0].after.technicalReason, "database_unique_or_dependency_failure");

const second = await attemptGeneratedRepairEnqueueWithCmlEvidence({
  componentId,
  correlationId: "corr-789",
  evidence: sourceEvidence,
  enqueue: async () => { attempts += 1; return { id: "repair-job" }; },
  withTransaction,
  raiseAlert,
  appendAudit,
  closeAlert
});
assert.deepEqual(second, { id: "repair-job" });
assert.equal(attempts, 2, "next monitoring cycle did not retry");
assert.equal(closes.length, 1);
assert.deepEqual(closes[0], {
  alertType: `component.repair.enqueue_failed.${componentId}`,
  reason: "repair_enqueue_recovered",
  correlationId: "corr-789"
});
console.log("PASS repair enqueue failure emits existing CML alert/audit evidence and later monitoring cycle retries");
