import { describe, expect, it } from "vitest";
import { browserAutomationCanonicalJson, browserAutomationDigest, finalStatusForAutomationError, validateBrowserAutomationManifest } from "./browser-automation.js";

const manifest = {
  schemaVersion: "kcml.browser-automation.v1",
  steps: [{ action: "NAVIGATE", url: "https://example.com" }, { action: "ASSERT_TEXT", text: "Example Domain" }]
} as const;

describe("canonical browser automation runtime boundary", () => {
  it("accepts only the declarative manifest DSL and produces a stable digest", () => {
    const validated = validateBrowserAutomationManifest(manifest);
    expect(validated.steps).toHaveLength(2);
    expect(browserAutomationDigest(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(browserAutomationCanonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it.each([
    { schemaVersion: "legacy", steps: manifest.steps },
    { schemaVersion: "kcml.browser-automation.v1", steps: [] },
    { schemaVersion: "kcml.browser-automation.v1", steps: [{ action: "EVAL", source: "document.body" }] }
  ])("rejects a non-declarative manifest: %o", (candidate) => {
    expect(() => validateBrowserAutomationManifest(candidate)).toThrow();
  });

  it("never puts a secret-bearing field in the runtime contract", () => {
    const candidate = { ...manifest, secret: "should-not-be-a-runtime-input" };
    const serialized = browserAutomationCanonicalJson(candidate);
    expect(serialized).not.toMatch(/OPENAI_API_KEY|encrypted_value|authorization/i);
  });

  it.each([
    ["automation_uncertain_side_effect", false, "MANUAL_REVIEW"],
    ["automation_human_challenge_required", false, "CHALLENGE_REQUIRED"],
    ["automation_contract_drift", false, "DRIFT"],
    ["automation_reauthentication_required", false, "REAUTH_REQUIRED"],
    ["automation_cancelled", true, "CANCELLED"],
    ["automation_step_failed", false, "FAILED"]
  ])("maps runtime error %s to a fail-closed durable run status", (errorCode, cancelled, expected) => {
    expect(finalStatusForAutomationError(errorCode, cancelled)).toBe(expected);
  });
});
