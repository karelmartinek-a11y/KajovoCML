# Incident Response Runbook

## Critical triggers

- Audit write failure.
- Database unavailable.
- Cross-host routing invariant failure.
- Token accepted for the wrong audience.
- Contract or artifact digest drift.
- Repeated backup restore failure.
- Invalid audit-chain verification or a migration checksum mismatch.
- MCP invocation finalization failure or dead-lettered Critical alert delivery.
- Expired recertification, missing active revision or missing monitoring profile.
- Invalid OCI signature/provenance or source/image digest drift.
- Integration, Kaja, access or egress capability token found in logs, audit,
  artifacts, PR output or an uploaded archive.
- Onboarding handler reaches a non-allowlisted, private, loopback, link-local or
  metadata address.

## Immediate action

1. Quarantine the affected KCML server.
2. Revoke resource tokens by changing the server revocation epoch.
3. Preserve audit, logs, traces, and build ID.
4. Notify primary and backup operational channels.
5. Require a new registration revision before returning to `ACTIVE`.
6. Revoke the integration token, ephemeral Kaja/access tokens and egress
   capability; cancel the job lease and stop the OCI worker.
7. Preserve the quarantine source digest, PR/check run, source commit, build ID,
   image digest, signature, SBOM, provenance and correlation IDs.
8. Verify both signed webhook deliveries and record any dead-letter recovery.
9. Verify the complete audit chain before service restoration.

Automatic return from `QUARANTINED` is forbidden.

## Alert delivery failure

- Inspect `alert_webhook_delivery` for retry count, HTTP status, response digest and dead-letter state.
- Confirm both alert sink services are active and inspect their metadata-only journald events.
- Received payloads are mode `0600` under the isolated primary and backup state directories; correlate them by delivery and correlation ID.
