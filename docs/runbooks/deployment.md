# Deployment Runbook

## Required secrets

- GitHub secret `PASS`: production password for admin account `karmar78`.
- Server-side `/etc/kcml/kcml.env`: `DATABASE_URL`, internal HMAC/session/CSRF/MFA keys, host names, and other non-GitHub deployment configuration.

`PASS` is never echoed. If `PASS` is missing or empty, deployment may continue
but password login is disabled. Operational secrets are generated and retained
on the production server, not stored in GitHub Secrets.

## Order

1. Build and test in CI.
2. Deploy job runs on the production self-hosted runner.
3. Load `/etc/kcml/kcml.env`.
4. Run `deploy/scripts/preflight.sh`.
5. Run `deploy/scripts/backup.sh`.
5. Run migrations.
6. Synchronize admin password from `PASS`.
7. Restart service.
8. Check `/health`.
9. Keep previous release for rollback.

## Rollback

Run `deploy/scripts/rollback.sh <release-id>`. Database rollback is permitted
only to a migration-compatible application version. KCML identifiers, token
revocation epochs, audit events, and statistics are never reset.
