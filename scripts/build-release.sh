#!/usr/bin/env bash
set -euo pipefail
umask 022

destination="${1:?release destination required}"
build_id="${BUILD_ID:-local-$(date -u +%Y%m%d%H%M%S)}"
source_commit="${SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || printf 'local')}"
catalog_version="$(node --input-type=module -e "import('./apps/server/dist/domain/release.js').then(({KCML_RELEASE}) => process.stdout.write(KCML_RELEASE.catalogVersion))")"
workspace_restore_required=false

restore_workspace_dependencies() {
  if [ "$workspace_restore_required" = "true" ]; then
    CI=true pnpm install --frozen-lockfile
    find node_modules -type f -name '._*' -delete
  fi
}
trap restore_workspace_dependencies EXIT

rm -rf "$destination"
install -d -m 0755 "$destination/apps" "$destination/deploy" "$destination/docs" "$destination/scripts"
pnpm_major="$(pnpm --version | cut -d. -f1)"
workspace_restore_required=true
if [ "$pnpm_major" -ge 10 ]; then
  pnpm --filter @kcml/server deploy --prod --legacy "$destination/apps/server"
else
  pnpm --filter @kcml/server deploy --prod "$destination/apps/server"
fi
restore_workspace_dependencies
workspace_restore_required=false
trap - EXIT

install -d -m 0755 "$destination/apps/admin-ui"
cp -R apps/admin-ui/dist "$destination/apps/admin-ui/dist"
install -d -m 0755 "$destination/apps/server/dist/migrations" "$destination/apps/server/dist/generation" "$destination/apps/server/dist/onboarding" "$destination/apps/server/src/contracts" "$destination/apps/server/src/generation"
cp apps/server/src/migrations/*.sql "$destination/apps/server/dist/migrations/"
# .mjs runtime assets are not emitted by tsc; both dist runtime and generation source reference need them.
cp apps/server/src/generation/runtime-host.mjs apps/server/src/generation/runtime-probe.mjs apps/server/src/generation/handler-sandbox.mjs apps/server/src/generation/handler-sandbox-worker.mjs apps/server/src/generation/browser-session.mjs apps/server/src/generation/generation-cancellation.mjs apps/server/src/generation/external-http-capability.mjs apps/server/src/generation/integration-phase.mjs apps/server/src/generation/generation-secret-plan.mjs apps/server/src/generation/provider-secret-capability.mjs apps/server/src/generation/generation-release-cleanup.mjs apps/server/src/generation/generation-failure-recovery.mjs apps/server/src/generation/generation-secret-grant-control.mjs "$destination/apps/server/dist/generation/"
cp apps/server/src/onboarding/generated-repair-enqueue.mjs "$destination/apps/server/dist/onboarding/"
cp apps/server/src/generation/runtime-host.mjs apps/server/src/generation/handler-sandbox.mjs apps/server/src/generation/handler-sandbox-worker.mjs "$destination/apps/server/src/generation/"
cp "apps/server/src/contracts/component-manifest-${catalog_version}.schema.json" "$destination/apps/server/src/contracts/"
cp -R deploy/alert-sink deploy/nginx deploy/scripts deploy/systemd "$destination/deploy/"
cp docs/SSOT_CURRENT.md "$destination/docs/SSOT_CURRENT.md"
cp "apps/server/src/contracts/component-manifest-${catalog_version}.schema.json" "$destination/docs/"
cp docs/service-manifest-external-api-v1.0.example.json "$destination/docs/"
cp docs/onboarding-catalogs/external-api-1.0.json "$destination/docs/external-api-1.0.json"
cp -R docs/releases "$destination/docs/releases" 2>/dev/null || true
# Release artifacts must exclude test sources/outputs so retired onboarding-only
# strings in fixtures never leak into production packages.
find "$destination/apps/server" -type f \( -name '*.test.js' -o -name '*.test.d.ts' -o -name '*.test.ts' -o -name '*.test.tsx' \) -delete
find "$destination" -type f -name '._*' -delete

jq -n \
  --arg buildId "$build_id" \
  --arg sourceCommit "$source_commit" \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{schemaVersion:2,buildId:$buildId,sourceCommit:$sourceCommit,createdAt:$createdAt,nodeVersion:env.NODE_VERSION,pnpmVersion:env.PNPM_VERSION,generationModel:"internal-local"}' \
  > "$destination/release-manifest.json"

find "$destination" -type d -exec chmod 0755 {} +
find "$destination" -type f -exec chmod 0644 {} +
find "$destination/deploy/scripts" -type f -name '*.sh' -exec chmod 0755 {} +
chmod 0755 "$destination/deploy/scripts/kcml-generated-runtime-helper"
