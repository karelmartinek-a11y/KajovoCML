#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBrowserAutomation, validateManifest } from "../apps/server/src/generation/browser-automation-runtime.mjs";

const workspace = await mkdtemp(path.join(os.tmpdir(), "kcml-automation-recovery-"));
try {
  let rejected = false;
  try { validateManifest({ schemaVersion: "kcml.browser-automation.v1", steps: [{ action: "RUN_JS", code: "process.exit()" }] }); } catch (error) { rejected = error instanceof Error && error.message.includes("automation_action_not_allowed"); }
  if (!rejected) throw new Error("automation_arbitrary_action_not_rejected");
  const controller = new AbortController();
  controller.abort(new Error("automation_cancelled"));
  const promise = runBrowserAutomation({ manifest: { schemaVersion: "kcml.browser-automation.v1", steps: [{ action: "WAIT", text: "never-visible", timeoutMs: 1_000 }] }, workspace, sessionId: "recovery", allowLocal: true, signal: controller.signal });
  await promise.then(() => { throw new Error("automation_cancel_not_propagated"); }).catch((error) => { if (!String(error.message).includes("automation_cancelled")) throw error; });
  console.log("PASS browser automation rejects arbitrary code and recovers cancellation");
} finally { await rm(workspace, { recursive: true, force: true }); }
