import { PlaywrightBrowserSession } from "./playwright-session.mjs";

const ACTIONS = new Set([
  "NAVIGATE", "CLICK", "FILL", "FILL_SECRET", "SELECT", "CHECK", "UNCHECK", "PRESS",
  "UPLOAD", "DOWNLOAD", "WAIT", "WAIT_FOR", "ASSERT_TEXT", "ASSERT", "EXTRACT_TEXT",
  "EXTRACT", "BRANCH", "REPEAT_BOUNDED"
]);
const PREDICATE_KEYS = new Set(["urlIncludes", "locator", "visible", "hidden", "textIncludes", "valueEquals", "count", "attribute", "result"]);
const SIDE_EFFECT_CLASSES = new Set(["READ_ONLY", "LOCAL_INPUT", "AUTHENTICATION", "MUTATION_IDEMPOTENT", "MUTATION_NON_IDEMPOTENT", "DESTRUCTIVE"]);
const MUTATING_ACTIONS = new Set(["CLICK", "FILL", "FILL_SECRET", "SELECT", "CHECK", "UNCHECK", "PRESS", "UPLOAD", "DOWNLOAD"]);
const MAX_NESTING = 4;
const MAX_STEPS = 100;
const MAX_REPEAT = 20;

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function required(value, name) { if (typeof value !== "string" || !value.trim()) throw new Error(`automation_${name}_required`); return value; }
function requiredLocator(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) return value;
  throw new Error("automation_locator_required");
}
function privateHost(host) {
  const value = String(host).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (["localhost", "::1"].includes(value) || value.endsWith(".local")) return true;
  if (/^(10|127)\./.test(value) || /^192\.168\./.test(value)) return true;
  const match = value.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("automation_cancelled"));
  return Promise.race([promise, new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new Error("automation_cancelled")), { once: true }))]);
}
function locatorPresent(step) {
  return object(step).locator && (typeof step.locator === "string" || Object.keys(object(step.locator)).length > 0);
}
function validatePredicate(predicate, path) {
  const value = object(predicate);
  if (!Object.keys(value).some((key) => PREDICATE_KEYS.has(key))) throw new Error(`automation_predicate_invalid:${path}`);
  if (value.locator !== undefined && !locatorPresent({ locator: value.locator })) throw new Error(`automation_predicate_locator_invalid:${path}`);
  if (value.attribute !== undefined && (!object(value.attribute).name || typeof object(value.attribute).name !== "string")) throw new Error(`automation_predicate_attribute_invalid:${path}`);
  if (value.result !== undefined && typeof value.result !== "string") throw new Error(`automation_predicate_result_invalid:${path}`);
}
function validateSteps(steps, depth, path) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) throw new Error(`automation_manifest_steps_invalid:${path}`);
  let total = 0;
  for (const [index, raw] of steps.entries()) {
    const step = object(raw); const action = required(step.action, "action").toUpperCase(); total += 1;
    if (!ACTIONS.has(action)) throw new Error(`automation_action_not_allowed:${action}`);
    if (depth > MAX_NESTING) throw new Error("automation_manifest_nesting_too_deep");
    if (step.sideEffectClass !== undefined && !SIDE_EFFECT_CLASSES.has(String(step.sideEffectClass))) throw new Error(`automation_side_effect_class_invalid:${path}.${index}`);
    if (action === "NAVIGATE") required(step.url, "url");
    if (["CLICK", "FILL", "FILL_SECRET", "SELECT", "CHECK", "UNCHECK", "PRESS", "UPLOAD", "DOWNLOAD", "EXTRACT_TEXT", "EXTRACT"].includes(action) && !locatorPresent(step)) throw new Error(`automation_locator_required:${path}.${index}`);
    if (["FILL", "SELECT"].includes(action) && step.name === undefined && step.value === undefined) throw new Error(`automation_input_binding_required:${path}.${index}`);
    if (action === "FILL_SECRET") required(step.stableSecretName ?? step.secretName, "stable_secret_name");
    if (action === "ASSERT_TEXT") required(step.text, "text");
    if (["WAIT", "WAIT_FOR"].includes(action) && step.condition !== undefined) validatePredicate(step.condition, `${path}.${index}.condition`);
    if (action === "ASSERT") validatePredicate(step.predicate ?? step.condition, `${path}.${index}.predicate`);
    if (action === "BRANCH") {
      validatePredicate(step.when ?? step.condition, `${path}.${index}.when`);
      total += validateSteps(step.then ?? step.ifTrue, depth + 1, `${path}.${index}.then`);
      if (step.else !== undefined || step.ifFalse !== undefined) total += validateSteps(step.else ?? step.ifFalse, depth + 1, `${path}.${index}.else`);
    }
    if (action === "REPEAT_BOUNDED") {
      const max = Number(step.maxIterations);
      if (!Number.isInteger(max) || max < 1 || max > MAX_REPEAT) throw new Error(`automation_repeat_bound_invalid:${path}.${index}`);
      if (step.until !== undefined) validatePredicate(step.until, `${path}.${index}.until`);
      total += validateSteps(step.steps, depth + 1, `${path}.${index}.steps`);
    }
  }
  if (total > MAX_STEPS) throw new Error("automation_manifest_steps_invalid:expanded");
  return total;
}

export function validateManifest(manifest) {
  const value = object(manifest);
  if (value.schemaVersion !== "kcml.browser-automation.v1") throw new Error("automation_manifest_schema_unsupported");
  validateSteps(value.steps, 0, "steps");
  return value;
}

function inputValue(input, step) {
  if (step.name !== undefined) return input[String(step.name)];
  return step.value;
}
function workspacePath(workspace, value, name) {
  const relative = required(value, name);
  if (relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..")) throw new Error("automation_workspace_path_invalid");
  const root = process.platform === "win32" ? workspace.toLowerCase() : workspace;
  const target = process.platform === "win32" ? `${workspace}/${relative}`.toLowerCase() : `${workspace}/${relative}`;
  if (!target.startsWith(`${root}/`)) throw new Error("automation_workspace_path_invalid");
  return target;
}
function predicateFor(step) { return step.predicate ?? step.condition ?? step.when; }
function isMutation(action, step) {
  return MUTATING_ACTIONS.has(action) || String(step.sideEffectClass ?? "").startsWith("MUTATION") || String(step.sideEffectClass ?? "") === "DESTRUCTIVE";
}
function errorCode(error) { return error instanceof Error ? error.message : "automation_step_failed"; }

async function observePredicate(session, predicate, outputs) {
  const value = object(predicate);
  if (value.result !== undefined) {
    const result = outputs[String(value.result)];
    if (typeof value.equals === "boolean") return Boolean(result) === value.equals;
    return Boolean(result);
  }
  return session.observe(value);
}

async function executeAtomic({ session, step, action, input, outputs, workspace, resolveSecret, allowLocal }) {
  if (action === "NAVIGATE") {
    const url = new URL(required(step.url, "url"));
    if (!allowLocal && (url.protocol !== "https:" || privateHost(url.hostname))) throw new Error("automation_navigation_blocked");
    return session.open(url.toString());
  }
  if (action === "FILL") return session.fill(requiredLocator(step.locator), String(inputValue(input, step) ?? ""));
  if (action === "FILL_SECRET") {
    if (!resolveSecret) throw new Error("automation_secret_resolver_required");
    const stableName = String(step.stableSecretName ?? step.secretName);
    const secret = await resolveSecret(stableName);
    await session.fillSecret(requiredLocator(step.locator), secret);
    return { secretApplied: true };
  }
  if (action === "SELECT") return session.select(requiredLocator(step.locator), String(inputValue(input, step) ?? ""));
  if (action === "CLICK") return session.click(requiredLocator(step.locator));
  if (action === "CHECK") return session.check(requiredLocator(step.locator));
  if (action === "UNCHECK") return session.uncheck(requiredLocator(step.locator));
  if (action === "PRESS") return session.press(step.locator ?? "body", required(step.key, "key"));
  if (action === "UPLOAD") {
    const relative = input[String(step.inputName ?? step.name ?? "file")];
    return session.upload(requiredLocator(step.locator), workspacePath(workspace, step.path ?? relative, "upload_path"));
  }
  if (action === "DOWNLOAD") {
    const destination = workspacePath(workspace, step.destination ?? `${String(step.name ?? "download")}.bin`, "download_path");
    return session.download(requiredLocator(step.locator), destination);
  }
  if (action === "WAIT" || action === "WAIT_FOR") {
    if (step.condition && !(await observePredicate(session, step.condition, outputs))) throw new Error("automation_wait_condition_not_met");
    return session.wait({ locator: step.locator ?? null, text: step.text ?? null, urlIncludes: step.urlIncludes ?? null, timeoutMs: Number(step.timeoutMs ?? 15_000) });
  }
  if (action === "ASSERT_TEXT") return session.wait({ text: required(step.text, "text"), timeoutMs: Number(step.timeoutMs ?? 15_000) });
  if (action === "ASSERT") {
    if (!(await observePredicate(session, predicateFor(step), outputs))) throw new Error("automation_assertion_failed");
    return { asserted: true };
  }
  if (action === "EXTRACT_TEXT") {
    const extracted = await session.readText(requiredLocator(step.locator));
    outputs[required(step.name, "name")] = extracted;
    return { extracted: true };
  }
  if (action === "EXTRACT") {
    const name = required(step.name, "name");
    const kind = String(step.kind ?? "text");
    let extracted;
    if (kind === "value") extracted = await session.readValue(requiredLocator(step.locator));
    else if (kind === "url") extracted = (await session.state()).url;
    else if (kind === "count") extracted = await session.observe({ locator: step.locator, count: Number(step.count ?? 0) });
    else extracted = await session.readText(requiredLocator(step.locator));
    outputs[name] = extracted;
    return { extracted: true, kind };
  }
  throw new Error(`automation_action_not_allowed:${action}`);
}

async function executeSteps({ session, steps, input, outputs, workspace, signal, resolveSecret, allowLocal, results, indexPrefix = "" }) {
  for (const [index, raw] of steps.entries()) {
    signal?.throwIfAborted();
    const step = object(raw); const action = String(step.action).toUpperCase(); const indexValue = indexPrefix ? `${indexPrefix}.${index}` : index;
    const startedAt = new Date().toISOString();
    try {
      let value;
      if (action === "BRANCH") {
        const branch = await observePredicate(session, predicateFor(step), outputs) ? (step.then ?? step.ifTrue) : (step.else ?? step.ifFalse ?? []);
        await executeSteps({ session, steps: branch, input, outputs, workspace, signal, resolveSecret, allowLocal, results, indexPrefix: String(indexValue) });
        value = { branch: branch === (step.then ?? step.ifTrue) ? "then" : "else" };
      } else if (action === "REPEAT_BOUNDED") {
        const nested = step.steps; let iterations = 0;
        while (iterations < Number(step.maxIterations)) {
          signal?.throwIfAborted();
          if (step.until && await observePredicate(session, step.until, outputs)) break;
          await executeSteps({ session, steps: nested, input, outputs, workspace, signal, resolveSecret, allowLocal, results, indexPrefix: `${indexValue}.${iterations}` });
          iterations += 1;
        }
        value = { iterations };
      } else value = await abortable(executeAtomic({ session, step, action, input, outputs, workspace, signal, resolveSecret, allowLocal }), signal);
      results.push({ index: indexValue, action, status: "SUCCEEDED", startedAt, completedAt: new Date().toISOString(), output: value });
    } catch (error) {
      const code = errorCode(error);
      const status = isMutation(action, step) && code !== "automation_cancelled" ? "UNCERTAIN" : "FAILED";
      results.push({ index: indexValue, action, status, startedAt, completedAt: new Date().toISOString(), errorCode: status === "UNCERTAIN" ? "automation_uncertain_side_effect" : code });
      if (status === "UNCERTAIN") throw new Error("automation_uncertain_side_effect");
      throw error;
    }
  }
}

export async function runBrowserAutomation({ manifest, input = {}, workspace, sessionId, chromiumBinary, allowLocal = false, signal, resolveSecret }) {
  const definition = validateManifest(manifest);
  const session = new PlaywrightBrowserSession({ workspace, sessionId, chromiumBinary, allowLocal });
  const steps = [];
  const outputs = {};
  const abort = () => { void session.close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await executeSteps({ session, steps: definition.steps, input: object(input), outputs, workspace, signal, resolveSecret, allowLocal, results: steps });
    return { status: "SUCCEEDED", output: outputs, steps };
  } finally { signal?.removeEventListener("abort", abort); await session.close(); }
}
