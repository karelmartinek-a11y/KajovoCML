#!/usr/bin/env bash
set -euo pipefail

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
lineage="$workspace/lineage"
target="$workspace/target"
mkdir -p "$lineage"

# This exercises the real atomic installer with an ephemeral certificate,
# rather than checking only that the hook text exists.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj '/CN=kcml-tls-hook-test.invalid' \
  -keyout "$lineage/privkey.pem" -out "$lineage/fullchain.pem" >/dev/null 2>&1

RENEWED_LINEAGE="$lineage" \
KCML_TLS_CERT_PATH="$target/fullchain.pem" \
KCML_TLS_KEY_PATH="$target/privkey.pem" \
  bash deploy/scripts/acme-deploy-hook.sh

cmp "$lineage/fullchain.pem" "$target/fullchain.pem"
cmp "$lineage/privkey.pem" "$target/privkey.pem"
file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}
test "$(file_mode "$target/fullchain.pem")" = "644"
test "$(file_mode "$target/privkey.pem")" = "600"

# Regression for a valid certbot reuse: ensure-canonical-tls must explicitly
# materialise the resolved lineage after certbot exits, because certbot can
# skip its deploy hook when no renewal is needed.
awk '
  /test "\$certbot_exit" = 0/ { seen_exit=NR }
  /RENEWED_LINEAGE="\$certbot_lineage"/ { seen_lineage=NR }
  END { exit !(seen_exit && seen_lineage > seen_exit) }
' deploy/scripts/ensure-canonical-tls.sh

echo "acme-deploy-hook: PASS"
