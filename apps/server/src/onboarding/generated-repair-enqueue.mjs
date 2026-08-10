export function generatedRepairEnqueueAlertType(componentId) {
  return `component.repair.enqueue_failed.${componentId}`;
}

export async function attemptGeneratedRepairEnqueue({ enqueue, onFailure, onRecovered }) {
  try {
    const result = await enqueue();
    await onRecovered(result);
    return result;
  } catch (error) {
    await onFailure(error);
    return null;
  }
}

export async function attemptGeneratedRepairEnqueueWithCmlEvidence({
  componentId,
  correlationId,
  evidence,
  enqueue,
  withTransaction,
  raiseAlert,
  appendAudit,
  closeAlert,
  logEvidenceFailure = (payload) => console.error("generated_repair_enqueue_evidence_failed", payload),
  logCloseFailure = (payload) => console.error("generated_repair_enqueue_alert_close_failed", payload)
}) {
  const alertType = generatedRepairEnqueueAlertType(componentId);
  return attemptGeneratedRepairEnqueue({
    enqueue,
    onFailure: async (error) => {
      const technicalReason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      try {
        await withTransaction(async (client) => {
          await raiseAlert(client, {
            severity: "HIGH",
            alertType,
            title: "Automatickou opravu generated komponenty se nepodařilo založit",
            detail: { componentId, correlationId, technicalReason, source: evidence?.source ?? "component_monitoring" },
            correlationId
          });
          await appendAudit(client, {
            eventType: "generated_component.repair_enqueue_failed",
            actorType: "system",
            objectType: "component",
            objectId: componentId,
            after: { componentId, correlationId, technicalReason, evidence },
            correlationId
          });
        });
      } catch (recordError) {
        logEvidenceFailure({
          componentId,
          correlationId,
          repairError: technicalReason,
          evidenceError: recordError instanceof Error ? recordError.message : String(recordError)
        });
      }
    },
    onRecovered: async () => {
      try {
        await withTransaction(async (client) => closeAlert(client, { alertType, reason: "repair_enqueue_recovered", correlationId }));
      } catch (error) {
        logCloseFailure({ componentId, correlationId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}
