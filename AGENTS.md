# KajovoCML agent rules

## Authority
1. `docs/SSOT_CURRENT.md` is the normative target contract.
2. The actual source code and numbered PostgreSQL migrations are the executable current state.
3. `ZIP_IN_OUT_IMPLEMENTATION_PROMPT.md` defines the internal-generation implementation scope.
4. Historical delivery/audit documents are forensic context only and never override the SSOT.

KajovoCML is `PRE_PRODUCTION_TESTING`. Breaking cleanup approved by the OWNER may replace obsolete test-only product flows.

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
- No mocks, placeholders, TODO-only implementations, demos or reduced-scope substitutes count as completion.

## Verification
Run the repository's canonical checks. At minimum preserve syntax/type/build/test coverage, generation contract checks, actual local generated-runtime checks, release packaging checks and UI tests. If the supported Node/pnpm toolchain or external registry is unavailable, record the exact blocker and still run every independent local check possible.

## Documentation
Any behavior change must update the active README/runbooks/current-state documents and relevant component catalog card/documentation. Historical artifacts may remain only when clearly labeled historical/superseded.
