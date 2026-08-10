#!/usr/bin/env node
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}
function jsonEnv(name) { return JSON.parse(required(name)); }
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
async function rpc(base, token, method, params) {
  const response = await fetch(new URL("/mcp", base), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(30_000)
  });
  assert.equal(response.status, 200, `MCP HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`MCP ${method} failed: ${body.error.message}`);
  return body.result;
}

const base = required("KCML_LIVE_COMPONENT_URL");
assert.equal(new URL(base).protocol, "https:", "live component URL must be HTTPS");
const token = required("KCML_LIVE_COMPONENT_TOKEN");
const tool = required("KCML_LIVE_TOOL");
const input = jsonEnv("KCML_LIVE_INPUT_JSON");
const expected = jsonEnv("KCML_LIVE_EXPECTED_JSON");
const listed = await rpc(base, token, "tools/list");
assert.ok(Array.isArray(listed.tools) && listed.tools.some((candidate) => candidate.name === tool), "declared tool missing from canonical tools/list");
const called = await rpc(base, token, "tools/call", { name: tool, arguments: input });
assert.equal(canonical(called.structuredContent), canonical(expected), "canonical public tools/call output mismatch");

if (process.env.KCML_LIVE_DEPENDENCY_SOURCE_URL) {
  const sourceBase = required("KCML_LIVE_DEPENDENCY_SOURCE_URL");
  const sourceToken = required("KCML_LIVE_DEPENDENCY_SOURCE_TOKEN");
  const sourceTool = required("KCML_LIVE_DEPENDENCY_SOURCE_TOOL");
  const sourceInput = jsonEnv("KCML_LIVE_DEPENDENCY_SOURCE_INPUT_JSON");
  const sourceExpected = jsonEnv("KCML_LIVE_DEPENDENCY_SOURCE_EXPECTED_JSON");
  const sourceResult = await rpc(sourceBase, sourceToken, "tools/call", { name: sourceTool, arguments: sourceInput });
  assert.equal(canonical(sourceResult.structuredContent), canonical(sourceExpected), "cross-component dependency call output mismatch");
}

if (process.env.KCML_LIVE_WEBHOOK_URL) {
  const webhook = new URL(required("KCML_LIVE_WEBHOOK_URL"));
  assert.equal(webhook.protocol, "https:", "live webhook URL must be HTTPS");
  const challengeToken = required("KCML_LIVE_WEBHOOK_CHALLENGE_TOKEN");
  const challenge = `kcml-live-${Date.now()}`;
  const challengeUrl = new URL(webhook);
  challengeUrl.searchParams.set(process.env.KCML_LIVE_WEBHOOK_CHALLENGE_TOKEN_QUERY || "hub.verify_token", challengeToken);
  challengeUrl.searchParams.set(process.env.KCML_LIVE_WEBHOOK_CHALLENGE_VALUE_QUERY || "hub.challenge", challenge);
  const challengeResponse = await fetch(challengeUrl, { method: "GET", signal: AbortSignal.timeout(30_000) });
  assert.equal(challengeResponse.status, 200, `webhook challenge HTTP ${challengeResponse.status}`);
  assert.equal(await challengeResponse.text(), challenge, "webhook challenge mismatch");

  const callbackInput = jsonEnv("KCML_LIVE_WEBHOOK_CALLBACK_JSON");
  const callbackExpected = jsonEnv("KCML_LIVE_WEBHOOK_EXPECTED_JSON");
  const bytes = Buffer.from(JSON.stringify(callbackInput));
  const signatureSecret = required("KCML_LIVE_WEBHOOK_SIGNATURE_SECRET");
  const signatureHeader = process.env.KCML_LIVE_WEBHOOK_SIGNATURE_HEADER || "x-hub-signature-256";
  const signaturePrefix = process.env.KCML_LIVE_WEBHOOK_SIGNATURE_PREFIX ?? "sha256=";
  const signature = `${signaturePrefix}${createHmac("sha256", signatureSecret).update(bytes).digest("hex")}`;
  const callbackResponse = await fetch(webhook, {
    method: process.env.KCML_LIVE_WEBHOOK_METHOD || "POST",
    headers: { "content-type": "application/json", [signatureHeader]: signature },
    body: bytes,
    signal: AbortSignal.timeout(30_000)
  });
  assert.equal(callbackResponse.status, Number(process.env.KCML_LIVE_WEBHOOK_EXPECTED_STATUS || 200), "webhook callback HTTP status mismatch");
  const callbackBody = await callbackResponse.json();
  assert.equal(canonical(callbackBody), canonical(callbackExpected), "webhook callback body mismatch");
}

console.log("PASS generated platform live canonical HTTPS MCP/webhook flow");
