#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBrowserAutomation } from "../apps/server/src/generation/browser-automation-runtime.mjs";

const workspace = await mkdtemp(path.join(os.tmpdir(), "kcml-automation-"));
const manifest = { schemaVersion: "kcml.browser-automation.v1", steps: [
  { action: "FILL", locator: "[aria-label='Name']", name: "name" },
  { action: "CLICK", locator: "[aria-label='Submit']" },
  { action: "ASSERT_TEXT", text: "SUBMITTED" },
  { action: "EXTRACT_TEXT", locator: "body", name: "page" }
] };
try {
  const fixture = `data:text/html,<input aria-label="Name"><button aria-label="Submit" onclick="document.body.innerText='SUBMITTED:'+document.querySelector('input').value">Submit</button>`;
  const result = await runBrowserAutomation({ manifest: { schemaVersion: manifest.schemaVersion, steps: [{ action: "NAVIGATE", url: fixture }, ...manifest.steps] }, input: { name: "karel" }, workspace, sessionId: "smoke", allowLocal: true });
  if (result.status !== "SUCCEEDED" || !String(result.output.page).includes("SUBMITTED:karel")) throw new Error("automation_typed_output_mismatch");
  console.log("PASS browser automation declarative runtime typed output and deterministic steps");
} finally { await rm(workspace, { recursive: true, force: true }); }
