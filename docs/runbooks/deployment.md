# Deployment runbook — internal generation

Platform releases may be delivered by the operator's chosen release mechanism, but **generated component creation/deployment itself has no GitHub, CI, GHCR or OCI dependency**.

Install the release with `deploy/scripts/install-release.sh`. It installs the web/server services, `kcml-generation-worker.service`, `kcml-browser-automation-worker.service`, canonical component control/E2E workers, monitor/egress services, `kcml-generated-component@.service` and the bounded generated-runtime helper. Deployment preflight also verifies the util-linux namespace primitives required by the generated-handler capability boundary. Apply all numbered migrations through `026_generation_browser_session_contract.sql`; 014/015 remain immutable historical migration steps and 016–026 are required forward completions before the workers are started. Legacy `CREATED`, `NEEDS_INPUT` and `PLAN_READY` rows are converted to guarded `BLOCKED` records; no new worker path accepts those states. Migration 022 backfills existing approved jobs as `OWNER_APPROVED` and installs lease fencing plus composite authority lineage constraints. Migration 023 adds fenced browser-run leases, cancellation checkpoints, safe progress evidence and administrative idempotency. Migration 024 extends the existing platform-worker heartbeat constraint and records the Browser Automation worker as a readiness-required service identity; migration 025 normalizes every human account to `OWNER` and enforces the single-owner role constraint without changing account identity or machine-principal permissions. Migration 026 adds only job-scoped generation browser sessions/preview frames and the missing scope, confirmation and teaching metadata; it does not create a second queue, component registry or secret store. The Playwright installer serializes KCML installs with a separate flock, removes only a stale `__dirlock` after confirming no Playwright installer process is active, and fails closed when an active installer is observed.

Before WEDOS/TLS work, the installer runs `openai-secret-preflight`. It verifies only the canonical `OPENAI_API_KEY` record metadata, direct PLATFORM grant and canonical resolver result on the production runner. If that exact existing active record lacks its grant, the preflight reconciles only that grant under the active OWNER audit identity. It never emits or changes the credential value and never creates or rotates an OpenAI key.

The generation worker starts new jobs in persistent `DISCUSSING`. Discussion messages, turns, immutable specification revisions and replayable events are stored in PostgreSQL. The OWNER workspace consumes `/api/generation/jobs/:id/events` with `Last-Event-ID`; a reconnect must first load the durable snapshot and then replay events. Approval is accepted only for the exact current revision digest and current capability contract. Lease takeover uses the persisted fencing token and rejects late writes from the previous worker.

Generation browser sessions and routine browser automation use the version-pinned Playwright dependency shipped by the server release and the configured Chromium executable. CI installs and runs the matching Playwright-managed Chromium; production runs `deploy/scripts/install-playwright-browser.sh` against the exact release dependency, stores the browser under `/opt/kcml/playwright-browsers`, resolves `chromium.executablePath()` and writes that immutable executable path into the worker service configuration before preflight. The runtime creates an isolated `BrowserContext` per operation, enforces HTTPS/private-network navigation guards, interprets only the declarative manifest DSL (including semantic locators, secret fill through bindings, upload/download and bounded observed-state control flow) and does not call an LLM during routine runs. Generated handlers may reach it only through the canonical component call boundary. Verify it with `pnpm generation:browser:check` and `pnpm generation:browser-automation:check` before activation.

The production host currently runs Node `24.17.x`; production evidence showed Playwright `1.55.1` can hang in its Node extraction pipeline on that host while the downloaded Chromium archive remains valid. For that narrow runtime range, `deploy/scripts/playwright-browser-compat.mjs` obtains the authoritative install location and HTTPS download URLs from Playwright `install --dry-run`, installs Playwright OS dependencies, verifies the real archive with `unzip -tq`, rejects archive path traversal, atomically extracts the archive into the Playwright cache and writes the normal `INSTALLATION_COMPLETE` marker. Node `24.18.x` and later use Playwright's normal `install --with-deps chromium` path. Both paths require the actual Chromium executable; no stub or browser-test bypass is accepted.

The generation browser API is also job-scoped: `POST /api/generation/jobs/:id/browser/preview` opens a real safe HTTPS target and records a monotonic PNG frame, while `GET` returns the latest frame with `Cache-Control: no-store`, a sensitive lock response, or an explicit `NO_PREVIEW` state. `POST /browser/credentials` stores only a named credential through the existing Secret Manager and direct platform grant. `POST /browser/operation-scope` requires the origin to occur in the source OWNER message; irreversible confirmation additionally requires a mutation-capable scope. Teaching records semantic steps only, and `/browser/teaching/preflight` plus `/browser/teaching/replay` reject mutating manifests and execute without OpenAI.

Browser automation definitions and revisions are immutable after creation. The current DB-backed runtime exposes owner-scoped definition/revision/auth-binding/run/history/preflight/read-only runtime-verification/activation/cancel/enable/disable/repair/artifact routes, a durable queue worker, fenced leases, idempotency and evidence artifacts. Static preflight is intentionally reported as `STATIC_VALIDATED`; it is not a runtime verification or activation PASS. Runtime verification is measured by the same interpreter and is restricted to explicit `READ_ONLY` manifests. An OWNER repair request is audit-recorded and delegates to the existing inherited-spec generation repair authority for the owning component; absent ownership or approved functional lineage is returned as a blocked repair. Full auth-state binding, human challenge, drift reconciliation and component-release activation ordering remain separate acceptance items. Cancellation and terminal updates are state-guarded; do not manually edit runtime rows or bypass the repair route. Do not place resolved secrets in event payloads, metrics, browser evidence or release logs.

When the operator uses the repository's platform release workflow, its self-hosted runner service account must have narrowly scoped non-interactive (`NOPASSWD`) access to `/usr/local/sbin/kcml-deploy-wrapper` and the marker-only journal query used for failure diagnostics. `PASS` is an application credential passed to the wrapper; it must never be configured or supplied as a sudo password. Without this runner-level authorization the workflow fails before the wrapper starts, so no migration, release activation, rollback or health/readiness assertion occurs.

The signed release also contains the canonical full SSOT acceptance runner at
`apps/server/dist/cli/ssot-production-acceptance.js`. It is intentionally
opt-in: dispatch `.github/workflows/ci-deploy.yml` with the boolean input
`run_full_ssot_acceptance=true`. The deploy step then runs the real authenticated
OWNER HTTP/SSE and Playwright checks after stable health, using the existing
deployment-managed `PASS` and migrator/config-vault credentials only in process
memory. For this explicit acceptance only, if forensic deploy checks show that
the preserved OWNER password differs from the supplied deployment `PASS`, the
installer reconciles the existing OWNER hash to that same already-provided
`PASS`; it never creates an account, asks for a second password or provisions a
new secret. Ordinary deploys continue to preserve a divergent OWNER password.
The acceptance runner reports safe identifiers, states, digests, counts and timings; it
never prints passwords, TOTP material, secret ciphertext or provider tokens.
The generated fixtures are read-only where possible, use correlation IDs, and
are cleaned through the canonical database/runtime records. Ordinary push,
pull-request and non-opt-in dispatch deployments do not execute this expensive
production acceptance gate.

Canonical TLS issuance runs only after the reversible nginx ACME challenge configuration, forward migrations, WEDOS WAPI preflight and the safe WEDOS roundtrip. Before every WEDOS mutation, KCML snapshots the SOA serial of every delegated authoritative NS address; after commit it compares the same addresses and the exact TXT presence. A single unreachable address may fall back to another healthy address of that same NS hostname, but a protocol failure, a stale successful endpoint, or an unreachable whole NS fails closed. Individual DNS queries have a bounded `WEDOS_DNS_QUERY_TIMEOUT_MS`; the overall `WEDOS_DNS_PROPAGATION_TIMEOUT_MS` is KCML operational policy, not a WEDOS SLA. Its eight-minute default follows the 2026-08-23 production observation that exact WAPI cleanup was still visible after 317 seconds but absent before eight minutes; it is not a provider guarantee. Before the roundtrip, the installer runs recovery-first cleanup for active `PREFLIGHT_TEST` and `ACME` ledger rows using exact WEDOS ownership. The release keeps the previous systemd topology active until DNS-01, certificate SAN/key verification and the release checks are ready. If authoritative DNS does not publish the challenge within the bounded propagation window, the deploy is blocked externally and no new topology is activated. The DNS publisher is an external production dependency; do not replace authoritative-DNS confirmation with a timer, a non-authoritative resolver result, or a fake success.

The certbot deploy hook atomically copies the resolved canonical wildcard lineage into the canonical `/etc/kcml/tls/` runtime pair. The resolver first honors an explicit lineage, then an existing lineage path, then a matching certificate fingerprint, and finally the unique lineage covering the required SANs; ambiguity fails closed. This matters on shared hosts where certbot can rename a lineage after a name collision (the production lineage is currently `kcml-wildcards-0001`, while the runtime handoff path is separate). The installer creates the default runtime directory before installing the renewal systemd unit, even when production is configured to use `/etc/letsencrypt/live/...`; this keeps systemd mount-namespace validation valid when certbot reuses a still-valid lineage and skips the deploy hook. The installer invokes that same hook after every successful certbot invocation as well. The hook test generates an ephemeral certificate and verifies the copied certificate/key bytes and modes (`0644`/`0600`).

The GitHub deploy step starts its wrapper in a dedicated process session and traps cancellation to terminate only that release tree. This prevents a timed-out self-hosted runner from leaving a WAPI mutation process orphaned under PID 1. A later deployment always uses canonical `recover-preflight` and `recover-acme` exact-ownership cleanup; operators must not delete TXT rows manually.

After a verified issuance, `kcml-canonical-tls-renew.timer` runs the same stable
WEDOS DNS-01 hooks unattended. It attempts renewal a bounded three times, retains
the previous valid certificate whenever renewal, certificate validation, nginx
reload or health verification fails, and opens the durable critical
`tls.canonical_renewal_failed` alert through the existing primary/backup alert
ledger. A later verified renewal closes that same alert. The timer and its
failure/recovery units use the monitor's existing systemd credentials; no TLS
or WEDOS credential is copied into a new environment file. The renewal unit
keeps `ProtectSystem=strict`; its `ReadWritePaths` allow only the canonical TLS,
certbot state/log, nginx log and the two existing nginx site-log directories
needed by the actual certbot/nginx operations. No foreign nginx configuration
is changed by the KCML renewal service.

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
