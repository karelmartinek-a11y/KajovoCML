#!/usr/bin/env node
import http from "node:http";
const [socketPath,token]=process.argv.slice(2); if(!socketPath||!token) process.exit(2);
function request(method,path,body){return new Promise((resolve,reject)=>{const payload=body?Buffer.from(JSON.stringify(body)):null;const req=http.request({socketPath,path,method,headers:{authorization:`Bearer ${token}`,...(payload?{"content-type":"application/json","content-length":payload.length}:{})}},res=>{const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.on("error",reject);if(payload)req.write(payload);req.end();});}
for(const [method,path,body] of [["GET","/health"],["GET","/ready"],["POST","/v1/kcml/control/state",{}],["POST","/v1/kcml/control/heartbeat",{}]]){const r=await request(method,path,body);if(r.status<200||r.status>=300)throw new Error(`${path}:${r.status}:${r.body}`);} process.stdout.write("PASS\n");
