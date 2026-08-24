import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { GenerationWorkerConfig } from "../config.js";

export async function prepareGenerationWorkspace(config: GenerationWorkerConfig, jobId: string, reservations: unknown): Promise<{ workspace: string; revisionPoint: string }> {
  const workspace = path.join(config.GENERATION_ROOT, "jobs", jobId);
  await mkdir(workspace, { recursive: true, mode: 0o750 });
  await mkdir(path.join(workspace, "docs"), { recursive: true, mode: 0o750 });
  const sourceRoot = path.resolve(config.GENERATION_SOURCE_ROOT);
  const ssotSource = path.join(sourceRoot, "docs", "SSOT_CURRENT.md");
  const schemaSource = path.join(sourceRoot, "apps", "server", "src", "contracts", "component-manifest-2026.07.22-compliance.1.schema.json");
  const manifestExampleSource = path.join(sourceRoot, "docs", "onboarding-manifest-2026.07.22-compliance.1.example.json");
  const runtimeSource = path.join(sourceRoot, "apps", "server", "src", "generation", "runtime-host.mjs");
  await cp(ssotSource, path.join(workspace, "docs", "SSOT_CURRENT.md"), { recursive: false, force: true });
  await cp(schemaSource, path.join(workspace, "component-manifest.schema.json"), { force: true });
  await cp(manifestExampleSource, path.join(workspace, "component-manifest.example.json"), { force: true });
  await cp(runtimeSource, path.join(workspace, "runtime-host.reference.mjs"), { force: true });
  const reservationsText = JSON.stringify(reservations, null, 2);
  await writeFile(path.join(workspace, "component-reservations.json"), reservationsText, "utf8");
  const [ssot, schema, manifestExample, runtime] = await Promise.all([readFile(ssotSource), readFile(schemaSource), readFile(manifestExampleSource), readFile(runtimeSource)]);
  const snapshot = {
    format: 1,
    sourceRoot,
    ssotDigest: `sha256:${createHash("sha256").update(ssot).digest("hex")}`,
    componentSchemaDigest: `sha256:${createHash("sha256").update(schema).digest("hex")}`,
    componentManifestExampleDigest: `sha256:${createHash("sha256").update(manifestExample).digest("hex")}`,
    runtimeHostDigest: `sha256:${createHash("sha256").update(runtime).digest("hex")}`,
    reservationsDigest: `sha256:${createHash("sha256").update(reservationsText).digest("hex")}`
  };
  const snapshotText = JSON.stringify(snapshot, null, 2);
  const revisionPoint = `sha256:${createHash("sha256").update(snapshotText).digest("hex")}`;
  await writeFile(path.join(workspace, "revision-point.json"), `${snapshotText}\n`, "utf8");
  return { workspace, revisionPoint };
}
