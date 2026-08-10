#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { deployCandidatesBeforeIntegration, runLiveCandidateIntegration } from "../apps/server/src/generation/integration-phase.mjs";

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-integrating-live-"));
const keyPath = path.join(tmp, "key.pem");
const certPath = path.join(tmp, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);

let candidateServer = null;
let callbackUrl = null;
let deployCompleted = false;
let providerConfigured = false;
const challengeToken = "provider-challenge-token";

async function startCandidate() {
  candidateServer = https.createServer({ key, cert }, (req, res) => {
    const url = new URL(req.url || "/", "https://candidate.invalid");
    if (url.pathname === "/health") { res.end("ok"); return; }
    if (url.pathname === "/webhooks/provider") {
      if (url.searchParams.get("verify_token") !== challengeToken) { res.statusCode = 403; res.end("denied"); return; }
      res.end(url.searchParams.get("challenge") || "");
      return;
    }
    res.statusCode = 404; res.end("not found");
  });
  await new Promise((resolve, reject) => { candidateServer.once("error", reject); candidateServer.listen(0, "127.0.0.1", resolve); });
  const port = candidateServer.address().port;
  callbackUrl = `https://localhost:${port}/webhooks/provider`;
  deployCompleted = true;
}

async function get(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 2000, ca: cert }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

async function providerRegisterCallback(url) {
  if (!deployCompleted || !url) throw new Error("provider_refuses_non_live_callback");
  const challenge = `challenge-${Date.now()}`;
  const response = await get(`${url}?verify_token=${encodeURIComponent(challengeToken)}&challenge=${encodeURIComponent(challenge)}`);
  if (response.status !== 200 || response.body !== challenge) throw new Error("provider_callback_challenge_failed");
  providerConfigured = true;
}

const artifact = { component: { code: "KCML9999" } };
try {
  let refusedBeforeDeploy = false;
  try { await providerRegisterCallback(callbackUrl); } catch (error) { refusedBeforeDeploy = error instanceof Error && error.message === "provider_refuses_non_live_callback"; }
  if (!refusedBeforeDeploy) throw new Error("provider_fixture_did_not_require_live_callback");

  await deployCandidatesBeforeIntegration({
    artifacts: [artifact],
    deployCandidate: async () => startCandidate(),
    waitCandidateRuntime: async () => {
      const response = await get(callbackUrl.replace("/webhooks/provider", "/health"));
      if (response.status !== 200 || response.body !== "ok") throw new Error("candidate_runtime_not_ready");
    }
  });
  if (!deployCompleted) throw new Error("candidate_not_deployed_before_integration");

  await runLiveCandidateIntegration({
    artifacts: [artifact],
    verifyCandidateRuntime: async () => {
      const response = await get(callbackUrl.replace("/webhooks/provider", "/health"));
      if (response.status !== 200) throw new Error("candidate_not_live_at_integration");
    },
    integrate: async () => providerRegisterCallback(callbackUrl)
  });
  if (!providerConfigured) throw new Error("provider_not_configured");
  console.log("PASS post-deploy INTEGRATING uses a live candidate HTTPS callback and provider challenge succeeds (local platform fixture, not Meta/WhatsApp E2E)");
} finally {
  if (candidateServer) await new Promise((resolve) => candidateServer.close(resolve));
  await rm(tmp, { recursive: true, force: true });
}
