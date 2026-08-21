#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/kcml-build-release.XXXXXX")"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

require_file() {
  local target_path="$1"
  if ! test -f "$target_path"; then
    echo "missing required release file: $target_path" >&2
    exit 1
  fi
}

require_executable() {
  local target_path="$1"
  if ! test -x "$target_path"; then
    echo "missing required executable release file: $target_path" >&2
    exit 1
  fi
}

forbid_file() {
  local target_path="$1"
  if test -e "$target_path"; then
    echo "unexpected retired release file present: $target_path" >&2
    exit 1
  fi
}

require_text() {
  local expected_text="$1"
  local target_path="$2"
  if ! grep -Fq "$expected_text" "$target_path"; then
    echo "missing required release text '$expected_text' in $target_path" >&2
    exit 1
  fi
}

forbid_text() {
  local forbidden_pattern="$1"
  local target_path="$2"
  if grep -R -I -E "$forbidden_pattern" "$target_path" >/dev/null 2>&1; then
    echo "unexpected retired release text matching '$forbidden_pattern' under $target_path" >&2
    grep -R -I -n -E "$forbidden_pattern" "$target_path" || true
    exit 1
  fi
}

test -x node_modules/.bin/vitest
BUILD_ID="test-build-release" SOURCE_COMMIT="test-source" RELEASE_REPOSITORY="test-owner/test-repository" RELEASE_WORKFLOW="test-owner/test-repository/.github/workflows/ci-deploy.yml@refs/heads/main" bash scripts/build-release.sh "$tmpdir/release"
test -x node_modules/.bin/vitest
release="$(node --input-type=module -e "import('./apps/server/dist/domain/release.js').then(({KCML_RELEASE}) => process.stdout.write(KCML_RELEASE.catalogVersion))")"

require_file "$tmpdir/release/docs/SSOT_CURRENT.md"
require_file "$tmpdir/release/docs/component-manifest-${release}.schema.json"
require_file "$tmpdir/release/docs/service-manifest-external-api-v1.0.example.json"
require_file "$tmpdir/release/docs/external-api-1.0.json"
jq -e '.sourceCommit == "test-source" and .repository == "test-owner/test-repository" and .workflow == "test-owner/test-repository/.github/workflows/ci-deploy.yml@refs/heads/main"' "$tmpdir/release/release-manifest.json" >/dev/null
require_file "$tmpdir/release/apps/server/dist/cli/generation-worker.js"
require_file "$tmpdir/release/apps/server/dist/cli/component-control-worker.js"
require_file "$tmpdir/release/apps/server/dist/cli/component-e2e-worker.js"
require_file "$tmpdir/release/apps/server/dist/cli/ensure-platform-worker-access.js"
require_file "$tmpdir/release/apps/server/dist/generation/runtime-host.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/runtime-probe.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/handler-sandbox.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/handler-sandbox-worker.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/browser-session.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/playwright-session.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/browser-automation-runtime.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/generation-cancellation.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/generation-release-cleanup.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/generation-failure-recovery.mjs"
require_file "$tmpdir/release/apps/server/dist/generation/generation-secret-grant-control.mjs"
require_file "$tmpdir/release/apps/server/dist/onboarding/generated-repair-enqueue.mjs"
require_file "$tmpdir/release/apps/server/src/generation/runtime-host.mjs"
require_file "$tmpdir/release/apps/server/src/contracts/component-manifest-${release}.schema.json"
require_file "$tmpdir/release/deploy/systemd/kcml-generation-worker.service"
require_file "$tmpdir/release/deploy/systemd/kcml-generated-component@.service"
require_executable "$tmpdir/release/deploy/scripts/kcml-generated-runtime-helper"

forbid_file "$tmpdir/release/deploy/systemd/kcml-onboarding-worker.service"
forbid_file "$tmpdir/release/deploy/scripts/kcml-handler-preload-wrapper.sh"
if find "$tmpdir/release/apps/server/node_modules" -type l -path '*/@kcml/server' -print -quit | grep -q .; then
  echo "unexpected workspace self-reference in release dependencies" >&2
  exit 1
fi
forbid_text '/v2/component-onboardings|repository-component-deploy|GHCR_TOKEN' "$tmpdir/release"

require_text '(.auth | sort) == ["access_token_bearer"]' "$tmpdir/release/deploy/scripts/install-release.sh"
require_text 'kcml-generation-worker.service' "$tmpdir/release/deploy/scripts/install-release.sh"
require_text 'kcml-generated-component@.service' "$tmpdir/release/deploy/scripts/install-release.sh"
require_text 'kcml-generated-runtime-helper' "$tmpdir/release/deploy/scripts/install-release.sh"
