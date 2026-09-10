#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

expected_sha="${1:?expected deployed commit SHA required}"
[[ "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "invalid expected SHA" >&2; exit 2; }
test "$(id -u)" = 0
test -f /etc/kcml/kcml.env
: "${PASS:?PASS is required}"

set -a
# shellcheck source=/dev/null
. /etc/kcml/kcml.env
set +a
base_url="${KCML_ACCEPTANCE_BASE_URL:-https://${ADMIN_HOST:?ADMIN_HOST is required}}"
case "$base_url" in https://*) ;; *) echo "acceptance base URL must use HTTPS" >&2; exit 2 ;; esac

started_ms="$(date +%s%3N)"
version_json="$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  -H "Host: ${ADMIN_HOST}" "$base_url/api/version")"
printf '%s' "$version_json" | jq -e --arg expected "$expected_sha" \
  '.commitSha == $expected' >/dev/null
echo "production-acceptance:deployedSha=$expected_sha:version=PASS"
health_json="$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  -H "Host: ${ADMIN_HOST}" "$base_url/health")"
printf '%s' "$health_json" | jq -e '.status == "ok"' >/dev/null
echo "production-acceptance:health=PASS"

release_dir="$(readlink -f /opt/kcml/current)"
test -f "$release_dir/apps/server/dist/cli/ssot-production-acceptance.js"
manifest_source_commit="$(jq -er '.sourceCommit' "$release_dir/release-manifest.json")"
manifest_build_id="$(jq -er '.buildId' "$release_dir/release-manifest.json")"
test "$manifest_source_commit" = "$expected_sha"
[[ "$manifest_build_id" == "$expected_sha"-* ]]
echo "production-acceptance:release-manifest=PASS:sourceCommit=$manifest_source_commit"
acceptance_log="$(mktemp)"
cleanup() { rm -f "$acceptance_log"; }
trap cleanup EXIT
if PASS="$PASS" \
  KCML_ACCEPTANCE_BROWSER_UID="$(id -u kcml)" \
  KCML_ACCEPTANCE_BROWSER_GID="$(id -g kcml)" \
  KCML_PROCESS_ROLE=migrate \
  DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
  CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
  NODE_ENV=production \
  BUILD_ID="$expected_sha-acceptance" \
  KCML_ACCEPTANCE_BASE_URL="$base_url" \
  node "$release_dir/apps/server/dist/cli/ssot-production-acceptance.js" >"$acceptance_log"; then
  status=0
else
  status=$?
fi
while IFS= read -r line; do echo "ssot-acceptance:$line"; done <"$acceptance_log"
elapsed_ms=$(( $(date +%s%3N) - started_ms ))
echo "production-acceptance:step=full-ssot:elapsedMs=$elapsed_ms:result=$([ "$status" -eq 0 ] && echo PASS || echo FAIL)"
exit "$status"
