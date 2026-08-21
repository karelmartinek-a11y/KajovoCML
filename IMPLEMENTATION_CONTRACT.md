# KajovoCML implementation contract

This file freezes the executable interfaces for the persistent generation and
browser automation work described by `docs/SSOT_CURRENT.md`. It is subordinate
only to the SSOT and repository security rules.

## Generation lifecycle

`DISCUSSING -> ANALYZING -> IMPLEMENTING -> INTEGRATING -> VALIDATING -> CML_CONFORMANCE -> ACTIVATING -> COMPLETED`.
Terminal states are `FAILED`, `BLOCKED`, and `CANCELLED`. Ordinary OWNER input
keeps a job in `DISCUSSING`; it is not represented as `NEEDS_INPUT` before
approval. Approval freezes one immutable specification revision and digest.

## Persistent contracts

- `generation_job_message`: immutable ordered OWNER/ASSISTANT/SYSTEM history.
- `generation_discussion_turn`: one active turn per job, leased and recoverable.
- `generation_spec_revision`: immutable canonical JSON plus `sha256:<hex>` digest.
- `generation_event`: durable SSE source; `sequence` is the event id.
- `browser_automation_definition` and `browser_automation_revision`: immutable
  declarative manifest revisions with one active revision.
- `browser_automation_run` and `browser_automation_run_step`: leased,
  idempotent, checkpointed execution with terminal immutability.

Canonical serialization is UTF-8 JSON with recursively sorted object keys,
compact separators, and no undefined values. Digests are SHA-256 over those
bytes. Approved revisions are immutable and planner input must match both id
and digest.

## API and realtime

Generation resources use `/api/generation/jobs/:id`. The discussion API is:

- `POST /api/generation/jobs` — creates `DISCUSSING` job and initial OWNER message.
- `GET /api/generation/jobs/:id/messages` — ordered persistent history.
- `POST /api/generation/jobs/:id/messages` — appends OWNER message and starts a turn.
- `GET /api/generation/jobs/:id/events` — SSE with `Last-Event-ID` replay.
- `GET /api/generation/jobs/:id/spec` and `/spec/revisions` — current/revisioned spec.
- `POST /api/generation/jobs/:id/approve-spec` — exact revision/digest freeze.
- `POST /api/generation/jobs/:id/cancel` — authoritative cancellation.

SSE envelopes are `{eventId, type, jobId, occurredAt, payload}`. Event types
include `generation.snapshot`, `message.created`, `turn.started`,
`turn.delta`, `turn.completed`, `spec.revision.created`, `generation.state.changed`,
`generation.resync.required`, and `generation.heartbeat`.

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
Message and run idempotency keys are unique per owner/job. Terminal updates use
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

