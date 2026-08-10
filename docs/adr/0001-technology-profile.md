# ADR 0001: KCML technology profile

**Status:** ACTIVE — aligned with `docs/SSOT_CURRENT.md` as of 2026-08-09.

## Decision

KajovoCML is a modular control plane with separate public host roles for administration, authorization and canonical component HTTPS hostnames. New owner-created capabilities are produced by the internal `Generování` pipeline and run as local generated component releases behind the canonical CML HTTPS boundary.

The active stack is:

- Node.js 24 LTS, Fastify and TypeScript for the control plane;
- React 19 + Vite for the OWNER UI;
- PostgreSQL 16+ as the authoritative state store with forward SQL migrations in `apps/server/src/migrations`;
- Nginx/TLS host routing for the canonical `*.kajovocml.hcasc.cz` component namespace;
- local generated source workspaces, immutable local releases, systemd-managed runtime processes and Unix-domain sockets behind CML HTTPS routing;
- the existing CML component/principal permission model, Secret Manager, control queue, heartbeat/state, monitoring/watchdog, readiness evidence and append-only audit;
- OpenAI orchestration plus persistent Chromium/CDP browser automation for internal generation/integration work.

GitHub, GitHub Actions, pull requests, external CI/CD, GHCR and OCI registries are **not** part of generated component creation, deployment or completion gates. They may exist as unrelated operator tooling, but the generation runtime has no dependency on them.

## Generated handler capability boundary

AI-generated business `handler.mjs` code is untrusted business logic and executes inside the generated-runtime capability sandbox: an unprivileged user+mount+network namespace with a minimal read-only chroot plus a restricted Node module/context loader. It does not receive Node process authority, direct networking, arbitrary filesystem access or module loading. Side effects are available only through the CML context supplied by the trusted runtime host:

- `context.secret(...)` — existing KajovoCML Secret Manager;
- `context.callComponent(...)` — canonical CML component authorization/routing;
- `context.callExternal(...)` — existing CML external egress permission/gateway;
- `context.state.get/set/delete(...)` — explicitly bounded persistent component state.

Direct `fetch`, Node network/process/filesystem/child-process modules, `process.env`, dynamic imports and runtime code generation are not a supported or permitted generated-handler path. This is enforcement of the existing CML boundary, not a second security plane.

## Security and lifecycle invariants

- The public hostname is a CML security/routing boundary.
- Authorization and inter-component dependencies use existing principals and row-scoped CML permissions; there is no wildcard generated-component bypass.
- Runtime credentials and persistent provider credentials use the existing CML identity/Secret Manager mechanisms.
- OWNER plaintext credentials may be supplied in the trusted OWNER interaction; persistence for runtime use belongs in Secret Manager.
- A generated component is activated only after actual revision-bound CML conformance evidence passes.
- OWNER enable/disable and generation-job cancel are authoritative control operations.
- Generated runtime faults remain observable through the existing monitoring/watchdog, alerts and audit; eligible `INTERNAL_GENERATED` faults may enqueue a repair generation job using the same generation model and local rollback path.
