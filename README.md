# KajovoCML

KCML is a security-focused control plane for registering, operating and auditing isolated MCP servers and managed external APIs. The executable source of truth is the code, numbered PostgreSQL migrations and machine-readable catalogs in `docs/onboarding-catalogs/`; `docs/requirements-matrix.md` and `docs/audit-remediation-matrix.md` map those invariants to automated evidence.

New AI agents, MCP-facing components and deterministic microsteps maintained in this monorepository belong exclusively in `components/<repository-key>/`. Their source layout and generation flow are governed by `docs/onboarding-catalogs/repository-component-1.0.json`; runtime registration remains governed by the current component catalog and `/v2/component-onboardings`. Integration tokens authorize KCML registration only and must never be committed or used as GitHub or deployment credentials.

## Local development

Required tooling is Node.js 24 or newer, pnpm 11 and PostgreSQL 16.
