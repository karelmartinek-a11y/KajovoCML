import { PlaywrightBrowserSession } from "./playwright-session.mjs";

const ACTIONS = new Set(["NAVIGATE", "FILL", "SELECT", "CLICK", "WAIT", "ASSERT_TEXT", "EXTRACT_TEXT"]);

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function required(value, name) { if (typeof value !== "string" || !value.trim()) throw new Error(`automation_${name}_required`); return value; }
function privateHost(host) { return host === "localhost" || host === "::1" || host.endsWith(".local") || /^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host); }
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("automation_cancelled"));
  return Promise.race([promise, new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new Error("automation_cancelled")), { once: true }))]);
}

export function validateManifest(manifest) {
  const value = object(manifest);
  if (value.schemaVersion !== "kcml.browser-automation.v1") throw new Error("automation_manifest_schema_unsupported");
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 100) throw new Error("automation_manifest_steps_invalid");
  for (const [index, step] of value.steps.entries()) {
    const action = required(object(step).action, "action").toUpperCase();
    if (!ACTIONS.has(action)) throw new Error(`automation_action_not_allowed:${action}`);
    if (action !== "NAVIGATE" && !object(step).locator && !["WAIT", "ASSERT_TEXT"].includes(action)) throw new Error(`automation_locator_required:${index}`);
  }
  return value;
}

export async function runBrowserAutomation({ manifest, input = {}, workspace, sessionId, chromiumBinary, allowLocal = false, signal }) {
  const definition = validateManifest(manifest);
  const session = new PlaywrightBrowserSession({ workspace, sessionId, chromiumBinary, allowLocal });
  const steps = [];
  const outputs = {};
  const abort = () => { void session.close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (const [index, raw] of definition.steps.entries()) {
      signal?.throwIfAborted();
      const step = object(raw); const action = String(step.action).toUpperCase();
      const startedAt = new Date().toISOString();
      try {
        let value;
        if (action === "NAVIGATE") {
          const url = new URL(required(step.url, "url"));
          if (!allowLocal && (url.protocol !== "https:" || privateHost(url.hostname))) throw new Error("automation_navigation_blocked");
          value = await abortable(session.open(url.toString()), signal);
        } else if (action === "FILL") value = await abortable(session.fill(required(step.locator, "locator"), String(input[String(step.name)] ?? step.value ?? "")), signal);
        else if (action === "SELECT") value = await abortable(session.select(required(step.locator, "locator"), String(input[String(step.name)] ?? step.value ?? "")), signal);
        else if (action === "CLICK") value = await abortable(session.click(required(step.locator, "locator")), signal);
        else if (action === "WAIT") value = await abortable(session.wait({ locator: step.locator ?? null, text: step.text ?? null, urlIncludes: step.urlIncludes ?? null, timeoutMs: Number(step.timeoutMs ?? 15_000) }), signal);
        else if (action === "ASSERT_TEXT") { value = await abortable(session.wait({ text: required(step.text, "text"), timeoutMs: Number(step.timeoutMs ?? 15_000) }), signal); }
        else if (action === "EXTRACT_TEXT") { const state = await abortable(session.state(), signal); outputs[required(step.name, "name")] = state.text; value = { extracted: true }; }
        steps.push({ index, action, status: "SUCCEEDED", startedAt, completedAt: new Date().toISOString(), output: value });
      } catch (error) {
        steps.push({ index, action, status: "FAILED", startedAt, completedAt: new Date().toISOString(), errorCode: error instanceof Error ? error.message : "automation_step_failed" });
        throw error;
      }
    }
    return { status: "SUCCEEDED", output: outputs, steps };
  } finally { signal?.removeEventListener("abort", abort); await session.close(); }
}
