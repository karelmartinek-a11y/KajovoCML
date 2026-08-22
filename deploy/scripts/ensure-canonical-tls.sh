#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

base_domain="${1:?base domain required}"
component_suffix="${2:?component hostname suffix required}"
certificate_path="${3:?certificate path required}"
private_key_path="${4:?private key path required}"
source_dir="${5:?verified release source required}"
config_vault_master_key_file="${CONFIG_VAULT_MASTER_KEY_BASE64_FILE:-/etc/kcml/credentials/config_vault_master_key}"
runtime_dir="/run/kcml"
pid_file="$runtime_dir/canonical-certbot.pid"
certbot_pid=""
hook_root="/usr/local/libexec/kcml"
auth_hook="$hook_root/acme-auth-hook.sh"
cleanup_hook="$hook_root/acme-cleanup-hook.sh"
deploy_hook="$hook_root/acme-deploy-hook.sh"

install -d -m 0755 "$hook_root"
install -m 0755 "$source_dir/deploy/scripts/acme-auth-hook.sh" "$auth_hook"
install -m 0755 "$source_dir/deploy/scripts/acme-cleanup-hook.sh" "$cleanup_hook"
install -m 0755 "$source_dir/deploy/scripts/acme-deploy-hook.sh" "$deploy_hook"

for domain in "$base_domain" "$component_suffix"; do
  case "$domain" in
    ""|.*|*.|*..*|*[!a-z0-9.-]*) echo "invalid TLS domain" >&2; exit 1 ;;
  esac
done
case "$component_suffix" in
  "$base_domain"|*."$base_domain") ;;
  *) echo "component suffix is outside the base domain" >&2; exit 1 ;;
esac

certificate_covers_runtime() {
  test -s "$certificate_path" \
    && test -s "$private_key_path" \
    && openssl x509 -in "$certificate_path" -checkend 2592000 -noout >/dev/null 2>&1 \
    && openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:${base_domain}" >/dev/null \
    && openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:*.${base_domain}" >/dev/null \
    && openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:*.${component_suffix}" >/dev/null \
    && openssl x509 -in "$certificate_path" -noout -text | grep -F "DNS:*.kajovocml.${base_domain}" >/dev/null \
    && openssl x509 -in "$certificate_path" -noout -pubkey | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 \
      | grep -F "$(openssl pkey -in "$private_key_path" -pubout -outform DER 2>/dev/null | openssl dgst -sha256)" >/dev/null
}

if certificate_covers_runtime; then
  echo "canonical-tls:READY"
  exit 0
fi

command -v certbot >/dev/null
command -v pkill >/dev/null
test -r "$config_vault_master_key_file"
install -d -m 0700 "$runtime_dir"
terminate_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for _attempt in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  kill -KILL "$pid" 2>/dev/null || true
}
terminate_stale_certbot() {
  local pid command
  if [ -s "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      command="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      case "$command" in
        *certbot*certonly*"--cert-name kcml-wildcards"*) terminate_pid "$pid" ;;
      esac
    fi
  fi
  while read -r pid command; do
    case "$command" in
      *certbot*certonly*"--cert-name kcml-wildcards"*) terminate_pid "$pid" ;;
    esac
  done < <(ps -eo pid=,args=)
  rm -f "$pid_file"
}
cleanup() {
  if [ -n "$certbot_pid" ] && kill -0 "$certbot_pid" 2>/dev/null; then
    kill -TERM -- "-$certbot_pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

terminate_stale_certbot

# The release wrapper already owns a dedicated session. Creating a second
# session here would let certbot survive GitHub cancellation as an orphan.
# Keep the certbot process in the release session so both cancellation paths
# terminate the exact TLS child tree; durable WEDOS recovery handles a
# persisted operation on the next attempt.
env \
  KCML_ACME_ZONE="$base_domain" \
  KCML_TLS_CERT_PATH="$certificate_path" \
  KCML_TLS_KEY_PATH="$private_key_path" \
  KCML_RELEASE_SOURCE="$source_dir" \
  CONFIG_VAULT_MASTER_KEY_BASE64_FILE="$config_vault_master_key_file" \
  KCML_PROCESS_ROLE=migrate \
  certbot certonly \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --manual \
  --preferred-challenges dns \
  --manual-auth-hook "$auth_hook" \
  --manual-cleanup-hook "$cleanup_hook" \
  --deploy-hook "$deploy_hook" \
  --cert-name kcml-wildcards \
  -d "$base_domain" \
  -d "*.${base_domain}" \
  -d "*.${component_suffix}" &
certbot_pid="$!"
printf '%s\n' "$certbot_pid" >"$pid_file"
chmod 0600 "$pid_file"
set +e
wait "$certbot_pid"
certbot_exit="$?"
set -e
certbot_pid=""
rm -f "$pid_file"
test "$certbot_exit" = 0

# certbot intentionally does not invoke --deploy-hook when the named lineage
# is already valid and it therefore reuses it. The KCML runtime path can still
# be absent (for example after migrating from a pre-canonical install), so
# atomically materialise the canonical pair on that successful reuse path.
RENEWED_LINEAGE="/etc/letsencrypt/live/kcml-wildcards" \
KCML_TLS_CERT_PATH="$certificate_path" \
KCML_TLS_KEY_PATH="$private_key_path" \
  "$deploy_hook"

certificate_covers_runtime
echo "canonical-tls:ISSUED"
