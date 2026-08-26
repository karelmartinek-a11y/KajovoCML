#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "production-shaped-generated-runtime:FAIL non-Linux runner" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n env KCML_SANDBOX_TEST_ELEVATED=1 "$0" "$@"
fi
echo "production-shaped-generated-runtime:os=$(uname -sr):uid=$(id -u):systemd-creds=$(command -v systemd-creds || echo missing)"
command -v systemd-creds >/dev/null
set -x
for path in \
  deploy/scripts/kcml-generated-runtime-helper \
  deploy/systemd/kcml-generated-component@.service \
  apps/server/src/generation/runtime-host.mjs \
  apps/server/src/generation/handler-sandbox.mjs; do
  if ! test -e "$path"; then
    echo "production-shaped-generated-runtime:missing-path=$path" >&2
    exit 1
  fi
done
require_text() {
  local expected="$1" path="$2"
  if ! grep -Fq "$expected" "$path"; then
    echo "production-shaped-generated-runtime:missing-contract=$expected:file=$path" >&2
    exit 1
  fi
}
require_text 'LoadCredentialEncrypted=runtime_token:' deploy/systemd/kcml-generated-component@.service
require_text 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' deploy/systemd/kcml-generated-component@.service
require_text 'KCML_RUNTIME_SOCKET' apps/server/src/generation/runtime-host.mjs
require_text 'mount' apps/server/src/generation/handler-sandbox.mjs
set +x

# Exercise the same helper and encrypted credential format used by the
# production unit. The unique component directory is always removed below.
component_code="kcml9971"
component_root="/var/lib/kcml/generated-components/$component_code"
cleanup() { rm -rf "$component_root"; }
trap cleanup EXIT
echo "production-shaped-generated-runtime:helper-prepare=START"
deploy/scripts/kcml-generated-runtime-helper prepare "$component_code"
runtime_token="kcml_runtime_test_$(date +%s%N)"
echo "production-shaped-generated-runtime:credential-encrypt=START"
printf '%s\n' "$runtime_token" | deploy/scripts/kcml-generated-runtime-helper credential-stdin "$component_code"
test -s "$component_root/runtime-token.cred"
decrypted="$(mktemp)"
trap 'rm -f "$decrypted"; cleanup' EXIT
echo "production-shaped-generated-runtime:credential-decrypt=START"
systemd-creds decrypt "$component_root/runtime-token.cred" "$decrypted"
test "$(cat "$decrypted")" = "$runtime_token"
rm -f "$decrypted"
echo "production-shaped-generated-runtime:helper=PASS:encrypted-credential=PASS"

# These are the real namespace/chroot and runtime restart tests. They are
# intentionally not replaced by a fixture-only assertion or a symbol check.
node scripts/test-generated-handler-capabilities.mjs
node scripts/test-generated-component-runtime.mjs
echo "production-shaped-generated-runtime:PASS"
