// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./dashboard-page.js";
import {
  loadDashboardDeregistrationPreview,
  loadDashboardTopology,
  previewBulkDashboardSecret,
  saveDashboardLayout,
  setDashboardNodeSuspension
} from "./server-api.js";
import type { DashboardTopology } from "./types.js";

vi.mock("./server-api.js", () => ({
  auditDashboardSecretRevealEvent: vi.fn().mockResolvedValue(undefined),
  bulkGrantDashboardSecret: vi.fn().mockResolvedValue({ targetCount: 2, skippedCount: 0, results: [] }),
  createDashboardConnection: vi.fn().mockResolvedValue(undefined),
  createDashboardSecretRevealGrant: vi.fn(),
  deregisterDashboardNode: vi.fn(),
  disconnectDashboardConnection: vi.fn().mockResolvedValue(undefined),
  grantDashboardSecret: vi.fn().mockResolvedValue(undefined),
  loadDashboardDeregistrationPreview: vi.fn(),
  loadDashboardTopology: vi.fn(),
  previewBulkDashboardSecret: vi.fn().mockResolvedValue({ secretId: "00000000-0000-0000-0000-000000000151", stableName: "OPENAI_API_KEY", secretStatus: "ACTIVE", eligibleCount: 2, alreadyGrantedCount: 1, createCount: 1, eligible: [], skipped: [] }),
  previewDashboardConnection: vi.fn(),
  revealDashboardSecret: vi.fn(),
  revokeDashboardSecret: vi.fn().mockResolvedValue(undefined),
  runDashboardComponentE2E: vi.fn().mockResolvedValue(undefined),
  runDashboardComponentHeartbeatChallenge: vi.fn().mockResolvedValue(undefined),
  runDashboardComponentStateQuery: vi.fn().mockResolvedValue(undefined),
  saveDashboardLayout: vi.fn().mockResolvedValue({ lock_version: 2 }),
  setDashboardComponentEnabled: vi.fn().mockResolvedValue(undefined),
  setDashboardComponentLifecycle: vi.fn().mockResolvedValue(undefined),
  setDashboardConnectionAuthorization: vi.fn().mockResolvedValue(undefined),
  setDashboardNodeSuspension: vi.fn().mockResolvedValue(undefined)
}));

class EventSourceStub {
  static latest: EventSourceStub | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: Event) => void>>();
  close = vi.fn();
  constructor() { EventSourceStub.latest = this; }
  addEventListener = vi.fn((type: string, listener: EventListener) => {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  });
  emit(type: string, data = "") {
    const event = type === "runtime" ? new MessageEvent(type, { data }) : new Event(type);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const topology: DashboardTopology = {
  generatedAt: "2026-07-24T12:00:00.000Z",
  live: { source: "persisted_component_operation_event", connected: true, lastEventAt: null, stale: false },
  workspace: { id: "00000000-0000-0000-0000-000000000100", viewport: { x: 0, y: 0, zoom: 1 }, lockVersion: 1 },
  nodes: [
    {
      id: "00000000-0000-0000-0000-000000000101", lifecyclePhase: "PRE_REGISTRATION", label: "Nový MCP", integrationTokenId: "00000000-0000-0000-0000-000000000111",
      componentId: null, principalId: null, code: null, displayName: "Nový MCP", description: "", category: "PŘEDREGISTRAČNÍ", role: null,
      lifecycleState: "ČEKÁ_NA_ONBOARDING", activationState: "INACTIVE", operationalState: "NOT_REGISTERED", monitoringState: "NOT_CONFIGURED", recertificationState: "NOT_DUE",
      enabled: false, runtimeAvailable: false, identityUnavailable: false, suspended: false, suspensionReason: null, tokenFingerprint: "sha256:token", tokenLastUsedAt: null,
      integrationTokenExpiresAt: "2026-07-25T12:00:00.000Z", critical: false, position: { x: 50, y: 50 }, secrets: [],
      statistics: { period: "24h", callCount: 0, successCount: 0, failureCount: 0, errorRate: 0, lastRunAt: null, lastFailureAt: null }
    },
    {
      id: "00000000-0000-0000-0000-000000000102", lifecyclePhase: "REGISTERED", label: "KCML0001", integrationTokenId: "00000000-0000-0000-0000-000000000112",
      componentId: "00000000-0000-0000-0000-000000000121", principalId: "00000000-0000-0000-0000-000000000131", code: "KCML0001", displayName: "Zdroj",
      description: "Zdrojová komponenta", category: "MCP_SERVER", role: "SERVICE", lifecycleState: "ACTIVE", activationState: "ACTIVE", operationalState: "HEALTHY",
      monitoringState: "HEALTHY", recertificationState: "NOT_DUE", enabled: true, runtimeAvailable: true, identityUnavailable: false, suspended: false, suspensionReason: null,
      tokenFingerprint: "sha256:source", tokenLastUsedAt: null, integrationTokenExpiresAt: null, critical: false, position: { x: 420, y: 80 },
      secrets: [{ secretId: "00000000-0000-0000-0000-000000000151", stableName: "OPENAI_API_KEY", status: "ACTIVE", source: "DIRECT" }],
      statistics: { period: "24h", callCount: 4, successCount: 4, failureCount: 0, errorRate: 0, lastRunAt: "2026-07-24T11:58:00.000Z", lastFailureAt: null }
    },
    {
      id: "00000000-0000-0000-0000-000000000103", lifecyclePhase: "REGISTERED", label: "KCML0002", integrationTokenId: null,
      componentId: "00000000-0000-0000-0000-000000000122", principalId: "00000000-0000-0000-0000-000000000132", code: "KCML0002", displayName: "Cíl",
      description: "Cílová komponenta", category: "AI_AGENT", role: "AGENT", lifecycleState: "ACTIVE", activationState: "ACTIVE", operationalState: "HEALTHY",
      monitoringState: "HEALTHY", recertificationState: "NOT_DUE", enabled: true, runtimeAvailable: true, identityUnavailable: false, suspended: false, suspensionReason: null,
      tokenFingerprint: "sha256:target", tokenLastUsedAt: null, integrationTokenExpiresAt: null, critical: false, position: { x: 820, y: 80 }, secrets: [],
      statistics: { period: "24h", callCount: 2, successCount: 2, failureCount: 0, errorRate: 0, lastRunAt: "2026-07-24T11:59:00.000Z", lastFailureAt: null }
    }
  ],
  ports: [
    { key: "pulse:out", componentId: "00000000-0000-0000-0000-000000000121", revisionId: "00000000-0000-0000-0000-000000000141", direction: "OUTGOING", kind: "PULSE", label: "ORDER", pulseType: "ORDER", routes: ["/v1/order"], scopes: ["order.write"], protocol: "PULSE", transport: "HTTPS", authMode: "BEARER", requestSchema: { type: "object" }, responseSchema: {}, contractDigest: "sha256:out", source: {} },
    { key: "pulse:in", componentId: "00000000-0000-0000-0000-000000000122", revisionId: "00000000-0000-0000-0000-000000000142", direction: "INCOMING", kind: "PULSE", label: "ORDER", pulseType: "ORDER", routes: ["/v1/order"], scopes: ["order.write"], protocol: "PULSE", transport: "HTTPS", authMode: "BEARER", requestSchema: { type: "object" }, responseSchema: {}, contractDigest: "sha256:in", source: {} }
  ],
  edges: [{
    id: "00000000-0000-0000-0000-000000000161", sourceComponentId: "00000000-0000-0000-0000-000000000121", sourcePortKey: "pulse:out",
    targetComponentId: "00000000-0000-0000-0000-000000000122", targetPortKey: "pulse:in", route: "/v1/order", scope: "order.write", audience: "https://kcml0002.example.test",
    compatibilityStatus: "EXACT_MATCH", compatibilityEvidence: { checks: [] }, authorizationDesired: false, effectiveAuthorization: "DENIED", authorizationReason: "EDGE_PERMISSION_REVOKED",
    sourceCode: "KCML0001", targetCode: "KCML0002", createdAt: "2026-07-24T11:00:00.000Z", correlationId: "00000000-0000-0000-0000-000000000171"
  }],
  externalNodes: [{ id: "00000000-0000-0000-0000-000000000181", targetKey: "OPENAI", displayName: "OpenAI API", baseUrl: "https://api.openai.com", status: "ACTIVE", circuitState: "CLOSED", circuitFailureCount: 0, circuitFailureThreshold: 5, allowedPathPrefixes: ["/v1/"], auditRequired: true, position: { x: 1180, y: 120 }, statistics: { period: "24h", callCount: 3, successCount: 3, failureCount: 0, blockedCount: 0, errorRate: 0, lastRunAt: "2026-07-24T11:59:30.000Z", lastFailureAt: null } }],
  externalEdges: [{ id: "00000000-0000-0000-0000-000000000182", sourceComponentId: "00000000-0000-0000-0000-000000000121", externalTargetId: "00000000-0000-0000-0000-000000000181", route: "/v1/responses", scope: "ai.invoke", audience: "https://api.openai.com", effectiveAuthorization: "GRANTED", authorizationReason: "PERMISSION_ACTIVE", sourceCode: "KCML0001", targetKey: "OPENAI", targetDisplayName: "OpenAI API", targetStatus: "ACTIVE", circuitState: "CLOSED", createdAt: "2026-07-24T11:00:00.000Z" }],
  activeProcesses: [],
  secrets: [{ id: "00000000-0000-0000-0000-000000000151", stableName: "OPENAI_API_KEY", displayName: "OpenAI", description: "Přístup pro AI", ownerKind: "SYSTEM", ownerId: null, status: "ACTIVE", version: 1, fingerprint: "sha256:secret", expiresAt: null, grantCount: 1, lockVersion: 1, deletedAt: null }],
  alarms: [],
  events: []
};

beforeEach(() => {
  vi.mocked(loadDashboardTopology).mockResolvedValue(structuredClone(topology));
  vi.mocked(saveDashboardLayout).mockResolvedValue({ lock_version: 2 });
  vi.mocked(previewBulkDashboardSecret).mockResolvedValue({ secretId: topology.secrets[0]!.id, stableName: "OPENAI_API_KEY", secretStatus: "ACTIVE", eligibleCount: 2, alreadyGrantedCount: 1, createCount: 1, eligible: [], skipped: [] });
  vi.mocked(loadDashboardDeregistrationPreview).mockResolvedValue({
    node_id: topology.nodes[1]!.id, component_id: topology.nodes[1]!.componentId!, code: "KCML0001", display_name: "Zdroj",
    token_count: 1, direct_secret_grant_count: 1, transferred_secret_grant_count: 0, connection_count: 1,
    requiresMfa: true, typedConfirmation: "KCML0001", requiresCompleteOnboarding: true
  });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: EventSourceStub });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Aktivní Dashboard", () => {
  it("odlišuje předregistrační node, kompatibilitu portu a neautorizované vlákno", async () => {
    const { container } = render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Aktivní Dashboard" })).toBeTruthy();
    expect(screen.getAllByText("Čeká na onboarding").length).toBeGreaterThan(0);
    expect(screen.getByText("Provozní akce jsou neaktivní do dokončení onboardingu.")).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".dashboard-port.compatible").length).toBe(2));
    expect(container.querySelector(".dashboard-edge.denied")).toBeTruthy();
  });

  it("zobrazuje autoritativní detail portu včetně schématu, route a digestu", async () => {
    render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    const port = await screen.findByRole("button", { name: /Odchozí konektor.*ORDER/ });
    fireEvent.click(port);
    expect(screen.getByRole("heading", { name: /Odchozí konektor: ORDER/ })).toBeTruthy();
    expect(screen.getByText("/v1/order")).toBeTruthy();
    expect(screen.getByText("order.write")).toBeTruthy();
    expect(screen.getByText("sha256:out")).toBeTruthy();
    expect(screen.getByText("Požadované schéma")).toBeTruthy();
    expect(screen.getByText(/"type": "object"/)).toBeTruthy();
  });

  it("nabízí oprávnění a rozpojení jako dvě oddělené operace", async () => {
    render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    const edge = await screen.findByRole("button", { name: /KCML0001 do KCML0002/ });
    fireEvent.click(edge);
    expect(screen.getByRole("button", { name: /Udělit oprávnění/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rozpojit/ })).toBeTruthy();
  });

  it("animuje pouze skutečnou SSE událost a zobrazí korelovaný proces", async () => {
    const { container } = render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    await screen.findByRole("heading", { name: "Aktivní Dashboard" });
    EventSourceStub.latest?.emit("ready");
    EventSourceStub.latest?.emit("runtime", JSON.stringify({
      id: "00000000-0000-0000-0000-000000000191",
      kind: "PULSE",
      componentId: "00000000-0000-0000-0000-000000000121",
      componentCode: "KCML0001",
      targetComponentId: "00000000-0000-0000-0000-000000000122",
      externalTargetId: null,
      externalTargetKey: null,
      pulseType: "ORDER",
      direction: "OUTGOING",
      operationKey: "orders.dispatch",
      subsystem: "PULSE",
      severity: "INFO",
      stage: "STARTED",
      status: "RUNNING",
      success: true,
      route: "/v1/order",
      scope: "order.write",
      audience: "https://kcml0002.example.test",
      durationMs: null,
      correlationId: "00000000-0000-0000-0000-000000000192",
      traceId: null,
      occurredAt: "2026-07-24T12:00:01.000Z",
      receivedAt: "2026-07-24T12:00:01.100Z",
      evidence: {}
    }));
    await waitFor(() => expect(container.querySelector(".dashboard-edge.runtime-active")).toBeTruthy());
    expect(screen.getByText("orders.dispatch")).toBeTruthy();
    expect(screen.getByText("Probíhá korelovaná operace")).toBeTruthy();
  });

  it("ukončí běžící impuls finální událostí stejné korelace", async () => {
    const { container } = render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    await screen.findByRole("heading", { name: "Aktivní Dashboard" });
    EventSourceStub.latest?.emit("ready");
    const base = {
      kind: "PULSE", componentId: topology.nodes[1]!.componentId, componentCode: "KCML0001", targetComponentId: topology.nodes[2]!.componentId,
      externalTargetId: null, externalTargetKey: null, pulseType: "ORDER", direction: "OUTGOING", operationKey: "orders.dispatch", subsystem: "PULSE",
      route: "/v1/order", scope: "order.write", audience: "https://kcml0002.example.test", correlationId: "00000000-0000-0000-0000-000000000199", traceId: null,
      occurredAt: "2026-07-24T12:00:01.000Z", receivedAt: "2026-07-24T12:00:01.100Z", evidence: {}
    };
    EventSourceStub.latest?.emit("runtime", JSON.stringify({ ...base, id: "00000000-0000-0000-0000-000000000191", stage: "STARTED", status: "RUNNING", success: true, severity: "INFO", durationMs: null }));
    await waitFor(() => expect(container.querySelector(".dashboard-edge.runtime-active")).toBeTruthy());
    EventSourceStub.latest?.emit("runtime", JSON.stringify({ ...base, id: "00000000-0000-0000-0000-000000000193", stage: "COMPLETED", status: "SUCCEEDED", success: true, severity: "INFO", durationMs: 120 }));
    await waitFor(() => expect(container.querySelector(".dashboard-edge.runtime-active")).toBeFalsy());
    expect(container.querySelector(".dashboard-edge.runtime-success")).toBeTruthy();
  });

  it("zobrazuje externí boundary node a jeho skutečné oprávnění", async () => {
    render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    expect(await screen.findByText("OpenAI API")).toBeTruthy();
    fireEvent.click(screen.getByText("OpenAI API").closest("article")!);
    expect(screen.getByText("Jistič CLOSED")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Přesná správa externích stran/ })).toBeTruthy();
  });


  it("používá přístupný dialog pro suspendaci namísto browser promptu", async () => {
    render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    const code = await screen.findByText("KCML0001");
    fireEvent.click(code.closest("article")!);
    fireEvent.click(screen.getByRole("button", { name: /Suspendovat oprávnění/ }));
    expect(screen.getByRole("dialog", { name: /Suspendovat oprávnění KCML0001/ })).toBeTruthy();
    const reason = screen.getByLabelText("Důvod suspendace");
    fireEvent.change(reason, { target: { value: "Bezpečnostní prověření komponenty." } });
    fireEvent.click(screen.getByRole("button", { name: "Suspendovat identitu" }));
    await waitFor(() => expect(vi.mocked(setDashboardNodeSuspension)).toHaveBeenCalledWith(topology.nodes[1]!.id, true, "Bezpečnostní prověření komponenty."));
  });

  it("zobrazuje impact preview před destruktivní odregistrací", async () => {
    render(<DashboardPage releaseInfo={null} onOpenStandardPage={vi.fn()} />);
    const code = await screen.findByText("KCML0001");
    fireEvent.click(code.closest("article")!);
    fireEvent.click(screen.getByRole("button", { name: /Smazat prvek a registraci/ }));
    expect(await screen.findByRole("heading", { name: "Smazat prvek a registraci" })).toBeTruthy();
    expect(screen.getByText("aktivních tokenů")).toBeTruthy();
    expect(screen.getByText("PULSE spojení")).toBeTruthy();
    expect(screen.getByText(/kompletní nový onboarding/)).toBeTruthy();
  });
});
