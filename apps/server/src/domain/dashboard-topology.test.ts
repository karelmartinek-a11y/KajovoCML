import { describe, expect, it } from "vitest";
import { evaluateDashboardPortCompatibility, type DashboardPort } from "./dashboard-topology.js";

function port(overrides: Partial<DashboardPort> = {}): DashboardPort {
  return {
    key: "pulse:00000000-0000-0000-0000-000000000001",
    componentId: "00000000-0000-0000-0000-000000000010",
    revisionId: "00000000-0000-0000-0000-000000000020",
    direction: "OUTGOING",
    kind: "PULSE",
    label: "Objednávka",
    pulseType: "ORDER_CREATED",
    routes: ["/v1/orders/*"],
    scopes: ["orders.write"],
    protocol: "PULSE",
    transport: "HTTPS",
    authMode: "BEARER",
    requestSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" } } },
    responseSchema: {},
    contractDigest: "sha256:source",
    source: {},
    ...overrides
  };
}

function target(overrides: Partial<DashboardPort> = {}): DashboardPort {
  return port({
    key: "pulse:00000000-0000-0000-0000-000000000002",
    componentId: "00000000-0000-0000-0000-000000000011",
    revisionId: "00000000-0000-0000-0000-000000000021",
    direction: "INCOMING",
    routes: ["/v1/orders/create"],
    contractDigest: "sha256:target",
    ...overrides
  });
}

describe("Dashboard PULSE compatibility evaluator", () => {
  it("returns an exact match for equivalent contracts", () => {
    const result = evaluateDashboardPortCompatibility(port(), target());
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.checks.every((check) => check.result === "PASS")).toBe(true);
  });

  it("keeps compatible schema differences visible as warnings", () => {
    const result = evaluateDashboardPortCompatibility(port(), target({
      requestSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" }, note: { type: "string" } } }
    }));
    expect(result.status).toBe("COMPATIBLE_WITH_DIFFERENCES");
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "requestSchemaShape", result: "WARN" }));
  });

  it("fails incompatible PULSE type, route, scope and schema root", () => {
    const result = evaluateDashboardPortCompatibility(port(), target({
      pulseType: "PAYMENT_CAPTURED",
      routes: ["/v1/payments"],
      scopes: ["payments.write"],
      requestSchema: { type: "array", items: { type: "string" } }
    }));
    expect(result.status).toBe("INCOMPATIBLE");
    expect(result.checks.filter((check) => check.result === "FAIL").map((check) => check.field))
      .toEqual(expect.arrayContaining(["pulseType", "route", "scope", "requestSchema"]));
  });

  it("returns UNKNOWN when route and scope evidence are absent", () => {
    const result = evaluateDashboardPortCompatibility(port({ routes: [], scopes: [] }), target({ routes: [], scopes: [] }));
    expect(result.status).toBe("UNKNOWN");
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "route", result: "UNKNOWN" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "scope", result: "UNKNOWN" }));
  });

  it("produces stable evidence for identical inputs", () => {
    const first = evaluateDashboardPortCompatibility(port(), target());
    const second = evaluateDashboardPortCompatibility(port(), target());
    expect(first.evidenceDigest).toBe(second.evidenceDigest);
    expect(first.evaluatorVersion).toBe(second.evaluatorVersion);
  });
});
