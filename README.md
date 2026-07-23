# KajovoCML

KCML is a security-focused control plane for registering, operating and auditing isolated MCP servers and managed external APIs. The executable source of truth is the code, numbered PostgreSQL migrations and machine-readable catalogs in `docs/onboarding-catalogs/`; `docs/requirements-matrix.md` and `docs/audit-remediation-matrix.md` map those invariants to automated evidence.

AI agents, MCP-facing components and deterministic microsteps may be maintained outside KajovoCML and then follow the canonical onboarding catalog `docs/onboarding-catalogs/onboarding-1.1.json` at registration time. When they are maintained in this monorepository, they belong exclusively in `components/<repository-key>/`; their source layout and generation flow are governed by `docs/onboarding-catalogs/repository-component-1.1.json`, while runtime registration continues through `/v2/component-onboardings`. Integration tokens authorize KCML registration plus onboarding-time reads of explicitly granted KCML Secrets only; they must never be committed or used as GitHub or deployment credentials.

Pure `components/<repository-key>/**` changes use the dedicated repository-component PR and deploy workflows. Mixed diffs still run full platform CI, and the post-deploy evidence for a component rollout is captured in `apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json`.

## Local development

Required tooling is Node.js 24 or newer, pnpm 11 and PostgreSQL 16.
