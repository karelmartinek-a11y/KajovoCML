#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

expected_sha="${1:?expected deployed commit SHA required}"
[[ "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "invalid expected SHA" >&2; exit 2; }
test "$(id -u)" = 0
test -f /etc/kcml/kcml.env
set -a
# shellcheck source=/dev/null
. /etc/kcml/kcml.env
set +a
: "${PUBLIC_BASE_DOMAIN:?PUBLIC_BASE_DOMAIN is required}"
: "${PASS:?PASS is required}"

version_json="$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  -H "Host: ${ADMIN_HOST}" "https://${ADMIN_HOST}/api/version")"
printf '%s' "$version_json" | jq -e --arg expected "$expected_sha" '.commitSha == $expected' >/dev/null
release_dir="$(readlink -f /opt/kcml/current)"
manifest_source_commit="$(jq -er '.sourceCommit' "$release_dir/release-manifest.json")"
manifest_build_id="$(jq -er '.buildId' "$release_dir/release-manifest.json")"
test "$manifest_source_commit" = "$expected_sha"
[[ "$manifest_build_id" == "$expected_sha"-* ]]
echo "wedos-acceptance:release-manifest=PASS:sourceCommit=$manifest_source_commit"
test -f "$release_dir/apps/server/dist/cli/wedos-wapi.js"
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
KCML_ACME_ZONE="$PUBLIC_BASE_DOMAIN" NODE_ENV=production BUILD_ID="$expected_sha-infrastructure-acceptance" \
  node "$release_dir/apps/server/dist/cli/wedos-wapi.js" wapi-test-roundtrip
