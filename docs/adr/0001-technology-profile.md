# ADR 0001: KCML technology profile

## Decision

KCML is implemented as a modular monolith with separate public host roles:
`admin.hcasc.cz`, `auth.hcasc.cz`, and `kcmlNNNN.hcasc.cz`.

The production stack is:

- Node.js 22 LTS, Fastify, TypeScript.
- React 19 + Vite for the admin UI.
- PostgreSQL 16+ as the only authoritative state store.
- SQL migrations committed in `apps/server/src/migrations`.
- Nginx reverse proxy with exact host routing.
- GitHub Actions CI and deployment over SSH/systemd/compose.

## Rationale

The SSOT requires React 19 + TypeScript, PostgreSQL 16+, host based routing,
strict token handling, migrations, CI gates, rollback, and shared Ubuntu
production operation. A modular monolith keeps transaction boundaries and
fail-closed catalog decisions in one authoritative process while still exposing
separate host roles.

## Security invariants

- Hostname is a security boundary and is resolved before any MCP metadata or
handler dispatch.
- No wildcard permissions exist. Kaja permissions are row scoped to one MCP
server.
- Client secrets and access tokens use 64 CSPRNG bytes before Base64URL
encoding.
- Full token values are never stored; client secrets use Argon2id, access
tokens use HMAC-SHA-256 lookup digests with a server-side key.
- Admin password comes only from deployment secret `PASS`; MFA must also be
configured before login can succeed.
- Audit is append-only from the application perspective.
