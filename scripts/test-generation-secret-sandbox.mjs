#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GeneratedHandlerSandbox } from "../apps/server/src/generation/handler-sandbox.mjs";

if (process.platform !== "linux") throw new Error("generation_secret_sandbox_linux_required");
if (typeof process.getuid === "function" && process.getuid() !== 0) throw new Error("generation_secret_sandbox_root_required");

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-secret-sandbox-"));
const handlerPath = path.join(tmp, "handler.mjs");
await writeFile(handlerPath, `
export const tools=[{name:'secretEcho',title:'secretEcho',description:'secretEcho',inputSchema:{type:'object'},outputSchema:{type:'object'}}];
export async function invoke(name,args,context){ if(name!=='secretEcho') throw new Error('tool_not_found'); return {value:await context.secret('WHATSAPP_APP_SECRET')}; }
`, "utf8");

const sandbox = new GeneratedHandlerSandbox({
  handlerPath,
  componentCode: "KCML9999",
  timeoutMs: 5000,
  capabilities: {
    secret: async (name) => {
      if (name !== "WHATSAPP_APP_SECRET") throw new Error("secret_not_available");
      return "provider-v1";
    },
    callExternal: async () => { throw new Error("unused"); },
    callComponent: async () => { throw new Error("unused"); },
    stateGet: async () => null,
    stateSet: async () => ({ ok: true }),
    stateDelete: async () => ({ ok: true })
  }
});

try {
  assert.deepEqual(
    await sandbox.dispatch("invoke", { name: "secretEcho", arguments: {} }),
    { value: "provider-v1" },
    "generated runtime could not immediately use a provider-generated Secret Manager value"
  );
  console.log("PASS generated handler resolves provider secret only through bounded context.secret capability");
} finally {
  await sandbox.close();
  await rm(tmp, { recursive: true, force: true });
}
