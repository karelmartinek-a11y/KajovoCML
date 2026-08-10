#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { generationSecretGrantElementKeys } from "../apps/server/src/generation/generation-secret-plan.mjs";
import { grantGenerationSecretBeforeResume, resumeGenerationAfterSatisfiedInputs } from "../apps/server/src/generation/generation-secret-grant-control.mjs";

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-integrating-secret-grant-"));
const keyPath = path.join(tmp, "key.pem");
const certPath = path.join(tmp, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);

const plan = {
  elements: [{ key: "whatsapp", requiredSecretNames: ["WHATSAPP_VERIFY_TOKEN"], providerGeneratedSecretNames: [] }],
  dependencies: [],
  missingInputs: []
};
const component = { componentId: "component-whatsapp", code: "KCML9001", elementKey: "whatsapp" };
const secretStore = new Map();
const componentGrants = new Map([[component.componentId, new Set()]]);
const platformGrants = new Set();
const order = [];
let jobState = "INTEGRATING";
let ownerPrompts = 0;
const safeChallenge = /^[A-Za-z0-9-]{1,200}$/;

function activeSecret(name) {
  const secret = secretStore.get(name);
  return secret?.status === "ACTIVE" ? secret : null;
}
function componentCanResolve(name) {
  const secret = activeSecret(name);
  if (!secret) throw new Error("secret_missing");
  if (!componentGrants.get(component.componentId)?.has(name)) throw new Error("component_secret_grant_missing");
  return secret.value;
}
async function grantStableSecret(name) {
  const elementKeys = generationSecretGrantElementKeys(plan, name);
  return grantGenerationSecretBeforeResume({
    stableSecretName: name,
    elementKeys,
    findActiveSecret: async (stableName) => activeSecret(stableName),
    grantPlatform: async (secret) => { platformGrants.add(secret.stableName); order.push(`platform:${secret.stableName}`); },
    listComponents: async (keys) => keys.includes(component.elementKey) ? [component] : [],
    grantComponent: async (secret, target) => {
      componentGrants.get(target.componentId).add(secret.stableName);
      order.push(`component:${target.componentId}:${secret.stableName}`);
    }
  });
}

let server;
let callbackUrl;
async function get(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { ca: cert, timeout: 2000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}
async function providerChallenge() {
  const challenge = `challenge-${Date.now()}`;
  const token = activeSecret("WHATSAPP_VERIFY_TOKEN")?.value ?? "not-yet-known";
  const callback = new URL(callbackUrl);
  callback.searchParams.set("verify_token", token);
  callback.searchParams.set("challenge", challenge);
  return get(callback).then((response) => ({ ...response, challenge }));
}

try {
  server = https.createServer({ key, cert }, (req, res) => {
    const url = new URL(req.url || "/", "https://candidate.invalid");
    if (url.pathname !== "/webhooks/whatsapp") { res.statusCode = 404; res.end("not found"); return; }
    let expected;
    try { expected = componentCanResolve("WHATSAPP_VERIFY_TOKEN"); }
    catch { res.statusCode = 503; res.end("secret unavailable"); return; }
    if (url.searchParams.get("verify_token") !== expected) { res.statusCode = 403; res.end("denied"); return; }
    const challenge = url.searchParams.get("challenge") || "";
    if (!safeChallenge.test(challenge)) { res.statusCode = 400; res.end("invalid challenge"); return; }
    res.statusCode = 200;
    res.end(challenge);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  callbackUrl = `https://localhost:${server.address().port}/webhooks/whatsapp`;

  // Candidate is live, but INTEGRATING discovers a genuinely missing OWNER secret.
  const beforeOwner = await providerChallenge();
  assert.equal(beforeOwner.status, 503, "candidate unexpectedly resolved an ungranted/missing secret");
  jobState = "NEEDS_INPUT";
  ownerPrompts += 1;

  // OWNER submits the secret. The same canonical Secret Manager lifecycle makes it ACTIVE.
  secretStore.set("WHATSAPP_VERIFY_TOKEN", { stableName: "WHATSAPP_VERIFY_TOKEN", value: "owner-verify-token", status: "ACTIVE", version: 1 });
  await resumeGenerationAfterSatisfiedInputs({
    resumeState: "INTEGRATING",
    ensureIntegrationGrants: async () => {
      const result = await grantStableSecret("WHATSAPP_VERIFY_TOKEN");
      assert.equal(result.available, true);
      assert.deepEqual(result.grantedElementKeys, ["whatsapp"]);
      assert.deepEqual(result.componentIds, [component.componentId]);
    },
    setState: async (state) => {
      // This is the critical invariant: component grant exists before persisted resume.
      assert.equal(componentGrants.get(component.componentId).has("WHATSAPP_VERIFY_TOKEN"), true, "INTEGRATING resumed before component Secret grant existed");
      order.push(`state:${state}`);
      jobState = state;
    },
    clearResumeState: async () => { order.push("resume_state:cleared"); },
    appendCompleteEvent: async () => { order.push("event:inputs_complete"); }
  });
  assert.equal(jobState, "INTEGRATING");
  const componentGrantIndex = order.findIndex((entry) => entry.startsWith("component:"));
  const resumeIndex = order.indexOf("state:INTEGRATING");
  assert.ok(componentGrantIndex >= 0 && resumeIndex > componentGrantIndex, "component grant was not committed before INTEGRATING resume");

  // The first provider callback after resume resolves the candidate runtime secret and succeeds.
  const firstResumedCallback = await providerChallenge();
  assert.equal(firstResumedCallback.status, 200);
  assert.equal(firstResumedCallback.body, firstResumedCallback.challenge);
  assert.equal(ownerPrompts, 1, "provider callback required a second OWNER secret submission");

  // Existing ACTIVE secret rediscovered during INTEGRATING: no OWNER prompt, but the
  // deterministic component grant is repaired before provider work continues.
  componentGrants.get(component.componentId).clear();
  order.length = 0;
  jobState = "INTEGRATING";
  const promptsBeforeReuse = ownerPrompts;
  const reused = await grantStableSecret("WHATSAPP_VERIFY_TOKEN");
  assert.equal(reused.available, true);
  assert.equal(componentGrants.get(component.componentId).has("WHATSAPP_VERIFY_TOKEN"), true);
  assert.equal(ownerPrompts, promptsBeforeReuse, "existing ACTIVE secret incorrectly asked OWNER again");
  const reusedCallback = await providerChallenge();
  assert.equal(reusedCallback.status, 200);
  assert.equal(reusedCallback.body, reusedCallback.challenge);
  assert.equal(platformGrants.has("WHATSAPP_VERIFY_TOKEN"), true);

  console.log("PASS INTEGRATING OWNER/existing secret receives deterministic component grant before resume and first provider callback resolves it");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(tmp, { recursive: true, force: true });
}
