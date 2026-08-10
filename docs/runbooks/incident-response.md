# Incident Response Runbook

**Status:** ACTIVE — internal-generation/CML runtime model.

## Critical triggers

- Audit write or audit-chain integrity failure.
- Database unavailable or migration checksum mismatch.
- Cross-host routing or token-audience invariant failure.
- Generated component runtime/contract digest drift or failed CML conformance.
- Repeated backup/rollback failure.
- MCP invocation finalization failure or dead-lettered critical alert delivery.
- Expired recertification, missing active revision or required monitoring evidence.
- Generated runtime attempts or evidence of capability-boundary bypass.
- Secret grant/revocation inconsistency, unauthorized Secret Manager resolution, or persistent runtime credential embedded in source/release artifacts.
- External egress outside the configured CML target/route/scope permission.
- Repeated generated repair enqueue failure or repair rollback failure.

OWNER plaintext credentials in the trusted OWNER chat/log are not an incident by themselves. Persistent runtime credentials still belong in the existing KajovoCML Secret Manager.

## Immediate action

1. Identify the affected CML component/service and correlation ID from Dashboard, monitoring and audit.
2. Use the existing CML lifecycle control to disable/quarantine the affected interface/component when fail-closed containment is required.
3. Revoke/rotate the affected existing CML runtime identity, permission or Secret grant only when the incident requires it.
4. Preserve the active revision, local release/snapshot, runtime/monitoring evidence, audit events and correlation IDs.
5. Verify canonical HTTPS routing, authorization, heartbeat/state and monitoring evidence before restoration.
6. For an `INTERNAL_GENERATED` runtime/contract fault, inspect the existing repair generation job. If automatic repair cannot be enqueued, use the `component.repair.enqueue_failed.<componentId>` operational alert plus `generated_component.repair_enqueue_failed` audit evidence to diagnose the enqueue failure; the next normal monitoring cycle may retry.
7. If a repair candidate fails, preserve/restore the last functional local release. Do not invent PASS evidence or bypass CML conformance.
8. If OWNER cancels a generation/repair job, treat `CANCELLED` as authoritative: do not continue implementation/activation and preserve the previously functional active release.
9. Verify both alert delivery channels and the complete audit chain before service restoration.

Automatic return from a quarantined/blocked state is allowed only through the existing lifecycle rules and measured readiness/conformance required by the active CML model; no historical onboarding/CI artifact can substitute for those gates.

## Alert delivery failure

- Inspect `operational_alert` and `alert_webhook_delivery` for severity, retry count, HTTP status, response digest, correlation ID and dead-letter state.
- Confirm both existing alert sink services are operational.
- Correlate alert evidence with component audit and monitoring evidence; do not create a parallel alert channel for generated repair failures.
