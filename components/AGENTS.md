# AGENTS.md

## Scope

These rules apply to every path below `components/` and strengthen the repository root contract.

## Directory boundary

- Create one logical component only in `components/<repository-key>/` where the key matches `^[a-z0-9][a-z0-9-]{2,62}$`.
- Components may also be maintained outside KajovoCML; this subtree governs only the in-repository case.
- Do not place generated components in `apps/`, `packages/` or the retired `handlers/` source pipeline.
- Do not use a KCML code or hostname as the repository key. KCML assigns identity during registration.
- Do not import source code from another component directory or from private `apps/` implementation paths.

## Required contract

- Follow `docs/onboarding-catalogs/repository-component-1.1.json`, the source manifest schema and the current companion component catalog without reducing any of those contracts.
- Keep `component.kcml.json`, the source-phase `manifest.kcml.json`, package metadata, tests and evidence synchronized with executable behavior.
- Use Node.js 24, ESM, pnpm 11.7.0, an isolated lockfile and exact dependency versions.
- Export asynchronous `invoke(input, context)` from `src/index.ts` and provide complete lint, typecheck, test and build scripts.
- Include real architecture, threat-model and runbook evidence. Placeholders, samples represented as completion and fake digests are forbidden.

## Security and lifecycle

- Never commit integration tokens, access tokens, secrets, credentials, `.env` files or runtime-generated secret material.
- Use only KCML-authorized secret grants and the KCML egress path; direct database access and uncontrolled outbound networking are forbidden.
- A green source PR or signed image is not registration. Deploy the immutable runtime, finalize the real manifest from `manifest.kcml.json` plus the deploy receipt, register through `/v2/component-onboardings`, resolve all gates and preserve only a nonsecret receipt.
- The integration token does not authorize GitHub writes, merge, deployment or administrative activation.

## Verification

For a clean change limited to one `components/<repository-key>/**` tree, run from the repository root:

```bash
corepack pnpm repository-catalog:check
corepack pnpm repository-components:check
```

Then run in isolated-workspace mode for that component only:

```bash
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node ../../scripts/onboarding/contract-test.mjs .
pnpm --ignore-workspace audit --prod --audit-level high
```

Reproducible build verification is required for clean component-only changes. Full `corepack pnpm run ci` remains mandatory whenever a diff also touches `apps/**`, `packages/**`, catalogs, schemas, generators, validators, workflows, deployment infrastructure, onboarding API or migrations.

Never claim successful registration, readiness or activation without inspecting the corresponding KCML job and gate evidence.

## Completion Report

Every completed component creation or update report must list only verified facts and must include:

- `repository-key`
- component kind
- changed files
- component PR
- merge commit
- isolated test results
- component workflow run
- image reference
- image digest
- signature
- SBOM
- provenance
- deploy workflow run
- deploy receipt
- production runtime identifier
- actual runtime path or URL
- onboarding job ID
- assigned KCML code
- assigned hostname
- revisions status
- readiness status
- access-token handoff status
- administrator activation status
- health, heartbeat, state, control, Pulse and audit check results
- result of a real functional component scenario
- rollback availability status
- every still-open blocker

Any step that was not executed must be marked as not executed, never as successful.
