// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let setupResponse = { openAiReady: true, model: "gpt-5", openAi: { reason: "READY", secretExists: true } };

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
    if (url === "/api/generation/setup") return setupResponse;
    if (url === "/api/generation/jobs") return { jobs: [{ id: "job-1", originalPrompt: "Vytvoř capability", state: "DISCUSSING", events: [], components: [], inputs: [], createdAt: "now", updatedAt: "now", completedAt: null, eventCursor: 7, jobKind: "CREATE", parentJobId: null, runSequence: 1, operatorPrompt: null, plan: null, resultSummary: null, blockerSummary: null, remediationAttempts: 0 }] };
    if (url === "/api/generation/jobs/job-1/messages") return { messages: [] };
    if (url === "/api/generation/jobs/job-1/spec") return { spec: null };
    throw new Error(`unexpected:${url}`);
  }),
  csrf: () => "csrf",
  formatDate: (value: string) => value,
  prettyJson: (value: unknown) => JSON.stringify(value)
}));

import { GenerationPage, reduceDiscussionEvent } from "./generation-page.js";

afterEach(() => cleanup());
beforeEach(() => { setupResponse = { openAiReady: true, model: "gpt-5", openAi: { reason: "READY", secretExists: true } }; });

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
    await waitFor(() => {
      const names = (EventSourceStub.latest?.addEventListener.mock.calls ?? []).map((call: unknown[]) => String(call[0]));
      expect(names).toContain("discussion.message.delta");
      expect(names).toContain("spec.revision.created");
      expect(names).toContain("generation.resync.required");
    });
    expect(EventSourceStub.latest?.url).toContain("after=7");
  });

  it("appends visible text deltas locally and reconciles the terminal message", () => {
    const initial = [{ id: "assistant-1", sequence: 1, role: "ASSISTANT", status: "STREAMING", content: "", createdAt: "now" }];
    const first = reduceDiscussionEvent(initial, { eventId: 1, type: "discussion.message.delta", jobId: "job-1", emittedAt: "now", payload: { messageId: "assistant-1", delta: "Normální " } });
    const second = reduceDiscussionEvent(first.messages, { eventId: 2, type: "discussion.message.delta", jobId: "job-1", emittedAt: "now", payload: { messageId: "assistant-1", delta: "text" } });
    const completed = reduceDiscussionEvent(second.messages, { eventId: 3, type: "discussion.message.completed", jobId: "job-1", emittedAt: "now", payload: { messageId: "assistant-1", content: "Normální text" } });
    expect(completed.messages[0]).toMatchObject({ content: "Normální text", status: "COMPLETED" });
    expect(completed.messages[0]?.content).not.toContain("assistantMessage");
  });

  it("repairs an existing credential grant without asking the OWNER for another API key", async () => {
    setupResponse = { openAiReady: false, model: "gpt-5", openAi: { reason: "PLATFORM_GRANT_MISSING", secretExists: true } };
    render(<GenerationPage />);
    expect(await screen.findByText(/Obnoví se pouze jeho platformní grant/)).toBeTruthy();
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    expect(screen.getByRole("button", { name: /Obnovit přístup existujícího credentialu/ })).toBeTruthy();
  });
});
