# Incident Response Runbook

## Critical triggers

- Audit write failure.
- Database unavailable.
- Cross-host routing invariant failure.
- Token accepted for the wrong audience.
- Contract or artifact digest drift.
- Repeated backup restore failure.

## Immediate action

1. Quarantine the affected KCML server.
2. Revoke resource tokens by changing the server revocation epoch.
3. Preserve audit, logs, traces, and build ID.
4. Notify primary and backup operational channels.
5. Require a new registration revision before returning to `ACTIVE`.

Automatic return from `QUARANTINED` is forbidden.
