import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  raiseAlert: vi.fn(async () => ({ id: "alert-1", created: true })),
  closeAlert: vi.fn(async () => undefined),
  appendAudit: vi.fn(async () => undefined)
}));
vi.mock("../domain/alerts.js", async () => ({
  raiseAlert: mocks.raiseAlert,
  closeAlert: mocks.closeAlert,
  deliverNextAlert: vi.fn(async () => false),
  expireAlertSuppressions: vi.fn(async () => 0)
}));
vi.mock("../domain/audit.js", async () => ({
  appendAudit: mocks.appendAudit,
  verifyAuditChain: vi.fn(async () => ({ valid: true }))
}));

import { enqueueGeneratedRepairFromMonitoring } from "./monitoring.js";

function fakeDb() {
  const client = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })), release: vi.fn() };
  return { db: { connect: vi.fn(async () => client) }, client };
}

describe("generated repair enqueue monitoring evidence", () => {
  beforeEach(() => { mocks.raiseAlert.mockClear(); mocks.closeAlert.mockClear(); mocks.appendAudit.mockClear(); });

  it("records existing CML alert and audit evidence instead of swallowing enqueue failure", async () => {
    const { db } = fakeDb();
    const enqueue = vi.fn(async () => { throw new Error("repair_insert_failed"); });
    await enqueueGeneratedRepairFromMonitoring(db as never, "component-1", { source: "component_monitoring_watchdog", probe: "readiness" }, "corr-1", enqueue);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.raiseAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      severity: "HIGH", correlationId: "corr-1", detail: expect.objectContaining({ componentId: "component-1", correlationId: "corr-1", technicalReason: "repair_insert_failed" })
    }));
    expect(mocks.appendAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "generated_component.repair_enqueue_failed", objectId: "component-1", correlationId: "corr-1",
      after: expect.objectContaining({ componentId: "component-1", technicalReason: "repair_insert_failed" })
    }));
  });

  it("closes the failure alert after a later normal monitoring cycle can enqueue again", async () => {
    const { db } = fakeDb();
    await enqueueGeneratedRepairFromMonitoring(db as never, "component-1", { source: "component_monitoring_watchdog" }, "corr-2", (async () => ({ id: "repair-job" })) as never);
    expect(mocks.closeAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      alertType: "component.repair.enqueue_failed.component-1", reason: "repair_enqueue_recovered", correlationId: "corr-2"
    }));
  });
});
