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
    responseSchema: { type: "object", properties: { accepted: { type: "boolean" } }, required: ["accepted"] },
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
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "requestSchemaDigest", result: "WARN" }));
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
      .toEqual(expect.arrayContaining(["pulseType", "route", "scope", "requestSchema:$:type"]));
  });

  it("fails when the producer does not guarantee a required target field", () => {
    const result = evaluateDashboardPortCompatibility(port({
      requestSchema: { type: "object", properties: { orderId: { type: "string" } }, required: [] }
    }), target());
    expect(result.status).toBe("INCOMPATIBLE");
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "requestSchema:$.orderId:required", result: "FAIL" }));
  });

  it("fails when producer enum or limits exceed the consumer contract", () => {
    const result = evaluateDashboardPortCompatibility(port({
      requestSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string", enum: ["A", "B"], maxLength: 20 } } }
    }), target({
      requestSchema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string", enum: ["A"], maxLength: 10 } } }
    }));
    expect(result.status).toBe("INCOMPATIBLE");
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "requestSchema:$.orderId:enum", result: "FAIL" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ field: "requestSchema:$.orderId:maxLength", result: "FAIL" }));
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

describe("Dashboard runtime event normalization", () => {
  it("maps an active lease to a STARTED PULSE event with target evidence", async () => {
    const { dashboardRuntimeEventFromLeaseRow } = await import("./dashboard-topology.js");
    const event = dashboardRuntimeEventFromLeaseRow({
      id: "00000000-0000-0000-0000-000000000301",
      target_component_id: "00000000-0000-0000-0000-000000000302",
      code: "KCML0001",
      operation_kind: "PULSE",
      operation_name: "ORDER",
      process_trace: { direction: "OUTGOING", targetComponentId: "00000000-0000-0000-0000-000000000303", route: "/v1/order", scope: "order.write" },
      started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
      correlation_id: "00000000-0000-0000-0000-000000000304", trace_id: null
    });
    expect(event.stage).toBe("STARTED");
    expect(event.kind).toBe("PULSE");
    expect(event.targetComponentId).toBe("00000000-0000-0000-0000-000000000303");
    expect(event.route).toBe("/v1/order");
  });

  it("distinguishes blocked external calls from transport failures", async () => {
    const { dashboardRuntimeEventFromExternalRow } = await import("./dashboard-topology.js");
    const blocked = dashboardRuntimeEventFromExternalRow({
      id: "00000000-0000-0000-0000-000000000311", source_component_id: "00000000-0000-0000-0000-000000000312", code: "KCML0001",
      external_target_id: "00000000-0000-0000-0000-000000000313", target_key: "OPENAI", base_url: "https://api.openai.com",
      route_path: "/v1/responses", scope_name: "ai.invoke", status: "BLOCKED", http_status: null, error_code: "permission_denied",
      attempt_count: 0, correlation_id: "00000000-0000-0000-0000-000000000314", created_at: "2026-07-24T12:00:00.000Z", completed_at: "2026-07-24T12:00:00.010Z"
    });
    expect(blocked.stage).toBe("BLOCKED");
    expect(blocked.severity).toBe("WARNING");
    expect(blocked.success).toBe(false);
  });
});
