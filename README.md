# KajovoMCPCML

KCML is a security-focused control plane for registering, operating and auditing isolated MCP servers and managed external APIs. The executable source of truth is the code, numbered PostgreSQL migrations and machine-readable catalogs in `docs/onboarding-catalogs/`; `docs/requirements-matrix.md` and `docs/audit-remediation-matrix.md` map those invariants to automated evidence.

## Local development

Required tooling is Node.js 24 or newer, pnpm 11 and PostgreSQL 16. Start from a database owned by the migration role and generate distinct random values for every secret in `.env.example`.

```bash
corepack pnpm install --frozen-lockfile
set -a
source .env
set +a
corepack pnpm db:migrate
corepack pnpm dev
```

`pnpm dev` builds the current admin UI before starting the watched server, avoiding stale fingerprinted assets. Bootstrap-only values establish the database and encrypted configuration vault; mutable operational settings are authoritative in PostgreSQL and are managed through the admin UI or the one-time `config:import-env` command.

## Verification

```bash
corepack pnpm run ci
```

Database integration suites are enabled with `KCML_TEST_DATABASE=1` and require a disposable migrated database in `DATABASE_URL`. The CI workflow additionally exercises clean and upgrade migrations, role isolation, secret scanning, dependency auditing, release packaging and deployment harnesses.

## Operations

Production installation, backup, rollback and the explicitly gated post-test factory reset are documented in `docs/runbooks/deployment.md`. Incident handling is in `docs/runbooks/incident-response.md`; managed external API runtime procedures are in `docs/runbooks/external-api-managed-service-runtime.md`.

Never commit `.env`, credentials, access tokens, generated backups or runtime logs. Production releases are assembled by CI and verified on the server; they are not built in place.
