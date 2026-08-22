# Deployment runbook — internal generation

Platform releases may be delivered by the operator's chosen release mechanism, but **generated component creation/deployment itself has no GitHub, CI, GHCR or OCI dependency**.

Install the release with `deploy/scripts/install-release.sh`. It installs the web/server services, `kcml-generation-worker.service`, canonical component control/E2E workers, monitor/egress services, `kcml-generated-component@.service` and the bounded generated-runtime helper. Deployment preflight also verifies the util-linux namespace primitives required by the generated-handler capability boundary. Apply all numbered migrations through `021_retire_legacy_generation_states.sql`; 014/015 remain immutable historical migration steps and 016–021 are required forward completions before the generation worker is started. Legacy `CREATED`, `NEEDS_INPUT` and `PLAN_READY` rows are converted to guarded `BLOCKED` records; no new worker path accepts those states.

Before WEDOS/TLS work, the installer runs `openai-secret-preflight`. It verifies only the canonical `OPENAI_API_KEY` record metadata, direct PLATFORM grant and canonical resolver result on the production runner. If that exact existing active record lacks its grant, the preflight reconciles only that grant under the active OWNER audit identity. It never emits or changes the credential value and never creates or rotates an OpenAI key.

The generation worker starts new jobs in persistent `DISCUSSING`. Discussion messages, turns, immutable specification revisions and replayable events are stored in PostgreSQL. The OWNER workspace consumes `/api/generation/jobs/:id/events` with `Last-Event-ID`; a reconnect must first load the durable snapshot and then replay events. Approval is accepted only for the exact current revision digest.

Generation browser sessions and routine browser automation use the version-pinned Playwright dependency shipped by the server release and a Playwright-managed Chromium. The runtime creates an isolated `BrowserContext` per operation, enforces HTTPS/private-network navigation guards, interprets only the declarative manifest DSL and does not call an LLM during routine runs. Generated handlers may reach it only through the canonical component call boundary. The release image installs Chromium during build; verify it with `pnpm generation:browser:check` and `pnpm generation:browser-automation:check` before activation.

Browser automation definitions and revisions are immutable after creation. Runs use a lease, idempotency key and durable step/artifact records. Cancellation, uncertain side effects and repair are terminal-state guarded; do not manually edit runtime rows or bypass the repair route. Do not place resolved secrets in event payloads, metrics, browser evidence or release logs.

When the operator uses the repository's platform release workflow, its self-hosted runner service account must have narrowly scoped non-interactive (`NOPASSWD`) access to `/usr/local/sbin/kcml-deploy-wrapper` and the marker-only journal query used for failure diagnostics. `PASS` is an application credential passed to the wrapper; it must never be configured or supplied as a sudo password. Without this runner-level authorization the workflow fails before the wrapper starts, so no migration, release activation, rollback or health/readiness assertion occurs.

Canonical TLS issuance runs only after the reversible nginx ACME challenge configuration, forward migrations, WEDOS WAPI preflight and the safe WEDOS roundtrip. Before every WEDOS mutation, KCML snapshots the SOA serial of every delegated authoritative NS address; after commit it compares the same addresses and the exact TXT presence. A single unreachable address may fall back to another healthy address of that same NS hostname, but a protocol failure, a stale successful endpoint, or an unreachable whole NS fails closed. Individual DNS queries have a bounded `WEDOS_DNS_QUERY_TIMEOUT_MS`; the overall `WEDOS_DNS_PROPAGATION_TIMEOUT_MS` is KCML operational policy, not a WEDOS SLA. Its eight-minute default follows the 2026-08-23 production observation that exact WAPI cleanup was still visible after 317 seconds but absent before eight minutes; it is not a provider guarantee. Before the roundtrip, the installer runs recovery-first cleanup for active `PREFLIGHT_TEST` and `ACME` ledger rows using exact WEDOS ownership. The release keeps the previous systemd topology active until DNS-01, certificate SAN/key verification and the release checks are ready. If authoritative DNS does not publish the challenge within the bounded propagation window, the deploy is blocked externally and no new topology is activated. The DNS publisher is an external production dependency; do not replace authoritative-DNS confirmation with a timer, a non-authoritative resolver result, or a fake success.

The GitHub deploy step starts its wrapper in a dedicated process session and traps cancellation to terminate only that release tree. This prevents a timed-out self-hosted runner from leaving a WAPI mutation process orphaned under PID 1. A later deployment always uses canonical `recover-preflight` and `recover-acme` exact-ownership cleanup; operators must not delete TXT rows manually.

After a verified issuance, `kcml-canonical-tls-renew.timer` runs the same stable
WEDOS DNS-01 hooks unattended. It attempts renewal a bounded three times, retains
the previous valid certificate whenever renewal, certificate validation, nginx
reload or health verification fails, and opens the durable critical
`tls.canonical_renewal_failed` alert through the existing primary/backup alert
ledger. A later verified renewal closes that same alert. The timer and its
failure/recovery units use the monitor's existing systemd credentials; no TLS
or WEDOS credential is copied into a new environment file.

If a worker restarts after a WEDOS row deletion but before authoritative cleanup
verification, recovery can use only an authoritative TXT answer whose digest
matches the ledger. If no authoritative server returns that digest, cleanup is
terminalized only after all authoritative servers responded without it; a
partial or uncertain response blocks the release.

The DNS observer queries every currently delegated WEDOS NS hostname and each
resolved A/AAAA address directly. For each attempt it records only safe
metadata: authority, address, DNS response class, SOA serial and whether the
expected TXT digest matched. The bounded KCML retry deadline is an operational
policy, never a claimed WEDOS propagation SLA; a deadline failure retains the
complete per-address snapshot in the deploy diagnostic and fails closed.

Generation writes workspaces under `GENERATION_ROOT`, local releases under `GENERATED_COMPONENT_ROOT`, uses `RUNTIME_SOCKET_ROOT` for UDS, and exposes each activated element through its canonical HTTPS hostname. When a candidate is abandoned after a technical failure, the existing generation release cleanup must complete before a new remediation revision starts: first CREATE stops the runtime/removes `current`/marks the release `ROLLED_BACK`; UPDATE/REPAIR restores the previous release. Terminal REPAIR failure additionally restores the captured base component lifecycle/control state. INTEGRATING retry is the exception because the same candidate remains intentionally live for the next provider attempt. Runtime credentials are systemd credentials sourced from KajovoCML Secret Manager, never environment/user handoff tokens.

When an approved specification requires a credential, deterministic component Secret grants are committed through the existing Secret Manager before provider/browser/API work resumes. This applies both to a newly supplied OWNER secret and an already ACTIVE secret rediscovered during integration; it does not introduce a second approval or transfer workflow.

The service configuration must set `KCML_COMPONENT_HOST_SUFFIX` to the canonical component DNS suffix whenever it differs from `PUBLIC_BASE_DOMAIN`. For the current production topology this is `kajovocml.hcasc.cz`. The deployment invariant compares persisted component identities against this setting; repair the configuration value, never component identity rows or the invariant, when an inherited base-domain default is wrong.
