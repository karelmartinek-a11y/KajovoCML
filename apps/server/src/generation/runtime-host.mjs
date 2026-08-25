#!/usr/bin/env node
import http from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import { GeneratedHandlerSandbox } from "./handler-sandbox.mjs";

const socketPath = process.env.KCML_RUNTIME_SOCKET;
const componentCode = process.env.KCML_COMPONENT_CODE;
const handlerPath = process.env.KCML_HANDLER_PATH;
const stateDir = process.env.KCML_STATE_DIR;
const secretApiBase = process.env.KCML_SECRET_API_BASE;
const componentHostname = process.env.KCML_COMPONENT_HOSTNAME;
if (!socketPath || !componentCode || !handlerPath || !stateDir || !secretApiBase || !componentHostname) throw new Error("generated_runtime_configuration_missing");
const credentialDir = process.env.CREDENTIALS_DIRECTORY;
if (!credentialDir) throw new Error("generated_runtime_credentials_directory_missing");
const runtimeToken = (await readFile(resolve(credentialDir, "runtime_token"), "utf8")).trim();
if (!runtimeToken.startsWith("kca_") || runtimeToken.length < 80) throw new Error("generated_runtime_token_invalid");
await mkdir(dirname(socketPath), { recursive: true });
await mkdir(stateDir, { recursive: true });
await rm(socketPath, { force: true });

let enabled = true;
const modePath = resolve(stateDir, "runtime-mode.json");
const handlerStatePath = resolve(stateDir, "handler-state.json");
try { enabled = JSON.parse(await readFile(modePath, "utf8")).enabled !== false; } catch { /* first boot has no persisted mode yet */ }
const startedAt = new Date().toISOString();
let lastInvocationAt = null;
let requestCount = 0;

function json(reply, status, value, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(value));
  reply.writeHead(status, { "content-type": "application/json", "content-length": payload.length, "cache-control": "no-store", ...extraHeaders });
  reply.end(payload);
}
function authorized(request) {
  const auth = request.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (provided.length !== runtimeToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(runtimeToken));
}
async function body(request, max = 1024 * 1024) {
  const chunks = []; let total = 0;
  for await (const chunk of request) { total += chunk.length; if (total > max) throw new Error("request_too_large"); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
async function persistMode() { await writeFile(modePath, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }), { mode: 0o600 }); }
function stateKey(key) {
  const value = String(key || "");
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new Error("component_state_key_invalid");
  return value;
}
async function readHandlerState() {
  try {
    const value = JSON.parse(await readFile(handlerStatePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("component_state_corrupt");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}
async function writeHandlerState(value) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 512 * 1024) throw new Error("component_state_too_large");
  const temporary = `${handlerStatePath}.tmp-${process.pid}`;
  await writeFile(temporary, serialized, { mode: 0o600 });
  await rename(temporary, handlerStatePath);
}
async function stateGet(key) {
  const state = await readHandlerState();
  const name = stateKey(key);
  return Object.prototype.hasOwnProperty.call(state, name) ? state[name] : null;
}
async function stateSet(key, value) {
  const name = stateKey(key);
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > 128 * 1024) throw new Error("component_state_value_invalid");
  const state = await readHandlerState();
  state[name] = JSON.parse(encoded);
  await writeHandlerState(state);
  return state[name];
}
async function stateDelete(key) {
  const name = stateKey(key);
  const state = await readHandlerState();
  const existed = Object.prototype.hasOwnProperty.call(state, name);
  delete state[name];
  await writeHandlerState(state);
  return { deleted: existed };
}
async function resolveRuntimeSecret(name) {
  const response = await fetch(`${secretApiBase}/v1/secrets/resolve`, {
    method: "POST",
    headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`secret_resolve_${response.status}`);
  const payload = await response.json();
  return payload.value;
}
async function callComponent({ hostname, tool, arguments: args = {}, timeoutMs = 45000 }) {
  if (typeof hostname !== "string" || !/^kcml[0-9]{4,}\.kajovocml\.hcasc\.cz$/i.test(hostname)) throw new Error("component_target_hostname_invalid");
  if (typeof tool !== "string" || !tool) throw new Error("component_target_tool_invalid");
  const response = await fetch(`https://${hostname}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(Math.min(Math.max(Number(timeoutMs) || 45000, 100), 300000))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(`component_call_failed_${response.status}:${payload?.error?.message ?? "runtime_error"}`);
  return payload?.result?.structuredContent ?? payload?.result;
}
async function callExternal(input) {
  const { targetHost, routePath, scope, method = "POST", headers = {}, bodyType, body, payload, timeoutMs = 45000 } = input ?? {};
  const legacyBodyOnly = !("method" in (input ?? {})) && !("headers" in (input ?? {})) && !("bodyType" in (input ?? {})) && !("body" in (input ?? {})) && !("timeoutMs" in (input ?? {}));
  if (typeof targetHost !== "string" || !/^[A-Za-z0-9.-]{3,255}$/.test(targetHost) || targetHost.endsWith(".")) throw new Error("external_target_hostname_invalid");
  if (typeof routePath !== "string" || !routePath.startsWith("/") || routePath.startsWith("//") || routePath.includes("#")) throw new Error("external_route_path_invalid");
  if (typeof scope !== "string" || scope.length < 2) throw new Error("external_scope_invalid");
  const normalizedMethod = String(method || "POST").toUpperCase();
  if (!["GET","POST","PUT","PATCH","DELETE","HEAD"].includes(normalizedMethod)) throw new Error("external_http_method_invalid");
  const targetKey = `generated-${crypto.createHash("sha256").update(targetHost.toLowerCase()).digest("hex").slice(0, 24)}`;
  const response = await fetch(`https://${componentHostname}/v2/component-outbound-pulse`, {
    method: "POST",
    headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ targetKey, routePath, scopeName: scope, method: normalizedMethod, headers, bodyType, body, payload, timeoutMs }),
    signal: AbortSignal.timeout(Math.min(Math.max(Number(timeoutMs) || 45000, 100), 300000))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.accepted !== true) throw new Error(`external_call_failed_${response.status}:${result?.error ?? result?.code ?? "runtime_error"}`);
  if (legacyBodyOnly) return result.response;
  return { statusCode: Number(result.statusCode), headers: result.headers ?? {}, body: result.body, response: result.response };
}

let sandbox;
let handlerDescription;
try {
  sandbox = new GeneratedHandlerSandbox({
    handlerPath,
    componentCode,
    capabilities: { secret: resolveRuntimeSecret, callComponent, callExternal, stateGet, stateSet, stateDelete }
  });
  handlerDescription = await sandbox.ready;
} catch (error) {
  // Keep a bounded, secret-free startup diagnosis for the generation worker.
  // The runtime token and provider payloads are never part of this message.
  const detail = String(error instanceof Error ? error.message : error)
    .replace(/kca_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(-2000);
  await writeFile(resolve(stateDir, "startup-error.txt"), detail, { mode: 0o640 }).catch(() => undefined);
  throw error;
}
if (!Array.isArray(handlerDescription?.tools)) throw new Error("generated_handler_contract_invalid");
function toolDefinitions() { return handlerDescription.tools; }
async function customStates() {
  const value = handlerDescription.hasStates ? await sandbox.dispatch("states", {}) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("generated_handler_states_invalid");
  return value;
}
async function statePayload() { return { componentCode, enabled, startedAt, lastInvocationAt, requestCount, pid: process.pid, states: await customStates() }; }

const server = http.createServer(async (request, reply) => {
  try {
    const url = new URL(request.url || "/", "http://local");
    if (request.method === "GET" && url.pathname === "/health") return json(reply, 200, { ok: true, componentCode });
    if (request.method === "GET" && url.pathname === "/ready") return json(reply, enabled ? 200 : 503, { ready: enabled, componentCode });
    if (!authorized(request)) return json(reply, 401, { error: "invalid_client" });
    if (request.method === "POST" && url.pathname === "/v1/kcml/control/enable") { enabled = true; await persistMode(); return json(reply, 200, { status: "ACKED", enabled, state: await statePayload() }); }
    if (request.method === "POST" && url.pathname === "/v1/kcml/control/disable") { enabled = false; await persistMode(); return json(reply, 200, { status: "ACKED", enabled, state: await statePayload() }); }
    if (request.method === "POST" && url.pathname === "/v1/kcml/control/state") {
      const input = await body(request);
      return json(reply, 200, { status: "ACKED", state: await statePayload(), states: await customStates(), ...input });
    }
    if (request.method === "POST" && url.pathname === "/v1/kcml/control/heartbeat") {
      const input = await body(request); const state = await statePayload();
      return json(reply, 200, { status: "ACKED", heartbeatAt: new Date().toISOString(), operationalState: enabled ? "HEALTHY" : "DISABLED", stateDigest: `sha256:${crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex")}`, state, ...input });
    }
    if (request.method === "POST" && url.pathname === "/v1/kcml/runtime/endpoint") {
      if (!enabled) return json(reply, 503, { error: "component_disabled" });
      if (!handlerDescription.hasEndpoint) return json(reply, 404, { error: "endpoint_handler_not_declared" });
      const input = await body(request); requestCount += 1; lastInvocationAt = new Date().toISOString();
      const result = await sandbox.dispatch("endpoint", { endpointKey: String(input.endpointKey || ""), request: input.request ?? {} });
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("endpoint_handler_result_invalid");
      const statusCode = Number(result.statusCode ?? 200);
      if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) throw new Error("endpoint_handler_status_invalid");
      return json(reply, 200, { statusCode, headers: result.headers ?? {}, body: result.body ?? null });
    }
    if (request.method === "POST" && url.pathname === "/v1/kcml/runtime/pulse") {
      if (!enabled) return json(reply, 503, { error: "component_disabled" });
      if (!handlerDescription.hasPulse) return json(reply, 404, { error: "pulse_handler_not_declared" });
      const input = await body(request); requestCount += 1; lastInvocationAt = new Date().toISOString();
      return json(reply, 200, { result: await sandbox.dispatch("pulse", { direction: String(input.direction || ""), pulseType: String(input.pulseType || ""), payload: input.payload ?? {} }) });
    }
    if (request.method === "POST" && url.pathname === "/v1/kcml/runtime/transition") {
      if (!enabled) return json(reply, 503, { error: "component_disabled" });
      if (!handlerDescription.hasTransition) return json(reply, 404, { error: "state_transition_handler_not_declared" });
      const input = await body(request);
      const result = await sandbox.dispatch("transition", { from: String(input.from || ""), to: String(input.to || ""), trigger: String(input.trigger || "") });
      return json(reply, 200, { result, states: await customStates() });
    }
    if (request.method === "POST" && url.pathname === "/v1/kcml/runtime/secret-probe") {
      const input = await body(request); const name = String(input.name || "");
      if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(name)) return json(reply, 400, { error: "secret_name_invalid" });
      const value = await resolveRuntimeSecret(name);
      return json(reply, 200, { name, fingerprint: `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`, resolved: true });
    }
    if (request.method === "POST" && url.pathname === "/v1/kcml/runtime/storage-probe") {
      const probeName = `.kcml-storage-probe-${crypto.randomUUID()}`; const probePath = resolve(stateDir, probeName); const value = crypto.randomBytes(32).toString("hex");
      await writeFile(probePath, value, { mode: 0o600 }); const roundTrip = await readFile(probePath, "utf8"); await rm(probePath, { force: true });
      if (roundTrip !== value) throw new Error("persistent_storage_roundtrip_mismatch");
      return json(reply, 200, { persistent: true, stateDir, digest: `sha256:${crypto.createHash("sha256").update(roundTrip).digest("hex")}` });
    }
    if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/v1/mcp")) {
      const rpc = await body(request);
      if (rpc?.jsonrpc !== "2.0" || typeof rpc?.method !== "string") return json(reply, 400, { jsonrpc: "2.0", id: rpc?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
      if (rpc.method === "initialize") return json(reply, 200, { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: componentCode, version: "1.0.0" } } });
      if (rpc.method === "notifications/initialized") return reply.writeHead(204).end();
      if (rpc.method === "tools/list") return json(reply, 200, { jsonrpc: "2.0", id: rpc.id, result: { tools: toolDefinitions() } });
      if (rpc.method === "tools/call") {
        if (!enabled) return json(reply, 503, { jsonrpc: "2.0", id: rpc.id, error: { code: -32001, message: "Component disabled" } });
        const name = rpc?.params?.name; const args = rpc?.params?.arguments ?? {};
        if (!handlerDescription.tools.some((tool) => tool.name === name)) return json(reply, 404, { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Tool not found" } });
        requestCount += 1; lastInvocationAt = new Date().toISOString();
        const result = await sandbox.dispatch("invoke", { name, arguments: args });
        return json(reply, 200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
      }
      return json(reply, 404, { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
    }
    return json(reply, 404, { error: "not_found" });
  } catch (error) {
    return json(reply, 500, { error: "runtime_failure", message: error instanceof Error ? error.message : "unknown" });
  }
});
server.listen(socketPath, () => process.stdout.write(`generated runtime ${componentCode} listening on ${socketPath}\n`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(async () => { await sandbox.close(); process.exit(0); }));
