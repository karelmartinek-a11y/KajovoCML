// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

class EventSourceStub {
  static latest: EventSourceStub | null = null;
  readonly url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly close = vi.fn();
  constructor(url: string) { this.url = url; EventSourceStub.latest = this; }
}
Object.defineProperty(globalThis, "EventSource", { configurable: true, value: EventSourceStub });

vi.mock("./ui-helpers.js", () => ({
  api: vi.fn(async (url: string) => {
    if (url === "/api/generation/setup") return { openAiReady: true, model: "gpt-5" };
    if (url === "/api/generation/jobs") return { jobs: [{ id: "job-1", originalPrompt: "Vytvoř capability", state: "DISCUSSING", events: [], components: [], inputs: [], createdAt: "now", updatedAt: "now", completedAt: null, eventCursor: 7, jobKind: "CREATE", parentJobId: null, runSequence: 1, operatorPrompt: null, plan: null, resultSummary: null, blockerSummary: null, remediationAttempts: 0 }] };
    if (url === "/api/generation/jobs/job-1/messages") return { messages: [] };
    if (url === "/api/generation/jobs/job-1/spec") return { spec: null };
    throw new Error(`unexpected:${url}`);
  }),
  csrf: () => "csrf",
  formatDate: (value: string) => value,
  prettyJson: (value: unknown) => JSON.stringify(value)
}));

import { GenerationPage } from "./generation-page.js";

afterEach(() => cleanup());

describe("OWNER generation UI", () => {
  it("presents one human prompt and no retired programmer handoff", async () => {
    render(<GenerationPage />);
    expect(await screen.findByRole("heading", { name: "Co mám vytvořit?" })).toBeTruthy();
    expect(screen.getByLabelText("Zadání generování")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Začít persistentní diskusi/ })).toBeTruthy();
    expect(screen.queryByText(/integrační token/i)).toBeNull();
    expect(screen.queryByText(/programátor/i)).toBeNull();
  });

  it("subscribes to the canonical named discussion SSE taxonomy", async () => {
    render(<GenerationPage />);
    await screen.findByText("OWNER ↔ AI diskuse");
    const names = (EventSourceStub.latest?.addEventListener.mock.calls ?? []).map((call: unknown[]) => String(call[0]));
    expect(names).toContain("discussion.message.delta");
    expect(names).toContain("spec.revision.created");
    expect(names).toContain("generation.resync.required");
    expect(EventSourceStub.latest?.url).toContain("after=7");
  });
});
