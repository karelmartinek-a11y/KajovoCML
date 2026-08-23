#!/usr/bin/env bash
set -euo pipefail

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
certbot_root="$workspace/letsencrypt"
lineage="kcml-wildcards-0001"
mkdir -p "$certbot_root/renewal" "$certbot_root/live/$lineage" "$workspace/runtime"

openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj '/CN=hcasc.cz' \
  -addext 'subjectAltName=DNS:hcasc.cz,DNS:*.hcasc.cz,DNS:*.kajovocml.hcasc.cz' \
  -keyout "$certbot_root/live/$lineage/privkey.pem" \
  -out "$certbot_root/live/$lineage/fullchain.pem" >/dev/null 2>&1
touch "$certbot_root/renewal/$lineage.conf"
cp "$certbot_root/live/$lineage/fullchain.pem" "$workspace/runtime/fullchain.pem"

# shellcheck disable=SC1091
source deploy/scripts/certbot-lineage.sh

resolved="$(KCML_CERTBOT_ROOT="$certbot_root" resolve_certbot_lineage_name "$workspace/runtime/fullchain.pem")"
test "$resolved" = "$lineage"
resolved="$(KCML_CERTBOT_ROOT="$certbot_root" resolve_certbot_lineage_name "$certbot_root/live/$lineage/fullchain.pem")"
test "$resolved" = "$lineage"

touch "$certbot_root/renewal/explicit.conf"
resolved="$(KCML_CERTBOT_ROOT="$certbot_root" KCML_CERTBOT_CERT_NAME=explicit resolve_certbot_lineage_name "$workspace/runtime/fullchain.pem")"
test "$resolved" = explicit

# Two matching SAN lineages without an explicit owner must fail closed.
second="kcml-wildcards-0002"
mkdir -p "$certbot_root/live/$second"
cp "$certbot_root/live/$lineage/fullchain.pem" "$certbot_root/live/$second/fullchain.pem"
cp "$certbot_root/live/$lineage/privkey.pem" "$certbot_root/live/$second/privkey.pem"
touch "$certbot_root/renewal/$second.conf"
if KCML_CERTBOT_ROOT="$certbot_root" KCML_CERTBOT_CERT_NAME= \
  resolve_certbot_lineage_name "$workspace/runtime/missing.pem" >/dev/null 2>&1; then
  echo "ambiguous certbot lineage unexpectedly resolved" >&2
  exit 1
fi

echo "certbot-lineage: PASS"
