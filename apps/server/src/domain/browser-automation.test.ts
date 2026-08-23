import { describe, expect, it } from "vitest";
import { browserAutomationCanonicalJson, browserAutomationDigest, validateBrowserAutomationManifest } from "./browser-automation.js";

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
});
