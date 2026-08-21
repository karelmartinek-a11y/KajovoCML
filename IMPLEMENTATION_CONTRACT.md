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
and `017_discussion_turn_exclusivity_and_cancellation.sql` are one ordered
contract. Migration 016 adds same-job composite foreign keys,
historical digest reuse, request idempotency, interruption/lease metadata,
operation scopes, irreversible confirmations and teaching records without
rewriting an already-applied migration. Migration 017 permits one queued
successor during a steer while database-enforcing a single upstream-active
turn; cancellation interrupts streaming assistant output and prevents a late
provider completion from changing the terminal job state.

Canonical serialization is UTF-8 JSON with recursively sorted object keys,
compact separators, and no undefined values. Digests are SHA-256 over those
bytes. `GenerationSpecification` is strict: objective, result summary,
behavioral requirements, inputs/outputs, external systems, business rules,
explicit OWNER decisions, constraints, acceptance criteria, verified facts,
open questions and typed `BrowserAutomationRequirement[]`. Approved revisions
are immutable and planner/implementation input must match both id and digest.

## API and realtime

Generation resources use `/api/generation/jobs/:id`. The discussion API is:

- `POST /api/generation/jobs` — creates/replays a `DISCUSSING` job by OWNER-scoped `clientRequestId` and queues its initial turn.
- `GET /api/generation/jobs/:id/messages` — ordered persistent history.
- `POST /api/generation/jobs/:id/messages` — appends OWNER message and starts a turn.
- `GET /api/generation/jobs/:id/events` — SSE with `Last-Event-ID` replay.
- `GET /api/generation/jobs/:id/spec` and `/spec/revisions` — current/revisioned spec.
- `POST /api/generation/jobs/:id/approve-spec` — exact revision/digest freeze.
- `POST /api/generation/jobs/:id/cancel` — authoritative cancellation.

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
`context.callComponent`. Runtime manifests are declarative and limited to
navigation, semantic locators, input, click, wait, assert, extract, bounded
branch/repeat, upload/download handles, and typed outputs.

Navigation is HTTPS-only, allowlist/operation-scope constrained, and blocks
private/link-local targets. Credentials are resolved only through Secret
Manager bindings. Sensitive preview/evidence is never emitted to SSE.

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

All OWNER mutations use the existing session, OWNER role and CSRF contract.
Automation callers require canonical CML component/principal permission for the
specific automation definition and active revision. No new role, login gate,
security approval, deployment approval, or credential-transfer workflow is
introduced.

## Runtime interfaces

The generation worker, never an HTTP request, owns OpenAI Responses streaming.
It persists assistant deltas and safe provider response ids, checks interruption
while reading, and durably fails malformed structured output. Browser preview,
teaching, operation scope and irreversible confirmation are job-scoped records;
they do not create another approval gate. The manifest DSL has no arbitrary
source: only declarative locators, navigation, form interaction, waits,
assertions, extraction, bounded branch/repeat, upload/download handles and
typed output. Activation follows deterministic automation preflight; repair
restores the preceding release or flags an uncertain external side effect.
