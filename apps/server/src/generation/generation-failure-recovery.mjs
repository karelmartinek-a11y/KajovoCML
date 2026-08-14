/**
 * Canonical control flow for abandoning a generated candidate after a technical
 * failure. All concrete CML mutations are injected by the generation worker so
 * this remains the existing generation/release/control plane, not a new one.
 */
export async function recoverGenerationTechnicalFailure({
  phase,
  jobKind,
  attempts,
  maxAttempts,
  componentIds,
  errorMessage,
  eventDetails = {},
  setState,
  appendEvent,
  failClosedComponent,
  cleanupCandidate,
  restoreRepairBase
}) {
  if (phase === "INTEGRATING" && attempts <= maxAttempts) {
    await setState("INTEGRATING", { blocker: errorMessage, remediationAttempts: attempts });
    await appendEvent(
      "INTEGRATING",
      "generation.integration_remediation_scheduled",
      "Provider konfigurace technicky selhala; candidate zůstává nasazený a další integrační AI průchod pokračuje proti stejným živým HTTPS URL.",
      { attempt: attempts, error: errorMessage, ...eventDetails }
    );
    return { action: "RETRY_INTEGRATING", candidateAbandoned: false };
  }

  if (phase === "ACTIVATING") {
    for (const componentId of componentIds) {
      try { await failClosedComponent(componentId); } catch { /* cleanup below remains authoritative */ }
    }
  }

  // Once a candidate is abandoned, cleanup must complete before a new IMPLEMENTING
  // revision is allowed to start. The concrete callback handles both first CREATE
  // (stop + remove current + ROLLED_BACK) and previous-release rollback.
  for (const componentId of componentIds) await cleanupCandidate(componentId);

  // A repair must restore the component's captured base lifecycle/control state
  // after its candidate release has been removed/rolled back, including terminal failure.
  if (jobKind === "REPAIR" || jobKind === "RETRY") await restoreRepairBase();

  // Preserve the existing fail-closed CREATE activation policy: activation failure
  // terminates that job after cleanup. REPAIR keeps its established remediation loop.
  if (phase === "ACTIVATING" && jobKind !== "REPAIR" && jobKind !== "RETRY") {
    await setState("FAILED", { blocker: errorMessage, remediationAttempts: Math.min(attempts, maxAttempts) });
    await appendEvent(
      "FAILED",
      "generation.activation_failed",
      "Aktivace nebo veřejný HTTPS gate selhal; opuštěný candidate byl zastaven a lokální release rollbacknut.",
      { error: errorMessage, failedPhase: phase }
    );
    return { action: "FAILED", candidateAbandoned: true };
  }

  if (attempts <= maxAttempts) {
    await setState("IMPLEMENTING", { blocker: errorMessage, remediationAttempts: attempts });
    if (jobKind === "REPAIR" || jobKind === "RETRY") {
      await appendEvent(
        "IMPLEMENTING",
        "generation.repair_remediation_scheduled",
        "Repair candidate neprošel technickou kontrolou; poslední funkční release a base component stav byly obnoveny a spouští se další AI opravný průchod.",
        { attempt: attempts, error: errorMessage, failedPhase: phase, ...eventDetails }
      );
    } else {
      await appendEvent(
        "IMPLEMENTING",
        "generation.remediation_scheduled",
        "Technická kontrola neprošla; opuštěný candidate byl uklizen a spouští se autonomní opravný průchod.",
        { attempt: attempts, error: errorMessage, failedPhase: phase, ...eventDetails }
      );
    }
    return { action: "REIMPLEMENT", candidateAbandoned: true };
  }

  await setState("FAILED", { blocker: errorMessage, remediationAttempts: maxAttempts });
  await appendEvent(
    "FAILED",
    phase === "ACTIVATING" ? "generation.activation_failed" : "generation.failed",
    jobKind === "REPAIR" || jobKind === "RETRY"
      ? "Repair selhal po vyčerpání autonomních průchodů; poslední funkční release i uložený base component stav byly obnoveny."
      : "Generování selhalo po vyčerpání autonomních průchodů; opuštěný candidate byl zastaven a lokální release rollbacknut.",
    { error: errorMessage, failedPhase: phase, ...eventDetails }
  );
  return { action: "FAILED", candidateAbandoned: true };
}
