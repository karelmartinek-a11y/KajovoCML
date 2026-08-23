# KajovoCML

KajovoCML is the canonical control plane for CML components, identities, permissions, Secret Manager grants, monitoring, control, readiness/E2E evidence and audit. The normative target is `docs/SSOT_CURRENT.md`; current executable truth is the source plus numbered PostgreSQL migrations.

## Creating new capabilities

Generation now starts in a persistent `DISCUSSING` workspace. OWNER messages,
AI turns, immutable `GenerationSpecification` revisions and replayable SSE events
are stored in PostgreSQL. Approval freezes the exact revision digest before the
existing local generation pipeline continues. Browser configuration uses the
Playwright-managed Chromium platform and declarative automation manifests; the
routine Browser Automation Runtime does not call an LLM. See
[`IMPLEMENTATION_CONTRACT.md`](IMPLEMENTATION_CONTRACT.md) for the frozen
interfaces and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for runtime
boundaries.
Browser automation administration is available under **Browser automatizace**:
the page shows immutable manifest digests, static preflight versus measured
read-only runtime verification, Secret Manager stable-name bindings, run
history, cancellation, repair and enable/disable controls. Repair requests are
handed to the existing inherited-spec generation authority and fail closed when
the owner component or approved lineage is unavailable. Routine runs use
Playwright only and never call an LLM.
OWNER uses **Generování** in the admin UI. A persistent generation job analyses the human request, asks only for genuinely missing and non-derivable inputs, creates a local job workspace/revision point, uses the OpenAI Responses API for focused implementation/research, stores durable credentials in the existing Secret Manager, validates the generated source, installs a versioned local release, proves CML conformance and only then activates the component. A failed or blocked run can be continued as a new linked, auditable run with a plain-text correction instruction while preserving the existing CML component identity.

The discussion and implementation worker reuse the same canonical `OPENAI_API_KEY` record in Secret Manager. An existing active record with a missing platform grant is repaired by granting that record to the canonical platform worker; the dashboard does not request, create or rotate another key for that condition.

The full authenticated production acceptance is an explicit release action, not
a static claim: dispatch `.github/workflows/ci-deploy.yml` with
`run_full_ssot_acceptance=true`. The signed release runner exercises the real
OWNER HTTP/CSRF/SSE, generation, Playwright Browser Automation and required UI
viewport paths on `admin.hcasc.cz`, using the deployment-managed credential only
in memory and emitting safe evidence. Its temporary fixtures are correlated and
cleaned after the run. Ordinary CI and deploy runs leave this expensive gate
disabled.

Human authorization is intentionally single-level: every authenticated active human account is `OWNER`. Legacy `ADMIN`/`AUDITOR` values are normalized by forward-only migration `025_single_owner_human_role.sql`; machine principals remain governed by their separate principal and permission contracts. The admin-account API and UI expose activity, MFA and sessions, but no human role selector.

Internally generated components do **not** use integration-token/programmer handoff, GitHub PR/CI, GHCR or OCI as runtime dependencies or completion gates. Each result is a normal canonical CML `component`/`principal` with one managed runtime access identity, direct secret grants, HTTPS hostname, control/state/heartbeat, monitoring, audit and local rollback.
Abandoned candidate releases use the same local rollback path: a first CREATE is stopped/removed when no previous release exists, while UPDATE/REPAIR restores the prior release; terminal REPAIR also restores its captured base component state. When INTEGRATING resumes after OWNER secret input, deterministic component grants are committed before provider/browser/API work continues.

## Repository checks
Use the supported runtime declared by `package.json`, then run `corepack pnpm install --frozen-lockfile` and `corepack pnpm run ci`. Independent generation checks are `node scripts/check-internal-generation-contract.mjs`, `pnpm generation:execution-authority:check`, `node scripts/test-generated-component-runtime.mjs`, `node scripts/test-generation-browser.mjs` and `pnpm --filter @kcml/server test` (which includes the DB-backed browser queue contract when `KCML_TEST_DATABASE=1`). A deployed no-mock HTTPS regression runner is available as `node scripts/test-generated-platform-live.mjs` and intentionally requires a real CML deployment and runtime credentials.
