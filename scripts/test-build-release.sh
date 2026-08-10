#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/kcml-build-release.XXXXXX")"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

test -x node_modules/.bin/vitest
BUILD_ID="test-build-release" SOURCE_COMMIT="test-source" bash scripts/build-release.sh "$tmpdir/release"
test -x node_modules/.bin/vitest
release="$(node --input-type=module -e "import('./apps/server/dist/domain/release.js').then(({KCML_RELEASE}) => process.stdout.write(KCML_RELEASE.catalogVersion))")"

test -f "$tmpdir/release/docs/SSOT_CURRENT.md"
test -f "$tmpdir/release/docs/component-manifest-${release}.schema.json"
test -f "$tmpdir/release/docs/service-manifest-external-api-v1.0.example.json"
test -f "$tmpdir/release/docs/external-api-1.0.json"
test -f "$tmpdir/release/apps/server/dist/cli/generation-worker.js"
test -f "$tmpdir/release/apps/server/dist/cli/component-control-worker.js"
test -f "$tmpdir/release/apps/server/dist/cli/component-e2e-worker.js"
test -f "$tmpdir/release/apps/server/dist/cli/ensure-platform-worker-access.js"
test -f "$tmpdir/release/apps/server/dist/generation/runtime-host.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/runtime-probe.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/handler-sandbox.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/handler-sandbox-worker.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/browser-session.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/generation-cancellation.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/generation-release-cleanup.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/generation-failure-recovery.mjs"
test -f "$tmpdir/release/apps/server/dist/generation/generation-secret-grant-control.mjs"
test -f "$tmpdir/release/apps/server/dist/onboarding/generated-repair-enqueue.mjs"
test -f "$tmpdir/release/apps/server/src/generation/runtime-host.mjs"
test -f "$tmpdir/release/apps/server/src/contracts/component-manifest-${release}.schema.json"
test -f "$tmpdir/release/deploy/systemd/kcml-generation-worker.service"
test -f "$tmpdir/release/deploy/systemd/kcml-generated-component@.service"
test -x "$tmpdir/release/deploy/scripts/kcml-generated-runtime-helper"

if test -e "$tmpdir/release/deploy/systemd/kcml-onboarding-worker.service"; then exit 1; fi
if test -e "$tmpdir/release/deploy/scripts/kcml-handler-preload-wrapper.sh"; then exit 1; fi
if grep -R -I -E '/v2/component-onboardings|repository-component-deploy|GHCR_TOKEN' "$tmpdir/release" >/dev/null 2>&1; then exit 1; fi

grep -Fq '(.auth | sort) == ["access_token_bearer"]' "$tmpdir/release/deploy/scripts/install-release.sh"
grep -Fq 'kcml-generation-worker.service' "$tmpdir/release/deploy/scripts/install-release.sh"
grep -Fq 'kcml-generated-component@.service' "$tmpdir/release/deploy/scripts/install-release.sh"
grep -Fq 'kcml-generated-runtime-helper' "$tmpdir/release/deploy/scripts/install-release.sh"
