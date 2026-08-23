#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${KCML_RELEASE_SOURCE:?KCML_RELEASE_SOURCE is required}"
: "${PUBLIC_BASE_DOMAIN:?PUBLIC_BASE_DOMAIN is required}"
: "${ADMIN_HOST:?ADMIN_HOST is required}"
certificate_path="${WILDCARD_TLS_CERT_PATH:-/etc/kcml/tls/fullchain.pem}"
private_key_path="${WILDCARD_TLS_KEY_PATH:-${certificate_path%/*}/privkey.pem}"
source "$KCML_RELEASE_SOURCE/deploy/scripts/certbot-lineage.sh"
hook_root="/usr/local/libexec/kcml"
auth_hook="$hook_root/acme-auth-hook.sh"
cleanup_hook="$hook_root/acme-cleanup-hook.sh"
deploy_hook="$hook_root/acme-deploy-hook.sh"
install -d -m 0700 /run/kcml
renewal_backup="$(mktemp -d /run/kcml/canonical-tls-renewal.XXXXXX)"
cert_backup="$renewal_backup/fullchain.pem"
key_backup="$renewal_backup/privkey.pem"
had_certificate=false
had_private_key=false
cleanup() { rm -rf "$renewal_backup"; }
trap cleanup EXIT

test -x "$auth_hook" -a -x "$cleanup_hook" -a -x "$deploy_hook"
certbot_cert_name="$(KCML_CERTBOT_BASE_DOMAIN="$PUBLIC_BASE_DOMAIN" resolve_certbot_lineage_name "$certificate_path")"
certbot_lineage="/etc/letsencrypt/live/$certbot_cert_name"
test -s "$certbot_lineage/fullchain.pem" -a -s "$certbot_lineage/privkey.pem"
if [ -s "$certificate_path" ]; then cp --preserve=mode,timestamps "$certificate_path" "$cert_backup"; had_certificate=true; fi
if [ -s "$private_key_path" ]; then cp --preserve=mode,timestamps "$private_key_path" "$key_backup"; had_private_key=true; fi

certificate_contract() {
  test -s "$certificate_path" && test -s "$private_key_path"
  openssl x509 -in "$certificate_path" -checkend 1 -noout >/dev/null
  openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:${PUBLIC_BASE_DOMAIN}" >/dev/null
  openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:*.${PUBLIC_BASE_DOMAIN}" >/dev/null
  openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:*.kajovocml.${PUBLIC_BASE_DOMAIN}" >/dev/null
  openssl x509 -in "$certificate_path" -noout -pubkey 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 >"$renewal_backup/cert.pub.digest"
  openssl pkey -in "$private_key_path" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 >"$renewal_backup/key.pub.digest"
  cmp -s "$renewal_backup/cert.pub.digest" "$renewal_backup/key.pub.digest"
}

restore_previous() {
  if [ "$had_certificate" = true ] && [ "$had_private_key" = true ]; then
    install -m 0644 "$cert_backup" "$certificate_path"
    install -m 0600 "$key_backup" "$private_key_path"
    nginx -t >/dev/null
    systemctl reload nginx
  else
    rm -f "$certificate_path" "$private_key_path"
  fi
}

renewed=false
for attempt in 1 2 3; do
  if env \
    KCML_ACME_ZONE="$PUBLIC_BASE_DOMAIN" \
    KCML_TLS_CERT_PATH="$certificate_path" \
    KCML_TLS_KEY_PATH="$private_key_path" \
    certbot renew \
      --cert-name "$certbot_cert_name" \
      --non-interactive \
      --manual \
      --preferred-challenges dns \
      --manual-auth-hook "$auth_hook" \
      --manual-cleanup-hook "$cleanup_hook" \
      --deploy-hook "$deploy_hook"; then
    renewed=true
    break
  fi
  [ "$attempt" -lt 3 ] && sleep 30
done
if [ "$renewed" != true ]; then
  restore_previous
  exit 1
fi

if ! certificate_contract; then
  restore_previous
  exit 1
fi
# certbot skips --deploy-hook when this lineage is not due for renewal. The
# existing verified lineage must still be materialised into KCML's canonical
# runtime pair before nginx is reloaded.
RENEWED_LINEAGE="$certbot_lineage" \
KCML_TLS_CERT_PATH="$certificate_path" \
KCML_TLS_KEY_PATH="$private_key_path" \
  "$deploy_hook"
if ! nginx -t >/dev/null || ! systemctl reload nginx; then
  restore_previous
  exit 1
fi
if ! curl --fail --silent --show-error --max-time 15 "https://${ADMIN_HOST}/health" >/dev/null; then
  restore_previous
  exit 1
fi
echo "canonical-tls-renewal:verified"
