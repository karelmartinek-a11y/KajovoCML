import { describe, expect, it } from "vitest";
import { applyMutationCsrfHeader } from "./production-http-contract.js";

describe("production acceptance HTTP contract", () => {
  it("adds the authenticated CSRF token to an ordinary mutation", () => {
    const headers = new Headers();
    applyMutationCsrfHeader(headers, "POST", "canonical-token");
    expect(headers.get("x-csrf-token")).toBe("canonical-token");
  });

  it("preserves an explicitly empty CSRF header so the negative probe reaches the server", () => {
    const headers = new Headers({ "x-csrf-token": "" });
    applyMutationCsrfHeader(headers, "POST", "canonical-token");
    expect(headers.has("x-csrf-token")).toBe(true);
    expect(headers.get("x-csrf-token")).toBe("");
  });

  it("never adds CSRF to a safe read", () => {
    const headers = new Headers();
    applyMutationCsrfHeader(headers, "GET", "canonical-token");
    expect(headers.has("x-csrf-token")).toBe(false);
  });
});
