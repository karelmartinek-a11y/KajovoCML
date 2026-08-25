import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, componentManifestDigest, validateComponentManifest } from "./component.js";
import { KCML_RELEASE } from "./release.js";

const example = JSON.parse(readFileSync(new URL(`../../../../docs/onboarding-manifest-${KCML_RELEASE.manifestSchemaVersion}.example.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const manifest = (overrides: Record<string, unknown> = {}) => ({ ...structuredClone(example), ...overrides });

describe(`generic component manifest ${KCML_RELEASE.catalogVersion}`, () => {
  it("validates embedded fixtures, arbitrary kind and 0..N tools", () => {
    const parsed = validateComponentManifest(manifest());
    expect(parsed.kind).toBe("inventory-api");
    expect(parsed.tools).toHaveLength(1);
    expect(componentManifestDigest(parsed)).toHaveLength(64);
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');

    const withoutTools = manifest({ tools: [] });
    expect(validateComponentManifest(withoutTools).tools).toEqual([]);
  });

  it("normalizes an exact duplicate embedded fixture without weakening conflicting fixtures", () => {
    const duplicate = structuredClone(example.e2eScenarios as Array<Record<string, unknown>>)[0]!;
    const parsed = validateComponentManifest({
      ...manifest(),
      e2eScenarios: [...structuredClone(example.e2eScenarios as Array<Record<string, unknown>>), duplicate]
    });
    expect(parsed.e2eScenarios).toHaveLength((example.e2eScenarios as unknown[]).length);

    const conflicting = structuredClone(duplicate);
    conflicting.timeoutMs = Number(conflicting.timeoutMs) + 1;
    expect(() => validateComponentManifest({
      ...manifest(),
      e2eScenarios: [...structuredClone(example.e2eScenarios as Array<Record<string, unknown>>), conflicting]
    })).toThrow("duplicate_e2e_fixture_conflict");
  });

  it("rejects client-supplied KCML identity", () => {
    expect(() => validateComponentManifest({ ...manifest(), hostname: "kcml9999.kajovocml.hcasc.cz" })).toThrow("invalid_manifest");
  });

  it("rejects missing embedded documentation content", () => {
    const invalid = manifest();
    (invalid.documentationEvidence as Array<Record<string, unknown>>)[0]!.content = {};
    expect(() => validateComponentManifest(invalid)).toThrow();
  });

  it("rejects fake artifact and runtime digests", () => {
    const invalid = manifest({
      artifact: { ...(example.artifact as Record<string, unknown>), digest: `sha256:${"0".repeat(64)}` }
    });
    expect(() => validateComponentManifest(invalid)).toThrow("integrity_digest_invalid");
  });

  it("rejects older schema versions", () => {
    expect(() => validateComponentManifest(manifest({ schemaVersion: "2026.07.24" }))).toThrow("invalid_manifest");
  });
});
