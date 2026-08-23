# KajovoCML agent rules

## Authority
1. `docs/SSOT_CURRENT.md` is the normative target contract.
2. The actual source code and numbered PostgreSQL migrations are the executable current state.
3. `ZIP_IN_OUT_IMPLEMENTATION_PROMPT.md` defines the internal-generation implementation scope.
4. Historical delivery/audit documents are forensic context only and never override the SSOT.

KajovoCML is `PRE_PRODUCTION_TESTING`. Generation discussion is persistent and starts in `DISCUSSING`; browser work is Playwright-owned and routine automation runs are deterministic/no-AI. Breaking cleanup approved by the OWNER may replace obsolete test-only product flows.

Human authorization is single-level across the product: every active authenticated human is `OWNER`. `ADMIN`, `AUDITOR` and other human roles are retired from active source/API/UI paths by forward-only migration `025_single_owner_human_role.sql`; machine/service principals retain their independent principal and permission model. Account identity, sessions, MFA, recovery and audit attribution must be preserved.

## Internal generation invariants
- New capabilities are created only through the OWNER `Generování` flow and persistent generation jobs.
- Do not create or restore an integration-token/programmer handoff, GitHub PR/CI/GHCR/OCI completion gate, or external onboarding worker for internally generated components.
- Generation is an orchestration layer over the existing canonical `component`/`principal`, Secret Manager, control queue, readiness/E2E, monitoring and audit mechanisms; never add a second control plane.
- Every generated element receives its final CML component/principal identity, one long-lived runtime access credential, a canonical hostname, HTTPS CML boundary, heartbeat/state, enable/disable, monitoring, audit and direct Secret grants.
- Runtime source and releases are local, versioned and rollback-capable. UDS is an implementation detail behind the CML HTTPS boundary.
- AI-generated business handlers are capability-contained: side effects are permitted only through `context.secret`, `context.callComponent`, `context.callExternal` and bounded `context.state`; never weaken the runtime sandbox into direct Node networking/process/filesystem/env/import/eval authority.
- OWNER `CANCELLED` is authoritative for a running generation/repair job; model/browser/shell work and later phase/release activation must stop at the nearest practical cancellation point, and guarded state updates must never overwrite `CANCELLED`.
- Monitoring repair enqueue failures must use the existing operational alert + audit mechanism and must not be silently swallowed.
- Trusted OWNER chat and trusted internal OWNER logs may contain plaintext credentials and this must never introduce an extra approval/redaction/transfer workflow. Persistent runtime secrets belong only in the existing Secret Manager; do not hardcode persistent secret values into source, manifests or release artifacts.
- `OPENAI_API_KEY` is the one canonical Secret Manager credential for the persistent discussion and generation worker. Local Codex environment visibility is not evidence about this production record. A missing direct PLATFORM grant may be reconciled to the existing active record; never create, rotate, duplicate, export or log an OpenAI credential as a readiness workaround.
- No mocks, placeholders, TODO-only implementations, demos or reduced-scope substitutes count as completion.
- `IMPLEMENTATION_CONTRACT.md` freezes the generation discussion, SSE, browser automation and approval interfaces for this release.

## Verification
Run the repository's canonical checks. At minimum preserve syntax/type/build/test coverage, generation contract checks, actual local generated-runtime checks, release packaging checks and UI tests. Generation-specific checks include `pnpm generation:contract:check`, `pnpm generation:browser:check`, `pnpm generation:browser-automation:check`, `pnpm generation:automation-sandbox-boundary:check`, `pnpm generation:automation-runtime-no-ai:check` and `pnpm generation:automation-recovery:check`. Playwright-managed Chromium is installed by CI/release; production Chromium must run sandboxed under the worker identity. The Browser Automation worker records a `BROWSER_AUTOMATION` heartbeat in the existing platform-worker ledger, and production readiness requires that fresh heartbeat together with generation and component worker heartbeats. This is not a second component or queue registry. If the supported Node/pnpm toolchain or external registry is unavailable, record the exact blocker and still run every independent local check possible.

The signed release contains `apps/server/dist/cli/ssot-production-acceptance.js`
for the explicit `workflow_dispatch` input
`run_full_ssot_acceptance=true`. It uses the existing deployment-managed OWNER
credential in memory on the trusted self-hosted runner and records only safe
production evidence; it is the canonical path for authenticated generation,
SSE, Browser Automation and viewport acceptance and must not be replaced by a
local mock or a second credential flow.

## Documentation
Any behavior change must update the active README/runbooks/current-state documents and relevant component catalog card/documentation. Historical artifacts may remain only when clearly labeled historical/superseded.
