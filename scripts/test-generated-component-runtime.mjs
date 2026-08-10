#!/usr/bin/env node
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

if (process.platform !== "linux") {
  console.log(`UNSUPPORTED generated component runtime fixture requires Linux sandbox runtime; current platform is ${process.platform}`);
  process.exit(0);
}

const root = await mkdtemp(path.join(tmpdir(), "kcml-generated-runtime-"));
const socketPath = path.join(root, "runtime.sock");
const stateDir = path.join(root, "state");
const credentials = path.join(root, "credentials");
const handler = path.join(root, "handler.mjs");
const runtime = path.resolve("apps/server/src/generation/runtime-host.mjs");
await mkdir(credentials, { recursive: true });
await mkdir(stateDir, { recursive: true });
await writeFile(handler, `let workflow="IDLE";
export const tools=[
{name:"echo",title:"Echo",description:"Deterministic echo",inputSchema:{type:"object",properties:{value:{}},required:["value"],additionalProperties:false},outputSchema:{type:"object",properties:{value:{}},required:["value"],additionalProperties:false}},
{name:"stateStore",title:"State store",description:"Store through bounded context state",inputSchema:{type:"object",properties:{value:{}},required:["value"],additionalProperties:false},outputSchema:{type:"object",additionalProperties:true}},
{name:"stateRead",title:"State read",description:"Read through bounded context state",inputSchema:{type:"object",properties:{},additionalProperties:false},outputSchema:{type:"object",additionalProperties:true}}
];
export async function invoke(name,args,context){
 if(name==="echo")return {value:args.value};
 if(name==="stateStore"){await context.state.set("runtime-test",{value:args.value});return {stored:true};}
 if(name==="stateRead")return {value:await context.state.get("runtime-test")};
 throw new Error("tool_not_found");
}
export async function states(){return {workflow};}
export async function transition(from,to){if(from!==workflow)throw new Error("state_mismatch");workflow=to;return {from,to};}
export async function handleEndpoint(key,request){return {statusCode:202,headers:{"x-generated-endpoint":key},body:{endpoint:key,body:request.body??null}};}
export async function handlePulse(direction,pulseType,payload){return {direction,pulseType,payload};}
`);

function token() { return `kca_${crypto.randomBytes(64).toString("base64url")}`; }
let runtimeToken = token();
await writeFile(path.join(credentials, "runtime_token"), runtimeToken, { mode: 0o600 });

async function request(method, urlPath, bearer, payload) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = http.request({ socketPath, method, path: urlPath, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body ? { "content-type": "application/json", "content-length": body.length } : {}) } }, (res) => {
      const chunks=[]; res.on("data",(c)=>chunks.push(c)); res.on("end",()=>{ const raw=Buffer.concat(chunks).toString(); let json={}; try{json=raw?JSON.parse(raw):{};}catch{} resolve({status:res.statusCode,json}); });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

async function waitReady(expected = 200) {
  const end=Date.now()+5000;
  while(Date.now()<end){try{const r=await request("GET","/ready");if(r.status===expected)return;}catch{} await new Promise(r=>setTimeout(r,50));}
  throw new Error(`runtime_not_ready_${expected}`);
}

function start() {
  return spawn(process.execPath,[runtime],{env:{...process.env,KCML_RUNTIME_SOCKET:socketPath,KCML_COMPONENT_CODE:"KCML9999",KCML_COMPONENT_HOSTNAME:"kcml9999.example.invalid",KCML_HANDLER_PATH:handler,KCML_STATE_DIR:stateDir,KCML_SECRET_API_BASE:"https://secrets.example.invalid",CREDENTIALS_DIRECTORY:credentials},stdio:["ignore","pipe","pipe"]});
}
async function stop(child){ if(child.exitCode!==null)return; child.kill("SIGTERM"); await new Promise(r=>child.once("close",r)); }
function assert(condition,message){if(!condition)throw new Error(message);}

let child=start();
try {
  await waitReady(200);
  assert((await request("POST","/mcp",undefined,{jsonrpc:"2.0",id:1,method:"tools/list",params:{}})).status===401,"missing token was not rejected");
  assert((await request("POST","/mcp",token(),{jsonrpc:"2.0",id:2,method:"tools/list",params:{}})).status===401,"wrong token was not rejected");
  const init=await request("POST","/mcp",runtimeToken,{jsonrpc:"2.0",id:3,method:"initialize",params:{}}); assert(init.status===200,"initialize failed");
  const list=await request("POST","/mcp",runtimeToken,{jsonrpc:"2.0",id:4,method:"tools/list",params:{}}); assert(list.status===200 && list.json.result.tools[0].name==="echo","tools/list failed");
  const call=await request("POST","/mcp",runtimeToken,{jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"echo",arguments:{value:"KCML"}}}); assert(call.status===200 && call.json.result.structuredContent.value==="KCML","real tool invocation failed");
  const stateStore=await request("POST","/mcp",runtimeToken,{jsonrpc:"2.0",id:51,method:"tools/call",params:{name:"stateStore",arguments:{value:"PERSISTED"}}}); assert(stateStore.status===200 && stateStore.json.result.structuredContent.stored===true,"bounded context state write failed");
  const endpoint=await request("POST","/v1/kcml/runtime/endpoint",runtimeToken,{endpointKey:"webhook",request:{body:{value:"callback"}}}); assert(endpoint.status===200 && endpoint.json.statusCode===202 && endpoint.json.body.body.value==="callback","endpoint dispatch failed");
  const pulse=await request("POST","/v1/kcml/runtime/pulse",runtimeToken,{direction:"INCOMING",pulseType:"test.pulse",payload:{value:1}}); assert(pulse.status===200 && pulse.json.result.pulseType==="test.pulse","pulse dispatch failed");
  const transition=await request("POST","/v1/kcml/runtime/transition",runtimeToken,{from:"IDLE",to:"READY",trigger:"test"}); assert(transition.status===200 && transition.json.states.workflow==="READY","state transition failed");
  const storage=await request("POST","/v1/kcml/runtime/storage-probe",runtimeToken,{}); assert(storage.status===200 && storage.json.persistent===true,"storage round-trip failed");
  const state=await request("POST","/v1/kcml/control/state",runtimeToken,{}); assert(state.status===200 && state.json.states.workflow==="READY","state snapshot failed");
  assert((await request("POST","/v1/kcml/control/heartbeat",runtimeToken,{})).status===200,"heartbeat failed");
  assert((await request("POST","/v1/kcml/control/disable",runtimeToken,{})).status===200,"disable failed");
  assert((await request("GET","/ready")).status===503,"disable did not close readiness");
  await stop(child); child=start(); await waitReady(503);
  assert((await request("POST","/v1/kcml/control/enable",runtimeToken,{})).status===200,"enable failed"); await waitReady(200);
  const stateRead=await request("POST","/mcp",runtimeToken,{jsonrpc:"2.0",id:52,method:"tools/call",params:{name:"stateRead",arguments:{}}}); assert(stateRead.status===200 && stateRead.json.result.structuredContent.value.value==="PERSISTED","bounded context state did not persist across runtime restart");
  const previous=runtimeToken; runtimeToken=token(); await writeFile(path.join(credentials,"runtime_token"),runtimeToken,{mode:0o600});
  await stop(child); child=start(); await waitReady(200);
  assert((await request("POST","/mcp",previous,{jsonrpc:"2.0",id:6,method:"tools/list",params:{}})).status===401,"rotated token remained valid in runtime");
  assert((await request("POST","/mcp",runtimeToken,{jsonrpc:"2.0",id:7,method:"tools/list",params:{}})).status===200,"new token was not accepted");
  process.stdout.write("generated-component-runtime:PASS\n");
} finally {
  await stop(child).catch(()=>undefined); await rm(root,{recursive:true,force:true});
}
