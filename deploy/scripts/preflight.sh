#!/usr/bin/env bash
set -euo pipefail

nginx -t
ss -ltnp | grep -E ':(80|443)\s' >/dev/null
test -n "${DATABASE_URL:-}"
test -n "${PUBLIC_BASE_DOMAIN:-}"
test -n "${ADMIN_HOST:-}"
test -n "${AUTH_HOST:-}"
test -n "${REGISTER_HOST:-}"
test -n "${KCML_COMPONENT_HOST_SUFFIX:-}"
test -n "${ACCESS_TOKEN_HMAC_KEY_BASE64:-}"
test "${GENERATION_WORKER_ENABLED:-}" = "true"
test -n "${GENERATION_ROOT:-/var/lib/kcml/generation}"
test -n "${GENERATED_COMPONENT_ROOT:-/var/lib/kcml/generated-components}"
test "${MONITOR_ENABLED:-}" = "true"
test -n "${ALERT_PRIMARY_WEBHOOK_URL:-}"
test -n "${ALERT_PRIMARY_HMAC_KEY_BASE64:-}"
test -n "${ALERT_BACKUP_WEBHOOK_URL:-}"
test -n "${ALERT_BACKUP_HMAC_KEY_BASE64:-}"
test "${ALERT_PRIMARY_WEBHOOK_URL}" != "${ALERT_BACKUP_WEBHOOK_URL}"
tls_cert_path="${WILDCARD_TLS_CERT_PATH:-/etc/kcml/tls/fullchain.pem}"
tls_key_path="${WILDCARD_TLS_KEY_PATH:-${tls_cert_path%/*}/privkey.pem}"
test -f "$tls_cert_path"
test -f "$tls_key_path"
openssl x509 -in "$tls_cert_path" -checkend 86400 -noout
openssl x509 -in "$tls_cert_path" -noout -text | grep -F "DNS:*.${PUBLIC_BASE_DOMAIN}" >/dev/null
openssl x509 -in "$tls_cert_path" -noout -text | grep -F "DNS:*.${KCML_COMPONENT_HOST_SUFFIX}" >/dev/null
command -v systemd-run >/dev/null
command -v systemd-creds >/dev/null
test -x /usr/bin/unshare
test -x /usr/bin/mount
test -x /usr/sbin/chroot
test -x /usr/bin/setpriv
test -x /usr/bin/env
command -v "${SYSTEMCTL_BINARY:-systemctl}" >/dev/null
chromium_binary="${CHROMIUM_BINARY:-chromium}"
if [[ "$chromium_binary" == */* ]]; then
  test -x "$chromium_binary"
else
  command -v "$chromium_binary" >/dev/null
fi
command -v age >/dev/null
test -r "${AGE_RECIPIENT_FILE:-/etc/kcml/backup.age.recipient}"
install -d -m 0750 -o kcml -g kcml "${GENERATION_ROOT:-/var/lib/kcml/generation}" "${GENERATED_COMPONENT_ROOT:-/var/lib/kcml/generated-components}"
if ! id kcml-runtime >/dev/null 2>&1; then useradd --system --gid kcml --home-dir /nonexistent --shell /usr/sbin/nologin kcml-runtime; fi
runuser -u kcml-runtime -- /usr/bin/setpriv --no-new-privs /usr/bin/unshare --user --map-root-user --mount --net --ipc --uts --pid --fork --kill-child=SIGKILL /bin/true
install -d -m 0770 -o kcml-runtime -g kcml "${RUNTIME_SOCKET_ROOT:-/var/lib/kcml/runtime}"
audit_archive_dir="$(dirname "${AUDIT_ARCHIVE_PATH:-/var/lib/kcml/audit/archive.jsonl}")"
install -d -m 0700 -o kcml -g kcml /var/lib/kcml/egress "$audit_archive_dir"
runuser -u kcml -- test -w /var/lib/kcml/egress
runuser -u kcml -- test -w "$audit_archive_dir"
for service in web worker monitor egress migrator admin-sync alert-primary-sink alert-backup-sink; do
  test "$(stat -c '%a' "/etc/kcml/credentials/$service")" = "700"
  test -z "$(find "/etc/kcml/credentials/$service" -type f ! -perm 0600 -print -quit)"
done
node --check "${KCML_RELEASE_SOURCE:-/opt/kcml/current}/deploy/alert-sink/receiver.mjs" >/dev/null
echo "preflight-ok"
