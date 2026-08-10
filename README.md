# KajovoCML

KajovoCML is the canonical control plane for CML components, identities, permissions, Secret Manager grants, monitoring, control, readiness/E2E evidence and audit. The normative target is `docs/SSOT_CURRENT.md`; current executable truth is the source plus numbered PostgreSQL migrations.

## Creating new capabilities
OWNER uses **Generování** in the admin UI. A persistent generation job analyses the human request, asks only for genuinely missing inputs, creates a local job workspace/revision point, uses the OpenAI Responses API for focused implementation/research, stores durable credentials in the existing Secret Manager, validates the generated source, installs a versioned local release, proves CML conformance and only then activates the component.

Internally generated components do **not** use integration-token/programmer handoff, GitHub PR/CI, GHCR or OCI as runtime dependencies or completion gates. Each result is a normal canonical CML `component`/`principal` with one managed runtime access identity, direct secret grants, HTTPS hostname, control/state/heartbeat, monitoring, audit and local rollback.
Abandoned candidate releases use the same local rollback path: a first CREATE is stopped/removed when no previous release exists, while UPDATE/REPAIR restores the prior release; terminal REPAIR also restores its captured base component state. When INTEGRATING resumes after OWNER secret input, deterministic component grants are committed before provider/browser/API work continues.

## Repository checks
Use the supported runtime declared by `package.json`, then run `corepack pnpm install --frozen-lockfile` and `corepack pnpm run ci`. Independent generation checks are `node scripts/check-internal-generation-contract.mjs`, `node scripts/test-generated-component-runtime.mjs` and `node scripts/test-generation-browser.mjs`. A deployed no-mock HTTPS regression runner is available as `node scripts/test-generated-platform-live.mjs` and intentionally requires a real CML deployment and runtime credentials.
