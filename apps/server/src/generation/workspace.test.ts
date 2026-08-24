import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GenerationWorkerConfig } from "../config.js";
import { prepareGenerationWorkspace } from "./workspace.js";

describe("generation workspace canonical references", () => {
  it("copies the current manifest schema and valid example into the immutable revision point", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kcml-generation-source-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "kcml-generation-workspace-"));
    try {
      await mkdir(path.join(root, "docs"), { recursive: true });
      await mkdir(path.join(root, "apps", "server", "src", "contracts"), { recursive: true });
      await mkdir(path.join(root, "apps", "server", "src", "generation"), { recursive: true });
      await writeFile(path.join(root, "docs", "SSOT_CURRENT.md"), "ssot\n");
      await writeFile(path.join(root, "docs", "onboarding-manifest-2026.07.22-compliance.1.example.json"), '{"schemaVersion":"2026.07.22-compliance.1"}\n');
      await writeFile(path.join(root, "apps", "server", "src", "contracts", "component-manifest-2026.07.22-compliance.1.schema.json"), '{"type":"object"}\n');
      await writeFile(path.join(root, "apps", "server", "src", "generation", "runtime-host.mjs"), "export {};\n");
      const config = { GENERATION_ROOT: output, GENERATION_SOURCE_ROOT: root } as GenerationWorkerConfig;

      const prepared = await prepareGenerationWorkspace(config, "job-1", []);
      const example = JSON.parse(await readFile(path.join(prepared.workspace, "component-manifest.example.json"), "utf8")) as Record<string, unknown>;
      const revision = JSON.parse(await readFile(path.join(prepared.workspace, "revision-point.json"), "utf8")) as Record<string, unknown>;

      expect(example.schemaVersion).toBe("2026.07.22-compliance.1");
      expect(revision.componentManifestExampleDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });
});
