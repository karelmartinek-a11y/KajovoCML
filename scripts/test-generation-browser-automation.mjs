#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBrowserAutomation } from "../apps/server/src/generation/browser-automation-runtime.mjs";

const workspace = await mkdtemp(path.join(os.tmpdir(), "kcml-automation-"));
const fixtureHtml = `<!doctype html><label>Name<input aria-label="Name"></label><label>Choice<select aria-label="Choice"><option value="a">A</option><option value="b">B</option></select></label><label>Upload<input aria-label="Upload" type="file"></label><label>Agree<input aria-label="Agree" type="checkbox"></label><button aria-label="Submit" onclick="document.querySelector('[role=status]').textContent='DONE:'+document.querySelector('[aria-label=Name]').value">Submit</button><a aria-label="Download" download="fixture.txt" href="data:text/plain,downloaded">Download</a><div role="status">IDLE</div>`;
const manifest = { schemaVersion: "kcml.browser-automation.v1", steps: [
  { action: "FILL", locator: { label: "Name" }, name: "name" },
  { action: "SELECT", locator: { label: "Choice" }, value: "b" },
  { action: "UPLOAD", locator: { label: "Upload" }, path: "upload.txt" },
  { action: "CHECK", locator: { label: "Agree" } },
  { action: "CLICK", locator: { role: "button", name: "Submit" } },
  { action: "WAIT_FOR", condition: { locator: { role: "status" }, textIncludes: "DONE" } },
  { action: "ASSERT", predicate: { locator: { role: "status" }, textIncludes: "DONE:karel" } },
  { action: "BRANCH", when: { locator: { role: "status" }, textIncludes: "DONE" }, then: [{ action: "EXTRACT", locator: { role: "status" }, name: "status" }] },
  { action: "REPEAT_BOUNDED", maxIterations: 2, steps: [{ action: "EXTRACT_TEXT", locator: { role: "status" }, name: "repeatStatus" }] },
  { action: "DOWNLOAD", locator: { role: "link", name: "Download" }, destination: "download.txt" },
  { action: "EXTRACT_TEXT", locator: "body", name: "page" }
] };
function sandboxUnavailable(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("No usable sandbox") || message.includes("Chromium sandboxing failed");
}
try {
  await writeFile(path.join(workspace, "upload.txt"), "uploaded fixture", { encoding: "utf8", mode: 0o600 });
  const fixture = `data:text/html,${encodeURIComponent(fixtureHtml)}`;
  const result = await runBrowserAutomation({ manifest: { schemaVersion: manifest.schemaVersion, steps: [{ action: "NAVIGATE", url: fixture }, ...manifest.steps] }, input: { name: "karel" }, workspace, sessionId: "smoke", allowLocal: true });
  const downloaded = await readFile(path.join(workspace, "download.txt"), "utf8");
  if (result.status !== "SUCCEEDED" || result.output.status !== "DONE:karel" || !String(result.output.page).includes("DONE:karel") || downloaded !== "downloaded") throw new Error("automation_typed_output_mismatch");
  const secretResult = await runBrowserAutomation({
    manifest: { schemaVersion: manifest.schemaVersion, steps: [{ action: "NAVIGATE", url: `data:text/html,${encodeURIComponent('<input aria-label="Password" type="password">')}` }, { action: "FILL_SECRET", locator: { label: "Password" }, stableSecretName: "FIXTURE_SECRET" }] },
    workspace, sessionId: "secret", allowLocal: true, resolveSecret: async (stableName) => { if (stableName !== "FIXTURE_SECRET") throw new Error("unexpected_secret_name"); return "sensitive-fixture-value"; }
  });
  if (JSON.stringify(secretResult).includes("sensitive-fixture-value")) throw new Error("automation_secret_leaked_to_result");
  console.log("PASS browser automation declarative runtime typed output, semantic locators, bounded control flow, upload/download and secret boundary");
} catch (error) {
  if (!sandboxUnavailable(error)) throw error;
  console.log(`UNSUPPORTED browser automation fixture requires Chromium sandbox support in host environment (${process.platform})`);
} finally { await rm(workspace, { recursive: true, force: true }); }
