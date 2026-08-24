#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserSession } from "../apps/server/src/generation/browser-session.mjs";
import { reconcileGenerationPlanSecrets, generationSecretGrantElementKeys, normalizeGenerationSecretName } from "../apps/server/src/generation/generation-secret-plan.mjs";
import { captureProviderBrowserSecret, captureProviderJsonSecrets } from "../apps/server/src/generation/provider-secret-capability.mjs";

if (process.platform !== "linux") {
  console.log(`UNSUPPORTED generation secret autonomy fixture requires Linux sandbox/browser runtime; current platform is ${process.platform}`);
  process.exit(0);
}

const chromium = process.env.CHROMIUM_BINARY || "/usr/bin/chromium";
const jobId = "00000000-0000-4000-8000-000000000123";
const plan = {
  summary: "secret autonomy regression",
  elements: [
    { key: "mail", requiredSecretNames: ["MAIL_TOKEN", "PROVIDER_API_TOKEN"], providerGeneratedSecretNames: ["PROVIDER_API_TOKEN"] },
    { key: "whatsapp", requiredSecretNames: ["WHATSAPP_APP_SECRET"], providerGeneratedSecretNames: ["WHATSAPP_APP_SECRET"] }
  ],
  dependencies: [],
  missingInputs: [
    { key: "mail_token", label: "Mail token", description: "mail", kind: "SECRET", required: true, secret: true, stableSecretName: "mail-token", grantToElementKeys: [] },
    { key: "provider_secret", label: "Provider secret", description: "provider generated", kind: "SECRET", required: true, secret: true, stableSecretName: "WHATSAPP_APP_SECRET", grantToElementKeys: [] }
  ]
};

const existing = reconcileGenerationPlanSecrets(plan, { jobId, activeSecretNames: ["MAIL_TOKEN"] });
assert.equal(existing.unsatisfiedRequiredInputs.length, 0, "ACTIVE Secret Manager value incorrectly triggers OWNER_INPUT_REQUIRED");
const reusedMailInput = existing.plan.missingInputs.find((input) => input.stableSecretName === "MAIL_TOKEN");
assert.ok(reusedMailInput, "existing secret plan metadata unexpectedly disappeared");
assert.deepEqual(reusedMailInput.grantToElementKeys, ["mail"], "existing secret did not receive deterministic grant keys");
assert.ok(!existing.plan.missingInputs.some((input) => input.stableSecretName === "WHATSAPP_APP_SECRET"), "provider-generated secret incorrectly asks OWNER before INTEGRATING");
assert.deepEqual(generationSecretGrantElementKeys(existing.plan, "mail_token"), ["mail"]);
assert.deepEqual(generationSecretGrantElementKeys(existing.plan, "whatsapp_app_secret"), ["whatsapp"]);

const missingPlan = structuredClone(plan);
missingPlan.elements.push({ key: "calendar", requiredSecretNames: ["CALENDAR_TOKEN"], providerGeneratedSecretNames: [] });
const missing = reconcileGenerationPlanSecrets(missingPlan, { jobId, activeSecretNames: ["MAIL_TOKEN"] });
const calendarInput = missing.plan.missingInputs.find((input) => input.stableSecretName === "CALENDAR_TOKEN");
assert.ok(calendarInput, "missing required secret did not produce OWNER_INPUT_REQUIRED");
assert.deepEqual(calendarInput.grantToElementKeys, ["calendar"], "requiredSecretNames did not deterministically create component grant keys");
assert.ok(missing.unsatisfiedRequiredInputs.some((input) => input.stableSecretName === "CALENDAR_TOKEN"));

const store = new Map([["MAIL_TOKEN", { value: "existing-mail", version: 3, status: "ACTIVE", grants: new Set(["mail"]) }]]);
const upsertSecret = async (input) => {
  const name = normalizeGenerationSecretName(input.stableSecretName);
  const previous = store.get(name);
  const grants = new Set([...(previous?.grants ?? []), ...(input.grantToElementKeys ?? []), ...generationSecretGrantElementKeys(existing.plan, name)]);
  const record = { value: String(input.value), version: (previous?.version ?? 0) + 1, status: "ACTIVE", grants };
  store.set(name, record);
  return { stableName: name, version: record.version, status: record.status, grantedElementKeys: [...grants] };
};
const resolveSecret = async (name) => {
  const record = store.get(normalizeGenerationSecretName(name));
  if (!record || record.status !== "ACTIVE") throw new Error("secret_not_available");
  return record.value;
};

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-secret-autonomy-"));
const browser = new BrowserSession({ chromiumBinary: chromium, workspace: tmp, sessionId: "secret-autonomy", allowLocal: true });
const find = (state, name) => {
  const item = state.elements.find((entry) => entry.accessibleName === name);
  if (!item?.locator) throw new Error(`browser_locator_missing:${name}`);
  return item.locator;
};
try {
  let state = await browser.loadHtmlForTest(`<!doctype html><html><body>
    <label>Issued secret <input aria-label="Provider issued secret" value="provider-v1"></label>
    <label>Consumer <input aria-label="Secret consumer"></label>
  </body></html>`);
  const captured = await captureProviderBrowserSecret(browser, {
    locator: find(state, "Provider issued secret"), stableSecretName: "whatsapp-app-secret", grantToElementKeys: []
  }, upsertSecret);
  assert.equal(captured.stableSecretName, "whatsapp-app-secret");
  assert.equal((store.get("WHATSAPP_APP_SECRET"))?.value, "provider-v1");
  assert.deepEqual([...(store.get("WHATSAPP_APP_SECRET"))?.grants ?? []], ["whatsapp"]);

  await browser.fill(find(state, "Secret consumer"), await resolveSecret("WHATSAPP_APP_SECRET"));
  assert.equal(await browser.readValue(find(await browser.state(), "Secret consumer")), "provider-v1", "new provider secret was not immediately reusable by browser/API integrator");

  const apiCapture = await captureProviderJsonSecrets({ token: { access: "api-v1" } }, [{ jsonPath: "$.token.access", stableSecretName: "PROVIDER_API_TOKEN", grantToElementKeys: [] }], upsertSecret);
  assert.equal(apiCapture.captures.length, 1);
  assert.equal(await resolveSecret("PROVIDER_API_TOKEN"), "api-v1");
  assert.deepEqual([...(store.get("PROVIDER_API_TOKEN"))?.grants ?? []], ["mail"]);
  await captureProviderJsonSecrets({ token: { access: "api-v2" } }, [{ jsonPath: "$.token.access", stableSecretName: "PROVIDER_API_TOKEN", grantToElementKeys: [] }], upsertSecret);
  assert.equal((store.get("PROVIDER_API_TOKEN"))?.version, 2, "existing provider secret did not use rotate/upsert lifecycle");
  assert.equal(await resolveSecret("PROVIDER_API_TOKEN"), "api-v2");

  const sandboxHelper = fileURLToPath(new URL("./test-generation-secret-sandbox.mjs", import.meta.url));
  const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const command = runningAsRoot ? process.execPath : "/usr/bin/sudo";
  const args = runningAsRoot
    ? [sandboxHelper]
    : ["-n", "env", `PATH=${process.env.PATH || "/usr/bin:/usr/sbin:/bin:/sbin"}`, process.execPath, sandboxHelper];
  const sandboxResult = spawnSync(command, args, { stdio: "inherit" });
  if (sandboxResult.status !== 0) throw sandboxResult.error ?? new Error(`generation_secret_sandbox_failed:${sandboxResult.status ?? "signal"}`);

  console.log("PASS generation Secret Manager reuse OWNER_INPUT_REQUIRED filtering deterministic grants provider capture rotate and immediate browser/runtime use");
} finally {
  await browser.close();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(tmp, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
}
