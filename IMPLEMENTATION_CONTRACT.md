# KajovoCML implementation contract

This file freezes the executable interfaces for the persistent generation and
browser automation work described by `docs/SSOT_CURRENT.md`. It is subordinate
only to the SSOT and repository security rules.

## Generation lifecycle

`DISCUSSING -> ANALYZING -> IMPLEMENTING -> INTEGRATING -> VALIDATING -> CML_CONFORMANCE -> ACTIVATING -> COMPLETED`.
Terminal states are `FAILED`, `BLOCKED`, and `CANCELLED`. `CREATED`,
`NEEDS_INPUT` and `PLAN_READY` are retired generation-product states: an
unresolved fact is represented in `GenerationSpecification.openQuestions`,
and the only product approval freezes one immutable specification revision and
digest. A discussion turn is `QUEUED -> RUNNING -> COMPLETED|FAILED|INTERRUPTED`
with `INTERRUPT_REQUESTED` as its transient steer state.

## Persistent contracts

- `generation_job_message`: immutable ordered OWNER/ASSISTANT/SYSTEM history.
- `generation_discussion_turn`: one active turn per job, leased and recoverable.
- `generation_spec_revision`: immutable canonical JSON plus `sha256:<hex>` digest.
- `generation_event`: durable SSE source; `sequence` is the event id.
- `browser_automation_definition` and `browser_automation_revision`: immutable
  declarative manifest revisions with one active revision.
- `browser_automation_run` and `browser_automation_run_step`: leased,
  idempotent, checkpointed execution with terminal immutability.

Migrations `014_generation_discussion.sql`, `015_browser_automation_runtime.sql`
and forward-only `016_generation_discussion_browser_runtime_completion.sql`
and `017_discussion_turn_exclusivity_and_cancellation.sql`, `018`–`020` WEDOS
operations, `021_retire_legacy_generation_states.sql`,
`022_generation_execution_authority.sql` and
`023_browser_automation_execution_runtime.sql`,
`024_browser_automation_worker_heartbeat.sql`, `025_single_owner_human_role.sql`
and `026_generation_browser_session_contract.sql` are one ordered
contract. Migration 016 adds same-job composite foreign keys,
historical digest reuse, request idempotency, interruption/lease metadata,
operation scopes, irreversible confirmations and teaching records without
rewriting an already-applied migration. Migration 017 permits one queued
successor during a steer while database-enforcing a single upstream-active
turn; cancellation interrupts streaming assistant output and prevents a late
provider completion from changing the terminal job state. Migration 022 adds a
fencing token to discussion leases and explicit execution authority lineage:
`OWNER_APPROVED` for a newly approved semantic specification and
`INHERITED_TECHNICAL` for a retry/repair that reuses the exact functional
specification digest. A worker that loses its lease cannot write deltas,
terminal messages, events or specifications. Migration 023 adds browser-run
lease fencing, retry attempts, cancellation/checkpoint state, safe progress
evidence and an administrative idempotency index. It does not turn static
preflight into a runtime verification PASS.

Canonical serialization is UTF-8 JSON with recursively sorted object keys,
compact separators, and no undefined values. Digests are SHA-256 over those
bytes. `GenerationSpecification` is strict: objective, result summary,
behavioral requirements, inputs/outputs, external systems, business rules,
explicit OWNER decisions, constraints, acceptance criteria, verified facts,
open questions, typed `BrowserAutomationRequirement[]` and, for new proposals,
machine-readable capability decisions (`FULL_REUSE`, `PARTIAL_REUSE` or
`NEW_CAPABILITY_REQUIRED`). Historical revisions without the optional
capability field remain byte-for-byte compatible. Approved revisions are
immutable and planner/implementation input must match both id and digest plus
the execution-authority lineage.

Capability-first is server-enforced per discussion turn. The canonical source
is `component -> active_revision -> component_tool_contract ->
component_current_readiness -> principal/component eligibility`. The
`lookup_cml_capabilities` and `read_cml_capability_contract` tools return safe
contract metadata only. A proposal without lookup evidence, or without exact
contract inspection for referenced candidates, returns a typed recoverable tool
error and cannot create a revision. Approval revalidates the referenced
component revision, tool digest and runtime eligibility.

Execution authority is explicit for every creation/continuation path: CREATE
and semantic OWNER follow-up require a fresh OWNER-approved revision;
technical retry and same-job remediation preserve the existing frozen
authority; automatic REPAIR clones the source approved revision as
`INHERITED_TECHNICAL` or is created `BLOCKED` when lineage is absent. No path
uses `original_prompt` or diagnostic prose as functional authority.

## API and realtime

Generation resources use `/api/generation/jobs/:id`. The discussion API is:

- `POST /api/generation/jobs` — creates/replays a `DISCUSSING` job by OWNER-scoped `clientRequestId` and queues its initial turn.
- `GET /api/generation/jobs/:id/messages` — ordered persistent history.
- `POST /api/generation/jobs/:id/messages` — appends OWNER message and starts a turn.
- `GET /api/generation/jobs/:id/events` — SSE with `Last-Event-ID` replay.
- `GET /api/generation/jobs/:id/spec` and `/spec/revisions` — current/revisioned spec.
- Job list/detail views expose `currentSpecRevisionId`,
  `approvedSpecRevisionId` and `approvedSpecDigest`; these canonical pointers are
  required for race-free clients to observe proposal and approval progress
  without inferring state from message text.
- `POST /api/generation/jobs/:id/approve-spec` — exact revision/digest freeze.
- `POST /api/generation/jobs/:id/cancel` — authoritative cancellation.
- `GET|POST /api/generation/jobs/:id/browser/preview` — job-scoped safe frame
  metadata/image with explicit `NO_PREVIEW` and `SENSITIVE` states; preview
  bytes never expose a storage path.
- `POST /api/generation/jobs/:id/browser/credentials` — named Secret Manager
  binding with a direct platform grant; the value never enters a response or
  event payload.
- `POST /api/generation/jobs/:id/browser/operation-scope` and
  `/browser/irreversible-confirmations` — OWNER-message-bounded scope and
  exact mutation-capable action confirmation.
- `GET|POST /api/generation/jobs/:id/browser/teaching` plus
  `/teaching/preflight` and `/teaching/replay` — semantic teaching evidence
  and deterministic read-only candidate execution without an LLM.

Browser automation resources use `/api/browser-automations` and are
OWNER/CSRF-protected. They provide definition/revision creation and listing,
static preflight, read-only runtime verification, explicit revision
activation, auth-binding metadata, queued run creation, history/detail,
cancellation, reauthentication, enable/disable, repair and protected evidence
download. `repair` records an audit event and delegates to the existing
inherited-spec generation repair authority for the owning generated component;
missing ownership or functional lineage returns a blocked result. `preflight`
returns `STATIC_VALIDATED` after manifest/digest
validation; the `revisions/:revisionId/verify` route runs the same Playwright
interpreter and can produce `PASS` only for a manifest whose every step is
explicitly `READ_ONLY`. No static check is promoted to runtime PASS.

Human authorization is deliberately binary across the whole product: an
authenticated active human account is `OWNER`. `ADMIN`, `AUDITOR` and any
other human role are retired from active source, API and UI paths. Migration
025 normalizes legacy stored values and replaces the account-role constraint
with `CHECK (role = 'OWNER')`; it is forward-only and preserves account IDs,
sessions, MFA/recovery data and audit attribution. Machine/service principals
and their permission model remain independent. The admin-account API and UI do
not accept or offer a human role selector; active status, MFA, sessions and
last-owner protection remain separate controls.

SSE envelopes are `{eventId, type, jobId, emittedAt, payload}`. Persistent ids
are monotonic; heartbeat and resync notices do not reuse them. Canonical names
are `generation.state.changed`,
`discussion.turn.queued|started|interrupt_requested|interrupted|completed|failed`,
`discussion.message.created|delta|completed|interrupted|failed`,
`discussion.tool.started|progress|completed|failed`, `spec.revision.created`,
`spec.approved`, `generation.blocked|cancelled|failed|completed` and
`generation.resync.required`. Reconnect takes a snapshot then replays
`Last-Event-ID`; an unavailable range demands resync.

## Browser boundary

All browser code is platform-owned and uses Playwright. Generated handlers have
no Playwright, process, direct network, filesystem, shell, or arbitrary import
authority. They call the canonical Browser Automation Runtime only through
`context.callComponent`. Runtime manifests are declarative and implement
`NAVIGATE`, `CLICK`, `FILL`, `FILL_SECRET`, `SELECT`, `CHECK`, `UNCHECK`,
`PRESS`, `UPLOAD`, `DOWNLOAD`, `WAIT_FOR`, `ASSERT`, `EXTRACT`, `BRANCH` and
bounded `REPEAT_BOUNDED` (plus compatibility aliases). Locators and predicates
are semantic/explicit; arbitrary JavaScript, `page.evaluate`, dynamic imports,
shell and direct fetch are rejected. Runtime verification is read-only and
must use the same interpreter as production runs.

Navigation is HTTPS-only, allowlist/operation-scope constrained, and blocks
private/link-local targets. Credentials are resolved only through Secret
Manager bindings. Sensitive preview/evidence is never emitted to SSE.

## Deployment DNS boundary

The production DNS provider is WEDOS WAPI at `https://api.wedos.com/wapi/json`.
Its client authenticates with the documented Europe/Prague SHA-1 hour contract,
uses a unique `clTRID` for every request, and never logs the WAPI password or
authorization string. WAPI credentials are active Secret Manager records and
must be explicitly granted only to the canonical platform worker before the
deployment-side ACME hook may resolve them. TXT cleanup is permitted only for
an exact row whose name, type, value and WEDOS-safe `kcmlacme<correlation-hex>` ownership
marker match the persisted operation; no broad `_acme-challenge` deletion is
allowed.

Every ACME invocation has its own correlation ID, digest-only ledger record and
WEDOS-safe author marker. The canonical lifecycle is `CREATED` → `ROW_ADDED` →
`COMMITTED` → `PROPAGATED` → `CLEANUP_REQUESTED` → `DELETED` →
`CLEANUP_PROPAGATED`. The deployment runner executes `recover-preflight` before
a new safe roundtrip. Recovery obtains the TXT value only from a row that
matches the stored digest, exact name, type, author marker and persisted
uppercase row ID. If the provider row was already deleted before a worker
restart, recovery may derive the value only from authoritative TXT answers
whose SHA-256 matches the persisted digest; otherwise it fails closed. The
value is never logged or persisted as plaintext.
Authoritative propagation and cleanup retry use bounded KCML operational
deadlines. Those deadlines are not a WEDOS propagation guarantee; each
observation records the authoritative hostname/address, SOA serial, response
class and digest-only TXT visibility. An unresolved result fails the release
and leaves the prior release active.

## Concurrency, recovery, and safety

Job turns and automation runs use PostgreSQL row locks plus expiring leases.
Messages are inserted before their turn foreign key is created; duplicate keys
return identical content or fail with a conflict, never mutate existing content.
Job and run idempotency keys are owner/caller scoped. Terminal updates use
guarded `WHERE state NOT IN (...)` predicates. Cancellation is authoritative;
late worker updates cannot overwrite `CANCELLED`. Uncertain non-idempotent
steps reconcile postconditions or enter `MANUAL_REVIEW`; they are never blindly
retried. Failed candidate activation rolls back to the last functional release.

## Security and permissions

All OWNER mutations use the existing session, single-OWNER human role and CSRF
contract. There is no additional human role or login/security gate.
Automation callers require canonical CML component/principal permission for the
specific automation definition and active revision. No new role, login gate,
security approval, deployment approval, or credential-transfer workflow is
introduced.

`OPENAI_API_KEY` is one canonical PLATFORM Secret Manager record shared by the
discussion and implementation worker paths. Readiness means that record is
ACTIVE, non-deleted, has an active version, has a non-revoked direct
`PLATFORM` grant (`all_secrets=false`) for `platformWorkerSecretPrincipal()`,
and resolves through the canonical resolver. A missing grant is reconciled
idempotently against the existing record only; no readiness check, setup view,
or deploy preflight creates or rotates an OpenAI credential. The release
preflight prints metadata and PASS/FAIL only, never a ciphertext, value or
authorization header.

## Runtime interfaces

The generation worker, never an HTTP request, owns OpenAI Responses streaming.
The Browser Automation worker records a `BROWSER_AUTOMATION` entry in the
existing `platform_worker_heartbeat` table. Readiness requires fresh
generation and Browser Automation heartbeats in addition to the canonical
component worker heartbeats; this is operational evidence for the existing
services, not a second queue or component registry.
It sends OWNER-visible prose through `response.output_text.delta` and uses the
single shared Responses transport/function-call infrastructure. The discussion
tools are the server-side `lookup_cml_capabilities`,
`read_cml_capability_contract` and `propose_generation_specification` tools;
their arguments and outputs are never rendered as chat text. The worker
persists assistant deltas and safe provider response ids, checks interruption while reading, and
rejects a raw JSON/envelope prefix rather than extracting legacy fields such as
`assistantMessage` into OWNER-visible text. It never parses model text into a
specification; only the validated function-tool arguments may create a revision.
redacts accidental JSON envelopes before they reach the OWNER. Browser preview,
teaching, operation scope and irreversible confirmation are job-scoped records;
they do not create another approval gate. The manifest DSL has no arbitrary
source: only declarative locators, navigation, form interaction, waits,
assertions, extraction, bounded branch/repeat, upload/download handles and
typed output. Activation follows deterministic automation preflight. An
uncertain non-idempotent runtime step is finalized as `MANUAL_REVIEW` and is
never blindly retried. Automatic
REPAIR may enter `IMPLEMENTING` only when the source functional lineage has an
approved specification; the worker clones that exact canonical digest into the
new job as inherited technical authority. If lineage is absent, the repair is
created `BLOCKED` with `generation_repair_spec_lineage_missing` and requires a
new OWNER discussion. Repair restores the preceding release or flags an
uncertain external side effect.

## Production acceptance harness

`apps/server/src/cli/ssot-production-acceptance.ts` is the canonical
authenticated production acceptance runner. It is shipped in the signed
release bundle but is not part of an ordinary deployment gate. It runs only
when the repository workflow is explicitly dispatched with
`run_full_ssot_acceptance=true`; push and pull-request runs keep the flag false.
The self-hosted deploy runner passes the already deployment-managed `PASS` in
process memory and uses the existing migrator database/config-vault
credentials. The runner never creates a new credential, exports or prints a
credential, and emits only safe identifiers, state values, digests, counts and
timings. Ordinary deployments do not rotate the preserved OWNER password.
The explicit acceptance dispatch also enables the narrowly scoped
`KCML_ACCEPTANCE_RECONCILE_OWNER_PASSWORD` path: only when the preserved OWNER
hash does not match the existing deployment-managed `PASS`, the deploy syncs
that existing account to the same in-memory `PASS` so the real login can run.
This is not a new credential, account, API bypass or test-only route; normal
deployments retain the existing OWNER password.

The runner exercises the real `admin.hcasc.cz` OWNER HTTP/session/CSRF boundary,
persistent generation job and messages, Responses capability-first event trail,
SSE bootstrap and `Last-Event-ID` replay, stale approval rejection,
cancellation, the canonical Browser Automation definition/revision/
preflight/verification/activation/queue/worker/idempotency/disable path, and
authenticated browser UI navigation/geometry at the four SSOT viewports. Test
definitions and cancelled generation fixtures are correlated by generated
identifiers and are cleaned up through the existing database/runtime records
after the run. A failed check fails the release; no matrix status is promoted
from static presence alone.
