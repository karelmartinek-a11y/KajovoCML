#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import {
  applyExternalProviderAuth, encodeExternalBody, externalRouteAllowed, normalizeExternalHeaders,
  normalizeExternalMethod, normalizeExternalRoute, performPinnedHttpsRequest
} from "../apps/server/src/generation/external-http-capability.mjs";

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-egress-test-"));
const keyPath = path.join(tmp, "key.pem");
const certPath = path.join(tmp, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
const seen = [];
const server = https.createServer({ key, cert }, (req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader("x-provider-result", "fixture-ok");
    if (req.method === "HEAD") { res.statusCode = 204; res.end(); return; }
    res.statusCode = req.url?.startsWith("/api/not-found") ? 404 : 207;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ method: req.method, url: req.url, body, header: req.headers["x-client-kind"] ?? null, authorization: req.headers.authorization ?? null }));
  });
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;

async function request(method, routePath, { headers = {}, bodyType = "NONE", body, payload, auth = false } = {}) {
  const route = normalizeExternalRoute(routePath);
  const normalizedMethod = normalizeExternalMethod(method, ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
  const custom = normalizeExternalHeaders(headers);
  const provider = auth ? await applyExternalProviderAuth({
    authConfig: { mode: "BEARER_SECRET", secretName: "PROVIDER_TOKEN" }, accessToken: "unused", tokenFingerprint: "unused", correlationId: "corr-egress",
    resolveSecret: async (name) => {
      if (name !== "PROVIDER_TOKEN") throw new Error("unexpected_secret");
      return { value: "provider-secret-token", fingerprint: "sha256:fixture" };
    }
  }) : { headers: {}, authMode: "NONE", providerSecretFingerprint: null };
  const encoded = encodeExternalBody({ method: normalizedMethod, bodyType, body, payload });
  const requestHeaders = { ...custom, ...provider.headers };
  if (encoded.contentType) requestHeaders["content-type"] ??= encoded.contentType;
  return performPinnedHttpsRequest({
    url: new URL(`https://localhost:${port}${route.pathAndQuery}`), method: normalizedMethod, headers: requestHeaders,
    body: encoded.body, timeoutMs: 5000, address: "127.0.0.1", family: 4, ca: cert
  });
}

try {
  const get = await request("GET", "/api/messages?cursor=abc&limit=2", { headers: { "x-client-kind": "generation" }, auth: true });
  const getJson = JSON.parse(get.body);
  if (get.statusCode !== 207 || get.headers["x-provider-result"] !== "fixture-ok" || getJson.url !== "/api/messages?cursor=abc&limit=2") throw new Error("egress_get_query_failed");
  if (getJson.authorization !== "Bearer provider-secret-token" || getJson.header !== "generation") throw new Error("egress_secret_or_custom_header_failed");

  const postJson = await request("POST", "/api/messages", { bodyType: "JSON", payload: { text: "hello" } });
  if (JSON.parse(postJson.body).body !== '{"text":"hello"}') throw new Error("egress_post_json_failed");

  const postForm = await request("POST", "/oauth/token", { bodyType: "FORM", body: { grant_type: "client_credentials", scope: "messages.read" } });
  if (!JSON.parse(postForm.body).body.includes("grant_type=client_credentials") || !JSON.parse(postForm.body).body.includes("scope=messages.read")) throw new Error("egress_post_form_failed");

  const patch = await request("PATCH", "/api/messages/42", { bodyType: "TEXT", body: "patched" });
  if (JSON.parse(patch.body).method !== "PATCH" || JSON.parse(patch.body).body !== "patched") throw new Error("egress_patch_failed");

  const del = await request("DELETE", "/api/messages/42");
  if (JSON.parse(del.body).method !== "DELETE") throw new Error("egress_delete_failed");

  const head = await request("HEAD", "/api/messages/42");
  if (head.statusCode !== 204 || head.body !== "") throw new Error("egress_head_failed");

  let deniedMethod = false;
  try { normalizeExternalMethod("DELETE", ["GET", "POST"]); } catch (error) { deniedMethod = error instanceof Error && error.message === "external_method_denied"; }
  if (!deniedMethod) throw new Error("egress_denied_method_not_enforced");
  if (externalRouteAllowed("/api/messages/*", "/admin/delete")) throw new Error("egress_denied_path_not_enforced");
  if (!externalRouteAllowed("/api/messages/*", "/api/messages/42")) throw new Error("egress_allowed_path_rejected");

  let deniedHeader = false;
  try { normalizeExternalHeaders({ authorization: "bypass" }); } catch { deniedHeader = true; }
  if (!deniedHeader) throw new Error("egress_authorization_header_bypass_allowed");
  if (seen.length < 6) throw new Error("egress_fixture_insufficient_requests");
  console.log("PASS generalized CML HTTPS egress GET/query POST JSON/form PATCH DELETE HEAD headers response metadata provider-secret auth and deny rules");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(tmp, { recursive: true, force: true });
}
