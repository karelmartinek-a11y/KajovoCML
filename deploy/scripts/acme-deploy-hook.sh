#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${RENEWED_LINEAGE:?RENEWED_LINEAGE is required}"
: "${KCML_TLS_CERT_PATH:?KCML_TLS_CERT_PATH is required}"
: "${KCML_TLS_KEY_PATH:?KCML_TLS_KEY_PATH is required}"

test -s "$RENEWED_LINEAGE/fullchain.pem"
test -s "$RENEWED_LINEAGE/privkey.pem"
install -d -m 0700 "$(dirname "$KCML_TLS_CERT_PATH")" "$(dirname "$KCML_TLS_KEY_PATH")"

cert_tmp="$(mktemp "${KCML_TLS_CERT_PATH}.tmp.XXXXXX")"
key_tmp="$(mktemp "${KCML_TLS_KEY_PATH}.tmp.XXXXXX")"
cleanup() { rm -f "$cert_tmp" "$key_tmp"; }
trap cleanup EXIT
install -m 0644 "$RENEWED_LINEAGE/fullchain.pem" "$cert_tmp"
install -m 0600 "$RENEWED_LINEAGE/privkey.pem" "$key_tmp"
mv -f "$cert_tmp" "$KCML_TLS_CERT_PATH"
mv -f "$key_tmp" "$KCML_TLS_KEY_PATH"
