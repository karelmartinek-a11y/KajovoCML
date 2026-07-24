// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisteredElementsPage } from "./registered-elements-page.js";
import { loadDashboardTopology } from "./server-api.js";

vi.mock("./server-api.js", () => ({ loadDashboardTopology: vi.fn() }));
class EventSourceStub { addEventListener = vi.fn(); close = vi.fn(); }
Object.defineProperty(globalThis, "EventSource", { configurable: true, value: EventSourceStub });

afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Registrované prvky", () => {
  it("zobrazuje přesný prázdný stav", async () => {
    vi.mocked(loadDashboardTopology).mockResolvedValue({ generatedAt: "2026-07-24T00:00:00Z", live: { source: "db", connected: true, lastEventAt: null, stale: false }, workspace: { id: "1", viewport: { x: 0, y: 0, zoom: 1 }, lockVersion: 0 }, nodes: [], ports: [], edges: [], secrets: [], alarms: [], events: [] });
    render(<RegisteredElementsPage onOpenPage={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Registrované prvky" })).toBeTruthy();
    expect(await screen.findByText("Žádný registrovaný prvek není dostupný.")).toBeTruthy();
  });
});
