# ADR 0002: Managed services and EXTERNAL_API pipeline

## Status

Proposed

## Decision

KCML evolves from an MCP-only control plane into a general managed service
control plane. The new primary abstraction is `managed_service`, with protocol
and pipeline specializations layered on top of it.

MCP remains a first-class managed service kind, but no longer defines the
platform boundary. A second managed service kind, `EXTERNAL_API`, is added for
non-MCP HTTPS services that still need centralized token issuance, permission
control, revocation, monitoring, logging, recertification and onboarding.

The design is additive:

- Existing `mcp_server` behavior remains operational and backward compatible.
- New tables model the future control-plane state for both `MCP` and
  `EXTERNAL_API`.
- Existing `kaja_credential` remains the initial caller principal.
- Token issuance, permissions, monitoring and usage are generalized at the
  service layer.
- Distinct pipelines are preserved:
  `MCP_ONBOARDING` for uploaded KCML handlers and
  `EXTERNAL_API_REGISTRATION` for externally operated HTTPS services.

## Context

The current implementation already provides strong security and operations
primitives:

- centralized OAuth token issuance,
- row-scoped permissions,
- immediate revocation through epoch invalidation,
- append-only tamper-evident audit,
- invocation accounting,
- runtime logging,
- monitoring probes and alerting,
- controlled onboarding with integration tokens.

However, those primitives are anchored to `mcp_server`, `https://<host>/mcp`
resources and MCP-specific manifest validation. That makes extension to other
API-backed systems awkward and would lead to duplicated flows if non-MCP
services were implemented as a parallel one-off subsystem.

The attendance system in `dagmar-monorepo` and similar internal services need:

- centralized authorization authority,
- token issuance and expiration control,
- permission scopes beyond simple MCP execute,
- service-specific monitoring,
- shared audit and usage evidence,
- onboarding and recertification under the same governance model.

The control plane must also distinguish between:

- the operational state of the underlying service, and
- the exposure state of the centrally governed API interface.

Disabling the API interface must not imply that the whole underlying server,
worker or line-of-business system is shut down.

## Architecture

### 1. Managed service core

`managed_service` becomes the common identity and policy anchor for all
centrally governed services.

Core responsibilities:

- canonical service identity,
- service kind and protocol family,
- public hostname and base URL,
- lifecycle state and operational state,
- API interface state independent from the underlying service runtime,
- revocation epoch,
- active revision binding,
- monitoring and recertification gates,
- ownership and governance metadata.

### 2. Revision model

`managed_service_revision` stores immutable approved revisions across service
kinds. Each revision includes manifest, digest set, evidence and approval
metadata. MCP revisions may point to uploaded artifacts, while EXTERNAL_API
revisions may point to external endpoint contracts, auth metadata and runbooks.

### 3. Scope-based authorization

MCP currently enforces a single effective permission: execute the tool bound to
one server. `EXTERNAL_API` requires richer scopes, so permissions become
scope-based.

Examples:

- `mcp.invoke`
- `service.discover`
- `service.read_state`
- `service.read_logs`
- `service.monitor.read`
- `service.api.enable`
- `service.api.disable`
- `api.read`
- `api.write`
- `api.admin`

The same `kaja_credential` can therefore hold permissions against multiple
managed services with different scope sets.

### 4. Generalized access tokens

`managed_service_access_token` generalizes the existing access-token model.
Tokens remain opaque bearer values stored only as HMAC lookup digests and bind:

- caller principal,
- managed service,
- audience,
- granted scopes,
- credential revocation epoch,
- service revocation epoch.

This preserves immediate fail-closed revocation while supporting both MCP and
non-MCP resources.

### 5. Unified evidence model

Usage, runtime logs and probes become service-level evidence:

- `managed_service_usage_event`
- `managed_service_runtime_log_event`
- `managed_service_probe_result`

This allows consistent dashboards, alerting and audit trails across service
kinds while still supporting kind-specific fields inside JSON evidence.

### 6. Specialized profiles

Service-kind specific fields live in profile tables instead of polluting the
shared core:

- `external_api_service_profile`
- future `mcp_service_profile` if and when MCP-specific state is moved out of
  `mcp_server`

The EXTERNAL_API profile stores auth expectations, health endpoints,
token-forwarding policy, rate limits and upstream contract metadata.

### 7. KCML operator authority

KCML itself is treated as a governed caller principal, not as an implicit
superuser bypass. It receives explicit scopes required for platform operations.

Minimum operator scopes:

- read current state and revision gates,
- read monitoring status and probe history,
- read runtime and audit-safe logs,
- disable the governed API interface,
- re-enable the governed API interface after policy checks.

These scopes apply to MCP and EXTERNAL_API services alike.

### 8. Pipeline separation

Pipelines remain explicit because the security and operational assumptions
differ.

`MCP_ONBOARDING`:

- uploaded ZIP source,
- OCI build and signature verification,
- isolated runtime,
- public MCP metadata and tool checks,
- synthetic tool execution.

`EXTERNAL_API_REGISTRATION`:

- externally hosted HTTPS service,
- ownership and contract verification,
- auth metadata validation,
- signed health and readiness probes,
- service-specific contract probes,
- optional token broker or delegated authorization checks.

Both pipelines share:

- integration tokens,
- audit and state transitions,
- review/approval metadata,
- monitoring profile activation,
- recertification gates,
- fail-closed enablement.

## Data model direction

The initial additive schema introduces:

- `managed_service`
- `managed_service_revision`
- `managed_service_scope`
- `managed_service_permission`
- `managed_service_access_token`
- `managed_service_api_status`
- `managed_service_usage_event`
- `managed_service_runtime_log_event`
- `managed_service_probe_result`
- `external_api_service_profile`
- `service_pipeline_run`
- `service_pipeline_event`

An immediate compatibility backfill mirrors existing MCP catalog rows into
`managed_service` and seeds the canonical scope `mcp.invoke`.

## Security invariants

- Hostname remains a security boundary.
- Token values are never stored in plaintext.
- Credential revocation and service revocation must invalidate all previously
  issued service access tokens immediately.
- API interface disablement must block centrally governed API traffic without
  being interpreted as a request to stop the underlying business application.
- A service cannot serve traffic while required monitoring, revision or
  recertification gates are missing.
- `EXTERNAL_API` must not create a fail-open bypass around the existing MCP
  safety model.
- Scope checks are exact and additive; no wildcard implicit admin scope exists.
- Runtime logs and audit must keep secret redaction and correlation IDs
  consistent across service kinds.

## Consequences

Positive:

- one authorization authority for MCP and non-MCP services,
- shared governance and monitoring model,
- cleaner future integration of internal APIs,
- less duplicated lifecycle logic.

Trade-offs:

- more schema and domain complexity,
- transitional duplication while both `mcp_server` and `managed_service`
  coexist,
- scope design becomes a first-order architectural concern.

## Migration strategy

Phase 1:

- add additive `managed_service` schema,
- backfill current MCP rows,
- do not switch runtime traffic yet.

Phase 2:

- add service-level domain reads and admin UI pages,
- generalize token issuance and permission management.

Phase 3:

- introduce EXTERNAL_API registration manifest and pipeline,
- onboard the first external service such as the attendance system.

Phase 4:

- progressively move MCP runtime reads from `mcp_server` to
  `managed_service`-based domain services,
- retire duplicated MCP-only tables only after full cutover.
