import { describe, expect, it, vi } from "vitest";
import { sendError } from "./errors.js";

describe("HTTP error boundary", () => {
  it("preserves stable machine codes and rejects arbitrary exception text", () => {
    const send = vi.fn();
    const reply = { code: vi.fn(() => ({ send })) } as never;
    sendError(reply, 409, "config_version_conflict", undefined, "correlation-id");
    expect(send).toHaveBeenLastCalledWith({ error: "config_version_conflict", message: "config_version_conflict", correlationId: "correlation-id" });

    sendError(reply, 500, "password=secret connection failed", undefined, "correlation-id");
    expect(send).toHaveBeenLastCalledWith({ error: "internal_error", message: "internal_error", correlationId: "correlation-id" });
  });
});
