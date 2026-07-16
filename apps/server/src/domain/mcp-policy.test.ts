import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "./types.js";
import {
  abortOnTimeout,
  BoundedValidatorCache,
  idempotencyMode,
  invokeWithDeadline
} from "./mcp-policy.js";

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "server-1",
    activeRevisionId: "revision-1",
    contractVersion: "1",
    manifestDigest: "sha256:manifest",
    shutdownPolicy: "CANCEL_SAFE",
    effectClass: "READ_ONLY",
    ...overrides
  } as McpServer;
}

describe("bounded MCP schema cache", () => {
  it("reuses validators and evicts the least recently used entry", () => {
    const cache = new BoundedValidatorCache(2);
    const schemaA = { type: "object", properties: { a: { type: "string" } } };
    const schemaB = { type: "object", properties: { b: { type: "string" } } };
    const schemaC = { type: "object", properties: { c: { type: "string" } } };
    const first = cache.get(server(), "input", schemaA);
    expect(cache.get(server(), "input", schemaA)).toBe(first);
    cache.get(server({ activeRevisionId: "revision-2" }), "input", schemaB);
    cache.get(server({ activeRevisionId: "revision-3" }), "input", schemaC);
    expect(cache.size).toBe(2);
    expect(cache.get(server(), "input", schemaA)).not.toBe(first);
  });

  it("invalidates every schema belonging to a server", () => {
    const cache = new BoundedValidatorCache(4);
    cache.get(server(), "input", { type: "object" });
    cache.get(server({ id: "server-2" }), "input", { type: "object" });
    cache.invalidateServer("server-1");
    expect(cache.size).toBe(1);
  });
});

describe("typed MCP invocation policy", () => {
  it("derives replay behavior without inspecting policy prose", () => {
    expect(idempotencyMode("READ_ONLY")).toBe("NOT_REQUIRED");
    expect(idempotencyMode("IDEMPOTENT_WRITE")).toBe("REPLAY_COMPLETED");
    expect(idempotencyMode("NON_IDEMPOTENT_WRITE")).toBe("REJECT_REPLAY");
  });

  it("only aborts timeout-safe shutdown policies", () => {
    expect(abortOnTimeout("COMPLETE_IN_FLIGHT")).toBe(false);
    expect(abortOnTimeout("CANCEL_SAFE")).toBe(true);
    expect(abortOnTimeout("COMPENSATE")).toBe(true);
  });

  it("clears the deadline timer when the handler fails early", async () => {
    vi.useFakeTimers();
    const signalSpy = vi.fn();
    await expect(invokeWithDeadline(10_000, "CANCEL_SAFE", async (signal) => {
      signal.addEventListener("abort", signalSpy);
      throw new Error("early_failure");
    })).rejects.toThrow("early_failure");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signalSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
