import { readFile, readdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import readline from "node:readline";
import vm from "node:vm";

const componentCode = String(process.argv[2] || "");
if (!/^kcml[0-9]{4,}$/i.test(componentCode)) throw new Error("handler_sandbox_component_code_invalid");

const pendingCapabilities = new Map();
let nextCapabilityId = 1;

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function bridgeStart(operation, payloadJson) {
  const id = nextCapabilityId++;
  pendingCapabilities.set(id, { state: "PENDING" });
  try {
    if (typeof operation !== "string" || typeof payloadJson !== "string" || payloadJson.length > 1024 * 1024) {
      pendingCapabilities.set(id, { state: "DONE", ok: false, error: "sandbox_capability_request_invalid" });
      return id;
    }
    emit({ type: "capability", id, operation, payloadJson });
  } catch {
    pendingCapabilities.set(id, { state: "DONE", ok: false, error: "sandbox_capability_dispatch_failed" });
  }
  return id;
}
function bridgePoll(id) {
  const current = pendingCapabilities.get(Number(id));
  if (!current) return '{"state":"DONE","ok":false,"error":"sandbox_capability_unknown"}';
  if (current.state === "PENDING") return '{"state":"PENDING"}';
  pendingCapabilities.delete(Number(id));
  return JSON.stringify(current);
}
Object.setPrototypeOf(bridgeStart, null);
Object.setPrototypeOf(bridgePoll, null);
Object.freeze(bridgeStart);
Object.freeze(bridgePoll);

const globalObject = Object.create(null);
Object.defineProperties(globalObject, {
  __kcmlBridgeStart: { value: bridgeStart, writable: false, configurable: false, enumerable: false },
  __kcmlBridgePoll: { value: bridgePoll, writable: false, configurable: false, enumerable: false }
});
const context = vm.createContext(globalObject, {
  name: "kcml-generated-handler",
  codeGeneration: { strings: false, wasm: false }
});

const bridgeSource = `
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const waitArray = new Int32Array(new SharedArrayBuffer(4));
const wait = async () => { const value = Atomics.waitAsync(waitArray, 0, 0, 2).value; if (value && typeof value.then === 'function') await value; };
async function bridge(operation, payload) {
  const id = __kcmlBridgeStart(operation, jsonStringify(payload ?? null));
  for (;;) {
    const result = jsonParse(__kcmlBridgePoll(id));
    if (result.state === 'PENDING') { await wait(); continue; }
    if (!result.ok) throw new Error(String(result.error || 'capability_failed'));
    return jsonParse(result.payloadJson || 'null');
  }
}
function hardened(fn) { Object.setPrototypeOf(fn, null); return Object.freeze(fn); }
const state = Object.create(null);
Object.defineProperties(state, {
  get: { value: hardened(async (key) => bridge('state.get', { key })), enumerable: true },
  set: { value: hardened(async (key, value) => bridge('state.set', { key, value })), enumerable: true },
  delete: { value: hardened(async (key) => bridge('state.delete', { key })), enumerable: true }
});
Object.freeze(state);
const handlerContext = Object.create(null);
Object.defineProperties(handlerContext, {
  componentCode: { value: ${JSON.stringify(componentCode)}, enumerable: true },
  secret: { value: hardened(async (name) => bridge('secret', { name })), enumerable: true },
  callComponent: { value: hardened(async (request) => bridge('callComponent', request)), enumerable: true },
  callExternal: { value: hardened(async (request) => bridge('callExternal', request)), enumerable: true },
  state: { value: state, enumerable: true }
});
Object.freeze(handlerContext);
export { handlerContext, jsonParse, jsonStringify };
`;
const bridgeModule = new vm.SourceTextModule(bridgeSource, { context, identifier: "kcml:bridge" });
const source = await readFile("/app/handler.mjs", "utf8");
const handlerModule = new vm.SourceTextModule(source, {
  context,
  identifier: "kcml:generated-handler",
  importModuleDynamically: async () => { throw "generated_handler_dynamic_import_forbidden"; }
});
const entrySource = `
import * as handler from 'kcml:handler';
import { handlerContext, jsonParse, jsonStringify } from 'kcml:bridge';
function ensureContract() {
  if (!Array.isArray(handler.tools)) throw new Error('generated_handler_contract_invalid:tools_export_missing');
  if (typeof handler.invoke !== 'function') throw new Error('generated_handler_contract_invalid:invoke_export_missing');
  for (const tool of handler.tools) {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !tool.name) throw new Error('generated_handler_contract_invalid:tool_definition_invalid');
  }
}
function toolDefinitions() {
  return handler.tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }));
}
export async function dispatch(kind, payloadJson) {
  ensureContract();
  const payload = jsonParse(payloadJson || '{}');
  let result;
  if (kind === 'describe') result = { tools: toolDefinitions(), hasStates: typeof handler.states === 'function', hasEndpoint: typeof handler.handleEndpoint === 'function', hasPulse: typeof handler.handlePulse === 'function', hasTransition: typeof handler.transition === 'function' };
  else if (kind === 'invoke') result = await handler.invoke(String(payload.name || ''), payload.arguments ?? {}, handlerContext);
  else if (kind === 'states') result = typeof handler.states === 'function' ? await handler.states(handlerContext) : {};
  else if (kind === 'endpoint') { if (typeof handler.handleEndpoint !== 'function') throw new Error('endpoint_handler_not_declared'); result = await handler.handleEndpoint(String(payload.endpointKey || ''), payload.request ?? {}, handlerContext); }
  else if (kind === 'pulse') { if (typeof handler.handlePulse !== 'function') throw new Error('pulse_handler_not_declared'); result = await handler.handlePulse(String(payload.direction || ''), String(payload.pulseType || ''), payload.payload ?? {}, handlerContext); }
  else if (kind === 'transition') { if (typeof handler.transition !== 'function') throw new Error('state_transition_handler_not_declared'); result = await handler.transition(String(payload.from || ''), String(payload.to || ''), String(payload.trigger || ''), handlerContext); }
  else throw new Error('sandbox_dispatch_unknown');
  return jsonStringify(result ?? null);
}
`;
const entryModule = new vm.SourceTextModule(entrySource, { context, identifier: "kcml:entry" });
await entryModule.link(async (specifier, referencingModule) => {
  if (referencingModule.identifier === "kcml:entry" && specifier === "kcml:handler") return handlerModule;
  if (referencingModule.identifier === "kcml:entry" && specifier === "kcml:bridge") return bridgeModule;
  throw "generated_handler_import_forbidden";
});
await entryModule.evaluate({ timeout: 5000 });
const dispatch = entryModule.namespace.dispatch;
const description = JSON.parse(await dispatch("describe", "{}"));
let rootWriteDenied = false;
try { await writeFile("/kcml-sandbox-write-probe", "forbidden"); } catch { rootWriteDenied = true; }
const isolation = {
  pid: process.pid,
  rootEntries: (await readdir("/")).sort(),
  hostEtcVisible: await readFile("/etc/passwd", "utf8").then(() => true).catch(() => false),
  rootWriteDenied,
  networkInterfaces: Object.keys(networkInterfaces()).sort(),
  environmentKeys: Object.keys(process.env).sort()
};
emit({ type: "ready", description, isolation });

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message?.type === "capability-result") {
    pendingCapabilities.set(Number(message.id), message.ok
      ? { state: "DONE", ok: true, payloadJson: typeof message.payloadJson === "string" ? message.payloadJson : "null" }
      : { state: "DONE", ok: false, error: String(message.error || "sandbox_capability_failed") });
    return;
  }
  if (message?.type !== "dispatch") return;
  try {
    const payloadJson = await dispatch(String(message.kind), String(message.payloadJson || "{}"));
    emit({ type: "dispatch-result", id: message.id, ok: true, payloadJson });
  } catch (error) {
    emit({ type: "dispatch-result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
