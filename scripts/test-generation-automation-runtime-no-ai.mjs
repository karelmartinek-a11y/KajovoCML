#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBrowserAutomation } from "../apps/server/src/generation/browser-automation-runtime.mjs";

const workspace = await mkdtemp(path.join(os.tmpdir(), "kcml-automation-no-ai-"));
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (...args) => {
  calls.push(String(args[0]));
  throw new Error("routine_automation_http_or_ai_call_forbidden");
};
function sandboxUnavailable(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("No usable sandbox") || message.includes("Chromium sandboxing failed");
}
try {
  const result = await runBrowserAutomation({
    manifest: {
      schemaVersion: "kcml.browser-automation.v1",
      steps: [
        { action: "NAVIGATE", url: "data:text/html,<main aria-label='result'>typed result</main>" },
        { action: "EXTRACT_TEXT", locator: "[aria-label='result']", name: "result" }
      ]
    }, input: {}, workspace, sessionId: "no-ai", allowLocal: true
  });
  if (result.status !== "SUCCEEDED" || result.output.result !== "typed result") throw new Error("routine_automation_deterministic_output_failed");
  if (calls.length) throw new Error(`routine_automation_made_forbidden_http_call:${calls.join(",")}`);
  console.log("PASS routine browser automation executes declarative manifest without LLM or HTTP API calls");
} catch (error) {
  if (!sandboxUnavailable(error)) throw error;
  console.log(`UNSUPPORTED routine browser automation fixture requires Chromium sandbox support in host environment (${process.platform})`);
} finally {
  globalThis.fetch = originalFetch;
  await rm(workspace, { recursive: true, force: true });
}
