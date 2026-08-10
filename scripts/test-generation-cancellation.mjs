#!/usr/bin/env node
import assert from "node:assert/strict";
import { runWithCancellationPolling, throwIfCancellationSignalled } from "../apps/server/src/generation/generation-cancellation.mjs";

class Cancelled extends Error { constructor(){super("generation_job_cancelled");} }
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer=setTimeout(resolve,ms);
  const abort=()=>{clearTimeout(timer);reject(signal.reason)};
  if(signal?.aborted) abort(); else signal?.addEventListener("abort",abort,{once:true});
});

async function scenario(cancelAt) {
  let dbState="IMPLEMENTING";
  let currentRelease="release-old";
  let candidateRelease=null;
  let activationAttempts=0;
  let completed=false;
  const run=runWithCancellationPolling({
    assertActive: async()=>{if(dbState==="CANCELLED")throw new Cancelled();},
    isCancelled:(error)=>error instanceof Cancelled,
    pollMs:10,
    operation:async(signal)=>{
      throwIfCancellationSignalled(signal,()=>new Cancelled());
      candidateRelease="release-candidate";
      await sleep(80,signal);
      throwIfCancellationSignalled(signal,()=>new Cancelled());
      dbState="VALIDATING";
      await sleep(80,signal);
      throwIfCancellationSignalled(signal,()=>new Cancelled());
      activationAttempts+=1;
      currentRelease=candidateRelease;
      completed=true;
    }
  }).catch((error)=>{
    if(!(error instanceof Cancelled))throw error;
    candidateRelease=null;
  });
  setTimeout(()=>{dbState="CANCELLED";},cancelAt);
  await run;
  assert.equal(dbState,"CANCELLED");
  assert.equal(currentRelease,"release-old","cancel damaged/replaced active release");
  assert.equal(candidateRelease,null,"candidate was not cleaned after cancel");
  assert.equal(activationAttempts,0,"cancelled worker reached activation");
  assert.equal(completed,false,"cancelled worker completed");
}

await scenario(20);   // during implementation/model/tool work
await scenario(120);  // after implementation, before activation

const stateStore={state:"CANCELLED"};
const guardedSet=(next)=>{ if(stateStore.state==="CANCELLED") throw new Cancelled(); stateStore.state=next; };
assert.throws(()=>guardedSet("ACTIVATING"),/generation_job_cancelled/);
assert.equal(stateStore.state,"CANCELLED","CANCELLED was overwritten");
console.log("PASS generation cancellation aborts implementation/pre-activation and preserves active release");
