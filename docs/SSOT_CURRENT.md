# SSOT_CURRENT

This document records the current repository source of truth as of `2026-07-22`.

- Product identity: `KajovoCML`
- Internal technical prefix: `KCML`
- Lifecycle state: `PRE_PRODUCTION_TESTING`
- Deployment-managed owner: `karmar78`
- Deployment password authority: GitHub Actions environment secret `PASS`
- Runtime source of truth: executable source, numbered PostgreSQL migrations, generated onboarding catalogs and active deployment configuration

Current enforced invariants:

- The deployment-managed owner password is synchronized only from `PASS`, stored only as an Argon2id hash and verified after synchronization.
- Session revocation for the deployment-managed owner rotates `session_epoch`, revokes active sessions and invalidates trusted-device cookies.
- Factory reset must restore the deployment-managed owner before completion and preserve configured or previously stored MFA fail-closed.
- Admin login smoke must handle both direct password success and MFA challenge completion.

Authoritative files for the current control-plane baseline:

- `apps/server/src/http/admin-routes.ts`
- `apps/server/src/cli/sync-admin-password.ts`
- `apps/server/src/cli/factory-reset.ts`
- `apps/server/src/domain/deployment-managed-admin.ts`
- `deploy/scripts/install-release.sh`
- `deploy/scripts/smoke-reference-external-api.sh`

## OWNER Dashboard baseline – 2026-07-24

The repository now defines an additive OWNER Dashboard control-plane baseline. The authoritative implementation is:

- `apps/server/src/migrations/004_dashboard_topology.sql`
- `apps/server/src/domain/dashboard-topology.ts`
- `apps/server/src/http/dashboard-routes.ts`
- `apps/admin-ui/src/dashboard-page.tsx`
- `docs/dashboard/capability-parity.json`

Dashboard invariants:

- one onboarding lifecycle keeps one stable visual node;
- token secret values never become node identifiers, drag payloads or topology API data;
- topology, contract compatibility, effective authorization and runtime evidence are separate states;
- reversible suspension never clears credential `revoked_at`;
- Secret resolve and component authorization both fail closed while the principal is suspended;
- destructive deregistration requires impact preview, password, MFA and typed component-code confirmation;
- production screenshot evidence remains pending until it is captured from the deployed build.
