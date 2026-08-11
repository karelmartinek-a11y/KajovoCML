#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GeneratedHandlerSandbox } from "../apps/server/src/generation/handler-sandbox.mjs";
const selfPath = fileURLToPath(import.meta.url);

if (process.platform !== "linux") {
  console.log(`UNSUPPORTED generated handler capability sandbox requires Linux namespaces/chroot; current platform is ${process.platform}`);
  process.exit(0);
}

if (typeof process.getuid === "function" && process.getuid() !== 0 && process.env.KCML_SANDBOX_TEST_ELEVATED !== "1") {
  const elevated = spawnSync("/usr/bin/sudo", ["-n", "env", `PATH=${process.env.PATH || "/usr/bin:/usr/sbin:/bin:/sbin"}`, "KCML_SANDBOX_TEST_ELEVATED=1", process.execPath, selfPath], { stdio: "inherit" });
  if (elevated.status === 0) process.exit(0);
  if (elevated.status !== null) process.exit(elevated.status);
  throw elevated.error ?? new Error("generated_handler_sandbox_sudo_failed");
}

for (const binary of ["/usr/bin/unshare", "/usr/bin/mount", "/usr/sbin/chroot"]) {
  try {
    await access(binary);
  } catch {
    console.log(`UNSUPPORTED generated handler capability sandbox missing required binary: ${binary}`);
    process.exit(0);
  }
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "kcml-handler-capabilities-"));
const handlerPath = path.join(tmp, "handler.mjs");
const tool = (name) => ({name,title:name,description:name,inputSchema:{type:"object",additionalProperties:true},outputSchema:{type:"object",additionalProperties:true}});
await writeFile(handlerPath, `
export const tools=${JSON.stringify(["echo","directFetch","processEnv","nodeNetwork","filesystem","childProcess","dynamicImport","evalCode","external","component","state"].map(tool))};
export async function invoke(name,args,context){
  if(name==='echo') return {value:args.value};
  if(name==='directFetch') return await fetch('https://example.com');
  if(name==='processEnv') return {path:process.env.PATH};
  if(name==='nodeNetwork') { const mod=await import('node:https'); return {hasRequest:typeof mod.request==='function'}; }
  if(name==='filesystem') { const mod=await import('node:fs/promises'); return {text:await mod.readFile('/etc/passwd','utf8')}; }
  if(name==='childProcess') { const mod=await import('node:child_process'); return {out:mod.execSync('id').toString()}; }
  if(name==='dynamicImport') { await import('data:text/javascript,export default 1'); return {ok:true}; }
  if(name==='evalCode') return {value:eval('40+2')};
  if(name==='external') return await context.callExternal({targetHost:'provider.example',routePath:'/v1/messages',scope:'provider.send',payload:{value:args.value}});
  if(name==='component') return await context.callComponent({hostname:'kcml1234.kajovocml.hcasc.cz',tool:'lookup',arguments:{value:args.value}});
  if(name==='state') { await context.state.set('workflow',{step:args.value}); const value=await context.state.get('workflow'); await context.state.delete('workflow'); return {value}; }
  throw new Error('tool_not_found');
}
`, "utf8");

const calls = [];
const state = new Map();
const sandbox = new GeneratedHandlerSandbox({
  handlerPath,
  componentCode: "KCML9999",
  timeoutMs: 5000,
  capabilities: {
    secret: async () => { throw new Error("unused"); },
    callExternal: async (request) => { calls.push(["external",request]); return {via:"CML_EXTERNAL",accepted:true,value:request.payload.value}; },
    callComponent: async (request) => { calls.push(["component",request]); return {via:"CML_COMPONENT",value:request.arguments.value}; },
    stateGet: async (key) => state.has(key) ? state.get(key) : null,
    stateSet: async (key,value) => { state.set(key,value); return {ok:true}; },
    stateDelete: async (key) => { state.delete(key); return {ok:true}; }
  }
});

async function rejected(toolName, expected) {
  await assert.rejects(() => sandbox.dispatch("invoke", {name:toolName,arguments:{}}), (error) => {
    assert.match(String(error?.message ?? error), expected);
    return true;
  }, `${toolName} unexpectedly bypassed sandbox`);
}
try {
  await sandbox.ready;
  const isolation = sandbox.isolationEvidence;
  assert.equal(isolation?.pid, 1, "generated handler does not run in a private PID namespace");
  assert.equal(isolation?.hostEtcVisible, false, "sandbox unexpectedly exposes host /etc/passwd");
  assert.equal(isolation?.rootWriteDenied, true, "sandbox root filesystem is unexpectedly writable");
  assert.deepEqual(isolation?.environmentKeys, ["LANG", "PATH"], "sandbox inherited unexpected host environment variables");
  assert.ok((isolation?.networkInterfaces ?? []).every((name) => name === "lo"), "sandbox has a non-loopback network interface");
  assert.deepEqual(isolation?.rootEntries, ["app", "lib", "lib64", "node"], "sandbox exposes unexpected host filesystem roots");
  assert.deepEqual(await sandbox.dispatch("invoke", {name:"echo",arguments:{value:"KCML"}}), {value:"KCML"});
  await rejected("directFetch", /fetch is not defined/);
  await rejected("processEnv", /process is not defined/);
  await rejected("nodeNetwork", /generated_handler_dynamic_import_forbidden/);
  await rejected("filesystem", /generated_handler_dynamic_import_forbidden/);
  await rejected("childProcess", /generated_handler_dynamic_import_forbidden/);
  await rejected("dynamicImport", /generated_handler_dynamic_import_forbidden/);
  await rejected("evalCode", /Code generation from strings disallowed|EvalError|code generation/i);
  assert.deepEqual(await sandbox.dispatch("invoke", {name:"external",arguments:{value:7}}), {via:"CML_EXTERNAL",accepted:true,value:7});
  assert.deepEqual(await sandbox.dispatch("invoke", {name:"component",arguments:{value:9}}), {via:"CML_COMPONENT",value:9});
  assert.deepEqual(await sandbox.dispatch("invoke", {name:"state",arguments:{value:"READY"}}), {value:{step:"READY"}});
  assert.equal(state.size,0,"handler state delete did not use explicit state capability");
  assert.equal(calls.length,2);
  assert.equal(calls[0][0],"external");
  assert.equal(calls[1][0],"component");
} finally { await sandbox.close(); }

const staticImport = path.join(tmp,"static-import.mjs");
await writeFile(staticImport, `import https from 'node:https'; export const tools=[]; export async function invoke(){return {https:Boolean(https)}};`, "utf8");
const staticSandbox = new GeneratedHandlerSandbox({handlerPath:staticImport,componentCode:"KCML9999",timeoutMs:3000,capabilities:{}});
await assert.rejects(() => staticSandbox.ready, /generated_handler_import_forbidden|sandbox_exit/);
await staticSandbox.close().catch(()=>undefined);

const topLevelNetwork = path.join(tmp,"top-level-network.mjs");
await writeFile(topLevelNetwork, `await fetch('https://example.com'); export const tools=[]; export async function invoke(){return {ok:true}};`, "utf8");
const topLevelSandbox = new GeneratedHandlerSandbox({handlerPath:topLevelNetwork,componentCode:"KCML9999",timeoutMs:3000,capabilities:{}});
await assert.rejects(() => topLevelSandbox.ready, /fetch is not defined|sandbox_exit/);
await topLevelSandbox.close().catch(()=>undefined);
await rm(tmp,{recursive:true,force:true});
console.log("PASS generated handler capability sandbox blocks direct system/network bypass and preserves CML capabilities");
