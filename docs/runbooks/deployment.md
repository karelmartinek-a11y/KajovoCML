# Deployment Runbook

## Required secrets

- `PASS`: production password for admin account `karmar78`.
- `ADMIN_TOTP_SECRET`: TOTP shared secret for the same account.
- `DATABASE_URL`
- `ACCESS_TOKEN_HMAC_KEY_BASE64`
- `SESSION_SECRET_BASE64`
- `CSRF_SECRET_BASE64`
- `MFA_ENCRYPTION_KEY_BASE64`
- `PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`

`PASS` is never echoed. If `PASS` is missing or empty, deployment may continue
but password login is disabled. If `ADMIN_TOTP_SECRET` is missing, login remains
inactive even when `PASS` is present.

## Order

1. Build and test in CI.
2. Upload release archive.
3. Run `deploy/scripts/preflight.sh`.
4. Run `deploy/scripts/backup.sh`.
5. Run migrations.
6. Synchronize admin password from `PASS`.
7. Restart service.
8. Check `/health`.
9. Keep previous release for rollback.

## Rollback

Run `deploy/scripts/rollback.sh <release-id>`. Database rollback is permitted
only to a migration-compatible application version. KCML identifiers, token
revocation epochs, audit events, and statistics are never reset.
