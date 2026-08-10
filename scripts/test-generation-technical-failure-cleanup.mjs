#!/usr/bin/env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { recoverGenerationTechnicalFailure } from "../apps/server/src/generation/generation-failure-recovery.mjs";
import { switchGeneratedCandidateRuntime } from "../apps/server/src/generation/generation-release-cleanup.mjs";

const MAX = 5;

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function makeFixture({ previous = false, jobKind = "CREATE", phase = "VALIDATING", attempts = 1 }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kcml-failure-cleanup-"));
  const candidatePath = path.join(root, "release-candidate");
  const basePath = path.join(root, "release-base");
  const currentPath = path.join(root, "current");
  await mkdir(candidatePath, { recursive: true });
  if (previous) await mkdir(basePath, { recursive: true });
  await symlink(candidatePath, currentPath);

  const releases = {
    candidate: { state: "ACTIVE", path: candidatePath, revisionId: "revision-candidate", previousReleaseId: previous ? "base" : null },
    base: previous ? { state: "SUPERSEDED", path: basePath, revisionId: "revision-base" } : null
  };
  const baseComponent = {
    activeRevisionId: previous ? "revision-base" : null,
    lifecycleState: "ACTIVE",
    activationState: "ACTIVE",
    operationalState: "HEALTHY",
    monitoringState: "HEALTHY",
    enabled: true,
    ingressEnabled: true,
    pulseEnabled: true,
    egressEnabled: true
  };
  const component = previous ? { ...baseComponent, activeRevisionId: "revision-candidate" } : {
    activeRevisionId: "revision-candidate", lifecycleState: "REGISTERED", activationState: "READY_FOR_ACTIVATION",
    operationalState: "STARTING", monitoringState: "UNKNOWN", enabled: false, ingressEnabled: true, pulseEnabled: true, egressEnabled: true
  };
  const log = [];
  let state = phase;
  async function spawnRuntime() {
    const next = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    await once(next, "spawn");
    return next;
  }
  let child = await spawnRuntime();
  let runtimeRelease = "candidate";

  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  async function runPrivileged(operation) {
    log.push(`runtime:${operation}`);
    if (operation === "stop") {
      await stopChild();
      runtimeRelease = null;
      return;
    }
    if (operation === "restart") {
      await stopChild();
      const link = await readlink(currentPath);
      runtimeRelease = path.resolve(root, link) === path.resolve(basePath) ? "base" : "candidate";
      child = await spawnRuntime();
    }
  }
  async function cleanupCandidate() {
    if (releases.candidate.state !== "ACTIVE") return;
    log.push("cleanup:start");
    await switchGeneratedCandidateRuntime({
      currentPath,
      previousReleasePath: previous ? basePath : null,
      componentCode: "kcml9999",
      runPrivileged
    });
    releases.candidate.state = "ROLLED_BACK";
    if (previous) {
      releases.base.state = "ACTIVE";
      component.activeRevisionId = releases.base.revisionId;
    }
    log.push("cleanup:complete");
  }
  async function restoreRepairBase() {
    if (jobKind !== "REPAIR") return;
    Object.assign(component, baseComponent);
    log.push("repair-base:restored");
  }

  async function runRecovery() {
    return recoverGenerationTechnicalFailure({
      phase,
      jobKind,
      attempts,
      maxAttempts: MAX,
      componentIds: ["component-1"],
      errorMessage: "fixture_failure",
      setState: async (next) => { log.push(`state:${next}`); state = next; },
      appendEvent: async (_phase, eventType) => { log.push(`event:${eventType}`); },
      failClosedComponent: async () => { component.enabled = false; component.activationState = "BLOCKED"; log.push("component:fail-closed"); },
      cleanupCandidate,
      restoreRepairBase
    });
  }

  return {
    root, currentPath, candidatePath, basePath, releases, component, baseComponent, log,
    get state() { return state; },
    get runtimeRelease() { return runtimeRelease; },
    runRecovery,
    async deployNewCandidate() {
      assert.equal(releases.candidate.state, "ROLLED_BACK", "old candidate must be cleaned before remediation deploy");
      assert.equal(await exists(currentPath), false, "old current candidate link must be absent before remediation deploy");
      const nextPath = path.join(root, "release-remediation");
      await mkdir(nextPath, { recursive: true });
      await symlink(nextPath, currentPath);
      log.push("deploy:new-candidate");
      return nextPath;
    },
    async close() { await stopChild().catch(() => undefined); await rm(root, { recursive: true, force: true }); }
  };
}

// 1. First CREATE, no previous release: runtime stopped, current removed, release rolled back.
{
  const f = await makeFixture({ previous: false, jobKind: "CREATE", phase: "VALIDATING", attempts: 1 });
  try {
    const result = await f.runRecovery();
    assert.equal(result.action, "REIMPLEMENT");
    assert.equal(f.runtimeRelease, null, "first CREATE runtime remained alive");
    assert.equal(await exists(f.currentPath), false, "first CREATE current candidate link remained");
    assert.equal(f.releases.candidate.state, "ROLLED_BACK", "first CREATE candidate release remained ACTIVE");
    assert.equal(f.state, "IMPLEMENTING");
  } finally { await f.close(); }
}

// Activation failure preserves the existing CREATE fail-closed policy, but cleanup is now complete.
{
  const f = await makeFixture({ previous: false, jobKind: "CREATE", phase: "ACTIVATING", attempts: 1 });
  try {
    const result = await f.runRecovery();
    assert.equal(result.action, "FAILED");
    assert.equal(f.state, "FAILED");
    assert.equal(f.runtimeRelease, null);
    assert.equal(await exists(f.currentPath), false);
    assert.equal(f.releases.candidate.state, "ROLLED_BACK");
  } finally { await f.close(); }
}

// 2. CREATE remediation cannot deploy a new candidate until the old candidate is gone.
{
  const f = await makeFixture({ previous: false, jobKind: "CREATE", phase: "CML_CONFORMANCE", attempts: 2 });
  try {
    await f.runRecovery();
    const cleanupIndex = f.log.indexOf("cleanup:complete");
    const implementingIndex = f.log.indexOf("state:IMPLEMENTING");
    assert.ok(cleanupIndex >= 0 && implementingIndex > cleanupIndex, "worker resumed IMPLEMENTING before candidate cleanup completed");
    const nextPath = await f.deployNewCandidate();
    assert.equal(path.resolve(await readlink(f.currentPath)), path.resolve(nextPath), "new remediation candidate did not get a clean current link");
  } finally { await f.close(); }
}

// 3. REPAIR candidate failure restores the previous release before reimplementation.
{
  const f = await makeFixture({ previous: true, jobKind: "REPAIR", phase: "CML_CONFORMANCE", attempts: 1 });
  try {
    const result = await f.runRecovery();
    assert.equal(result.action, "REIMPLEMENT");
    assert.equal(f.releases.candidate.state, "ROLLED_BACK");
    assert.equal(f.releases.base.state, "ACTIVE");
    assert.equal(path.resolve(await readlink(f.currentPath)), path.resolve(f.basePath), "repair did not restore previous current symlink");
    assert.equal(f.runtimeRelease, "base", "repair did not restart previous runtime");
    assert.equal(f.component.activeRevisionId, "revision-base");
    assert.equal(f.component.enabled, true, "repair base state was not restored before remediation");
  } finally { await f.close(); }
}

// 4. Terminal REPAIR failure restores both the base release and captured lifecycle/control state.
{
  const f = await makeFixture({ previous: true, jobKind: "REPAIR", phase: "ACTIVATING", attempts: MAX + 1 });
  try {
    const result = await f.runRecovery();
    assert.equal(result.action, "FAILED");
    assert.equal(f.state, "FAILED");
    assert.equal(f.releases.base.state, "ACTIVE");
    assert.equal(f.releases.candidate.state, "ROLLED_BACK");
    assert.equal(path.resolve(await readlink(f.currentPath)), path.resolve(f.basePath));
    assert.deepEqual(f.component, f.baseComponent, "terminal repair left component lifecycle/control state altered");
    assert.ok(f.log.indexOf("component:fail-closed") < f.log.indexOf("repair-base:restored"), "repair base state was not restored after fail-closed activation handling");
  } finally { await f.close(); }
}

// Ordinary INTEGRATING retry keeps the same live candidate, as required.
{
  const f = await makeFixture({ previous: false, jobKind: "CREATE", phase: "INTEGRATING", attempts: 1 });
  try {
    const result = await f.runRecovery();
    assert.equal(result.action, "RETRY_INTEGRATING");
    assert.equal(f.releases.candidate.state, "ACTIVE");
    assert.equal(await exists(f.currentPath), true);
    assert.equal(f.runtimeRelease, "candidate");
  } finally { await f.close(); }
}

console.log("PASS technical failure cleanup removes first CREATE candidate before remediation and restores REPAIR base release/state");
