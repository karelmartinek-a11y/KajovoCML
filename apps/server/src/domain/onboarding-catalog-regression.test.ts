import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../");
const onboardingCatalogDir = path.join(repoRoot, "docs/onboarding-catalogs");
const allowedCatalogs = new Set(["external-api-1.0.json", "onboarding-1.1.json", "repository-component-1.1.json"]);
const forbiddenNeedles = [
  ["docs/onboarding-catalogs", "component-2026.07.22-compliance.1.json"].join("/"),
  ["component", "2026.07.22-compliance.1.json"].join("-"),
  ["docs/onboarding-catalogs", "repository-component-1.0.json"].join("/"),
  ["repository", "component", "1.0.json"].join("-")
];

function walkFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "dist" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

describe("onboarding catalog regression guard", () => {
  it("keeps only the canonical onboarding and repository source catalogs", () => {
    const files = readdirSync(onboardingCatalogDir).filter((file) => !file.startsWith("._")).sort();
    expect(files).toEqual([...allowedCatalogs].sort());
  });

  it("does not keep removed historical onboarding catalog files on disk", () => {
    expect(existsSync(path.join(onboardingCatalogDir, "component-2026.07.22-compliance.1.json"))).toBe(false);
    expect(existsSync(path.join(onboardingCatalogDir, "repository-component-1.0.json"))).toBe(false);
  });

  it("does not reference removed catalog paths elsewhere in the repository", () => {
    const offenders: string[] = [];
    for (const file of walkFiles(repoRoot)) {
      const relative = path.relative(repoRoot, file);
      if (relative === "apps/server/src/domain/onboarding-catalog-regression.test.ts") continue;
      if (!/\.(md|json|mjs|ts|tsx|yaml|yml|sh)$/.test(relative)) continue;
      const content = readFileSync(file, "utf8");
      if (forbiddenNeedles.some((needle) => content.includes(needle))) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the canonical onboarding catalog deterministic on disk", () => {
    const onboardingCatalog = path.join(onboardingCatalogDir, "onboarding-1.1.json");
    expect(statSync(onboardingCatalog).isFile()).toBe(true);
    const parsed = JSON.parse(readFileSync(onboardingCatalog, "utf8")) as { version?: string; canonicalDigest?: string };
    expect(parsed.version).toBe("1.1");
    expect(typeof parsed.canonicalDigest).toBe("string");
  });
});
