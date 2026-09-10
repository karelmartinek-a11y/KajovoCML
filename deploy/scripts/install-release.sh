#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

source_dir="${1:?verified release directory required}"
release_id="${2:?release id required}"
case "$release_id" in
  *[!A-Za-z0-9._-]*) echo "invalid release id" >&2; exit 1 ;;
esac
test "$(id -u)" = "0"
test -f "$source_dir/release-manifest.json"
test -f /etc/kcml/kcml.env
: "${PASS:?PASS is required}"

set -a
# shellcheck source=/dev/null
. /etc/kcml/kcml.env
set +a
export BUILD_ID="$release_id"
# Older installations predate explicit control-plane host variables. Derive
# only missing values from their configured base domain during the upgrade.
# shellcheck source=/dev/null
. "$source_dir/deploy/scripts/control-plane-hosts.sh"
component_hostname_suffix="${KCML_COMPONENT_HOST_SUFFIX:-$PUBLIC_BASE_DOMAIN}"
[[ "$component_hostname_suffix" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]

# systemd validates every ReadWritePaths entry while creating the renewal
# service mount namespace.  A valid existing certificate can make the ACME
# deploy hook skip its materialisation path, so the default canonical runtime
# directory must exist before the timer/service is installed even when the
# configured certificate lives under /etc/letsencrypt.
install -d -m 0700 /etc/kcml/tls

release_dir="/opt/kcml/releases/$release_id"
previous_release="$(readlink -f /opt/kcml/current 2>/dev/null || true)"
test ! -e "$release_dir"
install -d -m 0755 /opt/kcml/releases
if [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
  previous_release_id="$(basename "$previous_release")"
  bash "$source_dir/deploy/scripts/release-config.sh" snapshot "$previous_release_id"
else
  previous_release_id=""
fi
switched=false
current_step="init"
step_started_ms=0
step_timing_file="$(mktemp)"
trap 'rm -f "$step_timing_file"' EXIT
now_ms() { date +%s%3N; }
finish_step() {
  if [ "$step_started_ms" -gt 0 ]; then
    elapsed_ms=$(( $(now_ms) - step_started_ms ))
    result="${1:-PASS}"
    echo "release-step:$current_step:elapsedMs=$elapsed_ms:result=$result"
    printf '%s\t%s\t%s\n' "$elapsed_ms" "$current_step" "$result" >>"$step_timing_file"
  fi
}
step() {
  finish_step
  current_step="$1"
  step_started_ms="$(now_ms)"
  echo "release-step:$current_step:started"
}
render_nginx_config() {
  local template="$1" target="$2"
  : "${PUBLIC_BASE_DOMAIN:?PUBLIC_BASE_DOMAIN is required}"
  : "${ADMIN_HOST:?ADMIN_HOST is required}"
  : "${AUTH_HOST:?AUTH_HOST is required}"
  : "${REGISTER_HOST:?REGISTER_HOST is required}"
  local tls_cert_path="${WILDCARD_TLS_CERT_PATH:-/etc/kcml/tls/fullchain.pem}"
  local tls_key_path="${WILDCARD_TLS_KEY_PATH:-${tls_cert_path%/*}/privkey.pem}"
  node "$source_dir/deploy/scripts/render-nginx-config.mjs" \
    "$template" "$target" "$PUBLIC_BASE_DOMAIN" "$component_hostname_suffix" "$ADMIN_HOST" "$AUTH_HOST" "$REGISTER_HOST" "$tls_cert_path" "$tls_key_path"
}
wait_for_sql_equals() {
  local label="$1" expected="$2" query="$3" attempts="${4:-1}" delay="${5:-2}"
  local actual=""
  for _attempt in $(seq 1 "$attempts"); do
    actual="$(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --command "$query")"
    if [ "$actual" = "$expected" ]; then
      echo "release-check:$label=$actual"
      return 0
    fi
    sleep "$delay"
  done
  echo "release-check-failed:$label expected=$expected actual=$actual" >&2
  return 1
}
effective_admin_username() {
  local fallback="${ADMIN_BOOTSTRAP_USERNAME:-}"
  psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet \
    --set fallback="$fallback" <<'SQL'
select coalesce(
  (select value_json #>> '{}' from operational_config_setting where key='adminBootstrapUsername' and value_json is not null),
  (select username from admin_account where role='OWNER' and active=true order by activated_at desc nulls last, created_at desc limit 1),
  nullif(:'fallback','')
)
SQL
}
rollback_on_error() {
  exit_code=$?
  trap - ERR
  finish_step FAIL
  echo "release-failed:$current_step" >&2
  if [ -n "$previous_release_id" ] && [ -d "$previous_release" ]; then
    if [ "$switched" = "true" ]; then
      restore_script="$release_dir/deploy/scripts/release-config.sh"
    else
      restore_script="$source_dir/deploy/scripts/release-config.sh"
    fi
    bash "$restore_script" restore "$previous_release_id" "$previous_release" || true
  fi
  exit "$exit_code"
}
trap rollback_on_error ERR

restart_core_services() {
  systemctl restart kcml
  systemctl restart kcml-egress-proxy
  systemctl restart kcml-secret-broker
  systemctl restart kcml-generation-worker
  systemctl restart kcml-browser-automation-worker
  systemctl restart kcml-component-control-worker
  systemctl restart kcml-component-e2e-worker
  systemctl restart kcml-monitor
}

runtime_services=(kcml kcml-egress-proxy kcml-secret-broker kcml-generation-worker kcml-browser-automation-worker kcml-component-control-worker kcml-component-e2e-worker kcml-monitor)
runtime_services_active() {
  local service
  for service in "${runtime_services[@]}"; do systemctl is-active --quiet "$service" || return 1; done
  test -S "${EGRESS_PROXY_SOCKET_PATH:-/var/lib/kcml/egress/proxy.sock}"
  test -S "${SECRET_BROKER_SOCKET_PATH:-/var/lib/kcml/secret-broker/proxy.sock}"
}
wait_for_runtime_start() {
  local admin_host="$1"
  for _attempt in $(seq 1 30); do
    for service in "${runtime_services[@]}"; do
      if systemctl is-failed --quiet "$service"; then
        echo "release-health:terminal-systemd-failure=$service" >&2
        return 1
      fi
    done
    if runtime_services_active; then return 0; fi
    sleep 1
  done
  echo "release-health:startup-deadline=30s" >&2
  return 1
}
require_deterministic_runtime_readiness() {
  local admin_host="$1"
  local readiness_required_consecutive=4
  local readiness_max_attempts=8
  local readiness_interval_seconds=2
  local health_status=""
  local expected_build_id="$release_id"
  local expected_commit_sha="${release_id%%-*}"
  local health_json=""
  local version_json=""
  local heartbeat_ok=""
  wait_for_runtime_start "$admin_host"
  local consecutive=0
  # Ordinary deploy has four consecutive confirmations; long stability soaks
  # belong to the separately dispatched acceptance workflow.
  for _attempt in $(seq 1 "$readiness_max_attempts"); do
    health_json="$(curl -fsS -H "Host: $admin_host" "http://127.0.0.1:${PORT:-3010}/health")"
    version_json="$(curl -fsS -H "Host: $admin_host" "http://127.0.0.1:${PORT:-3010}/api/version")"
    heartbeat_ok="$(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --command "select case when (select count(*) from platform_worker_heartbeat where worker_kind in ('GENERATION','BROWSER_AUTOMATION','COMPONENT_CONTROL','COMPONENT_E2E'))=4 and (select count(*) from platform_worker_heartbeat where worker_kind in ('GENERATION','BROWSER_AUTOMATION','COMPONENT_CONTROL','COMPONENT_E2E') and build_id='${release_id}' and last_error is null and last_heartbeat_at > now()-interval '2 minutes')=4 and exists (select 1 from monitoring_scheduler_heartbeat where singleton=true and last_error is null and last_completed_at > now()-interval '3 minutes') then 'true' else 'false' end")"
    if printf '%s' "$health_json" | jq -e '.status == "ok"' >/dev/null \
      && printf '%s' "$version_json" | jq -e --arg build "$expected_build_id" --arg commit "$expected_commit_sha" '.buildId == $build and .commitSha == $commit' >/dev/null \
      && runtime_services_active \
      && [ "$heartbeat_ok" = "true" ]; then
      consecutive=$((consecutive + 1))
      echo "release-readiness:buildId=$expected_build_id:commitSha=$expected_commit_sha:workers=current:heartbeat=current:sample=$_attempt:consecutive=$consecutive:result=PASS"
      if [ "$consecutive" -ge "$readiness_required_consecutive" ]; then return 0; fi
    else
      consecutive=0
      echo "release-readiness:sample=$_attempt:consecutive=0:result=FAIL" >&2
    fi
    if [ "$_attempt" -lt "$readiness_max_attempts" ]; then sleep "$readiness_interval_seconds"; fi
  done
  health_status="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: $admin_host" "http://127.0.0.1:${PORT:-3010}/health" 2>/dev/null || echo curl-failed)"
  echo "release-health:http=$health_status" >&2
  for service in "${runtime_services[@]}"; do
    echo "release-health:service=$service:state=$(systemctl is-active "$service" 2>/dev/null || echo unavailable)" >&2
  done
  return 1
}

render_nginx_config "$source_dir/deploy/nginx/kcml.conf" /etc/nginx/sites-available/kcml.conf
ln -sfn /etc/nginx/sites-available/kcml.conf /etc/nginx/sites-enabled/kcml.conf

step split-config-initial
DATABASE_APP_URL="${DATABASE_APP_URL:-$DATABASE_URL}" bash "$source_dir/deploy/scripts/split-service-config.sh" "$release_id"
step backup
bash "$source_dir/deploy/scripts/backup.sh"

step migrate
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/migrate.js"

step openai-secret-preflight
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/openai-secret-preflight.js"

step verify-wedos-runtime
grep -Fq 'kcml${purpose === "ACME" ? "acme" : "wapitest"}' "$source_dir/apps/server/dist/tls/wedos-dns-operation.js"
grep -Fq 'replaceAll("-", "")' "$source_dir/apps/server/dist/tls/wedos-dns-operation.js"

step wedos-wapi-preflight
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
  BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/wedos-wapi.js" preflight

step wedos-wapi-recover-preflight
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
KCML_ACME_ZONE="$PUBLIC_BASE_DOMAIN" \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/wedos-wapi.js" recover-preflight

step wedos-wapi-recover-acme
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
KCML_ACME_ZONE="$PUBLIC_BASE_DOMAIN" \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/wedos-wapi.js" recover-acme

# DNS-01 issuance is an external dependency and can take up to fifteen minutes.
# It runs only after the forward migration and WAPI preflight, while the
# previous systemd topology remains active. No new unit is enabled or restarted
# until TLS, its SAN contract, and its WAPI cleanup path are ready.
step expose-canonical-tls-challenge
nginx -t
systemctl reload nginx
step ensure-canonical-tls
tls_cert_path="${WILDCARD_TLS_CERT_PATH:-/etc/kcml/tls/fullchain.pem}"
tls_key_path="${WILDCARD_TLS_KEY_PATH:-${tls_cert_path%/*}/privkey.pem}"
bash "$source_dir/deploy/scripts/ensure-canonical-tls.sh" \
  "$PUBLIC_BASE_DOMAIN" "$component_hostname_suffix" "$tls_cert_path" "$tls_key_path" "$source_dir"

install -m 0755 "$source_dir/deploy/scripts/kcml-generated-runtime-helper" /usr/local/sbin/kcml-generated-runtime-helper
install -m 0755 "$source_dir/deploy/scripts/run-production-acceptance.sh" /usr/local/sbin/kcml-production-acceptance
install -m 0755 "$source_dir/deploy/scripts/run-wedos-infrastructure-acceptance.sh" /usr/local/sbin/kcml-wedos-infrastructure-acceptance
install -m 0755 "$source_dir/deploy/scripts/run-webhook-infrastructure-acceptance.sh" /usr/local/sbin/kcml-webhook-infrastructure-acceptance
cat >/etc/sudoers.d/kcml-production-workflows <<'EOF'
Defaults:kcml !requiretty
kcml ALL=(root) NOPASSWD: /usr/local/sbin/kcml-production-acceptance *, /usr/local/sbin/kcml-wedos-infrastructure-acceptance *, /usr/local/sbin/kcml-webhook-infrastructure-acceptance *
EOF
chmod 0440 /etc/sudoers.d/kcml-production-workflows
visudo -cf /etc/sudoers.d/kcml-production-workflows
cat >/etc/sudoers.d/kcml-generated-runtime <<'EOF'
Defaults:kcml !requiretty
kcml ALL=(root) NOPASSWD: /usr/local/sbin/kcml-generated-runtime-helper *
EOF
chmod 0440 /etc/sudoers.d/kcml-generated-runtime
visudo -cf /etc/sudoers.d/kcml-generated-runtime
for unit in kcml.service kcml-generation-worker.service kcml-browser-automation-worker.service kcml-generated-component@.service kcml-component-control-worker.service kcml-component-e2e-worker.service kcml-monitor.service kcml-egress-proxy.service kcml-alert-primary.service kcml-alert-backup.service kcml-secret-broker.service kcml-canonical-tls-renew.service kcml-canonical-tls-renew-failure.service kcml-canonical-tls-renew-recovered.service kcml-canonical-tls-renew.timer; do
  install -m 0644 "$source_dir/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
install -d -m 0755 /opt/kcml/alert-sink
install -m 0755 "$source_dir/deploy/alert-sink/receiver.mjs" /opt/kcml/alert-sink/receiver.mjs
install -d -m 0700 -o kcml -g kcml /var/lib/kcml/alert-primary-sink /var/lib/kcml/alert-backup-sink
install -d -m 0750 -o kcml -g kcml /var/lib/kcml/generation /var/lib/kcml/generated-components /var/lib/kcml/secret-broker
if ! id kcml-runtime >/dev/null 2>&1; then useradd --system --gid kcml --home-dir /nonexistent --shell /usr/sbin/nologin kcml-runtime; fi
install -d -m 0770 -o kcml-runtime -g kcml /var/lib/kcml/runtime
kcml_uid="$(id -u kcml)"
install -d -m 0755 /etc/systemd/system/kcml-monitor.service.d
sed "s/@KCML_UID@/${kcml_uid}/g" "$source_dir/deploy/systemd/kcml-monitor-runtime.conf.in" \
  > /etc/systemd/system/kcml-monitor.service.d/runtime-user.conf
chmod 0644 /etc/systemd/system/kcml-monitor.service.d/runtime-user.conf

step install-playwright-browser
export CHROMIUM_BINARY="$(PLAYWRIGHT_BROWSERS_PATH=/opt/kcml/playwright-browsers \
  bash "$source_dir/deploy/scripts/install-playwright-browser.sh" "$source_dir")"
echo "playwright-browser:path-configured=yes"

step preflight
export KCML_COMPONENT_HOST_SUFFIX="$component_hostname_suffix"
GENERATION_WORKER_ENABLED=true KCML_RELEASE_SOURCE="$source_dir" bash "$source_dir/deploy/scripts/preflight.sh"

step configure-db-roles
bash "$source_dir/deploy/scripts/configure-db-roles.sh"
DATABASE_APP_URL="$(cat /etc/kcml/database-app.url)"
export DATABASE_APP_URL
step split-config-final
bash "$source_dir/deploy/scripts/split-service-config.sh" "$release_id"

step import-operational-config
KCML_PROCESS_ROLE=admin-sync \
DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/import-operational-config.js" --refresh-build-id

step migrate-mfa-secrets
KCML_PROCESS_ROLE=admin-sync \
DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/migrate-mfa-secrets.js"

step forensic-admin-credentials
PASS="$PASS" \
KCML_PROCESS_ROLE=migrate \
DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/admin-credential-forensics.js"

step sync-admin-password
admin_sync_result="$(PASS="$PASS" \
KCML_PROCESS_ROLE=admin-sync \
DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/sync-admin-password.js")"
printf '%s\n' "$admin_sync_result"
admin_password_matches_pass="$(jq -er '.passwordMatchesInput | tostring' <<<"$admin_sync_result")"

step ensure-platform-worker-access
KCML_PROCESS_ROLE=admin-sync \
DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
NODE_ENV=production \
BUILD_ID="$release_id" \
  node "$source_dir/apps/server/dist/cli/ensure-platform-worker-access.js"

mv "$source_dir" "$release_dir"
chown -R root:kcml "$release_dir"
chmod -R g=rX,o= "$release_dir"
ln -sfn "$release_dir" /opt/kcml/current
switched=true

step activate-services
systemctl daemon-reload
systemctl enable --now kcml-canonical-tls-renew.timer
systemctl enable kcml kcml-generation-worker kcml-browser-automation-worker kcml-component-control-worker kcml-component-e2e-worker kcml-monitor kcml-egress-proxy kcml-secret-broker kcml-alert-primary kcml-alert-backup
systemctl restart kcml-alert-primary
systemctl restart kcml-alert-backup
nginx -t
systemctl reload nginx

restart_core_services

admin_host="${ADMIN_HOST:?ADMIN_HOST is required}"
app_database_url="$(cat /etc/kcml/database-app.url)"
step verify-runtime-readiness
require_deterministic_runtime_readiness "$admin_host"

if [ -n "${KCML_FACTORY_RESET_CONFIRM:-}" ]; then
  step factory-reset
  PASS="$PASS" \
  KCML_PROCESS_ROLE=migrate \
  DATABASE_URL_FILE=/etc/kcml/credentials/migrator/database_url \
  CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
  NODE_ENV=production \
  BUILD_ID="$release_id" \
  KCML_FACTORY_RESET_CONFIRM="${KCML_FACTORY_RESET_CONFIRM}" \
    node "$release_dir/apps/server/dist/cli/factory-reset.js"

  step ensure-platform-worker-access-post-reset
  KCML_PROCESS_ROLE=admin-sync \
  DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
  CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
  NODE_ENV=production \
  BUILD_ID="$release_id" \
    node "$release_dir/apps/server/dist/cli/ensure-platform-worker-access.js"

  step restart-services-post-reset
  restart_core_services

  step verify-runtime-readiness-post-reset
  require_deterministic_runtime_readiness "$admin_host"
fi

admin_username="$(effective_admin_username)"
export ADMIN_BOOTSTRAP_USERNAME="$admin_username"
step verify-core-hosts
release_check() {
  local label="$1"
  shift
  if "$@"; then
    echo "release-check:${label}=PASS"
    return 0
  fi
  echo "release-check-failed:${label}" >&2
  return 1
}
check_admin_login_internal() {
  PASS="$PASS" \
  KCML_PROCESS_ROLE=admin-sync \
  DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
  CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
  NODE_ENV=production \
  BUILD_ID="$release_id" \
  KCML_LOGIN_SMOKE_BASE_URL="http://127.0.0.1:${PORT:-3010}" \
  KCML_LOGIN_SMOKE_HOST="$admin_host" \
    node "$release_dir/apps/server/dist/cli/admin-login-smoke.js" | jq -e '.ok == true' >/dev/null
}
check_admin_login_public() {
  PASS="$PASS" \
  KCML_PROCESS_ROLE=admin-sync \
  DATABASE_URL_FILE=/etc/kcml/credentials/admin-sync/database_url \
  CONFIG_VAULT_MASTER_KEY_BASE64_FILE=/etc/kcml/credentials/config_vault_master_key \
  NODE_ENV=production \
  BUILD_ID="$release_id" \
  KCML_LOGIN_SMOKE_BASE_URL="https://${admin_host}" \
  KCML_LOGIN_SMOKE_HOST="$admin_host" \
    node "$release_dir/apps/server/dist/cli/admin-login-smoke.js" | jq -e '.ok == true' >/dev/null
}
check_auth_discovery() {
  curl -fsS -H "Host: ${AUTH_HOST:?AUTH_HOST is required}" \
    "http://127.0.0.1:${PORT:-3010}/.well-known/oauth-authorization-server" \
    | jq -e --arg issuer "https://${AUTH_HOST}" '.issuer == $issuer' >/dev/null
}
check_secret_discovery_internal() {
  curl -fsS -H "Host: secrets.${PUBLIC_BASE_DOMAIN:?PUBLIC_BASE_DOMAIN is required}" \
    "http://127.0.0.1:${PORT:-3010}/.well-known/kcml-secret-api" \
    | jq -e --arg issuer "https://secrets.${PUBLIC_BASE_DOMAIN}" \
        --arg resolve "https://secrets.${PUBLIC_BASE_DOMAIN}/v1/secrets/resolve" \
        '.issuer == $issuer and .resolveEndpoint == $resolve and (.auth | sort) == ["access_token_bearer"]' >/dev/null
}
check_secret_discovery_public() {
  curl -fsS "https://secrets.${PUBLIC_BASE_DOMAIN}/.well-known/kcml-secret-api" \
    | jq -e --arg issuer "https://secrets.${PUBLIC_BASE_DOMAIN}" \
        --arg resolve "https://secrets.${PUBLIC_BASE_DOMAIN}/v1/secrets/resolve" \
        '.issuer == $issuer and .resolveEndpoint == $resolve and (.auth | sort) == ["access_token_bearer"]' >/dev/null
}
check_secret_health_public() {
  curl -fsS "https://secrets.${PUBLIC_BASE_DOMAIN}/health" \
    | jq -e '.status == "ok"' >/dev/null
}
check_unknown_host() {
  test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: unknown.invalid' \
    "http://127.0.0.1:${PORT:-3010}/health")" = "404"
}
if [ "$admin_password_matches_pass" = "true" ]; then
  release_check admin-login-internal check_admin_login_internal
  release_check admin-login-public check_admin_login_public
else
  echo "release-check:admin-login-internal=SKIPPED"
  echo "release-check:admin-login-public=SKIPPED"
  echo "admin-login-smoke:SKIPPED preserved_owner_credential_diverges_from_pass"
fi
release_check auth-discovery check_auth_discovery
release_check secret-discovery-internal check_secret_discovery_internal
release_check secret-discovery-public check_secret_discovery_public
release_check secret-health-public check_secret_health_public
release_check unknown-host-guard check_unknown_host
step smoke-reference-external-api
if [ "$admin_password_matches_pass" = "true" ]; then
  bash "$release_dir/deploy/scripts/smoke-reference-external-api.sh" "$release_dir"
else
  echo "reference-smoke:SKIPPED preserved_owner_credential_diverges_from_pass"
fi

step verify-final-invariants
wait_for_sql_equals "audit_chain" "t" "select valid from verify_audit_chain()"
wait_for_sql_equals "canonical_component_identity" "0" "select count(*) from component where deregistered_at is null and (code <> ('KCML' || lpad(kcml_number::text,4,'0')) or hostname <> (lower(code) || '.${component_hostname_suffix}'))" 1 1
wait_for_sql_equals "canonical_managed_service_identity" "0" "select count(*) from managed_service service join component on component.id=service.component_id where service.public_hostname is distinct from component.hostname or service.resource_uri is distinct from case when service.service_kind='MCP' then 'https://' || component.hostname || '/mcp' else 'https://' || component.hostname end" 1 1
wait_for_sql_equals "retired_component_credentials" "0" "select count(*) from component_credential where status='ACTIVE' and revoked_at is null" 1 1
wait_for_sql_equals "integration_secret_grants" "0" "select count(*) from secret_grant where principal_kind='INTEGRATION_TOKEN' and revoked_at is null" 1 1
wait_for_sql_equals "legacy_integration_tokens_revoked" "0" "select count(*) from integration_token where revoked_at is null" 1 1
canonical_component_hostname="$(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --command \
  "select component.hostname from component join component_revision revision on revision.id=component.active_revision_id and revision.component_id=component.id where component.deregistered_at is null order by component.kcml_number limit 1")"
if [ -n "$canonical_component_hostname" ]; then
  curl -fsS -H "Host: $canonical_component_hostname" \
    "http://127.0.0.1:${PORT:-3010}/.well-known/oauth-protected-resource/mcp" \
    | jq -e --arg resource "https://${canonical_component_hostname}/mcp" '.resource == $resource' >/dev/null
  curl -fsS "https://${canonical_component_hostname}/.well-known/oauth-protected-resource/mcp" \
    | jq -e --arg resource "https://${canonical_component_hostname}/mcp" '.resource == $resource' >/dev/null
  echo "release-check:canonical_component_metadata=PASS"
else
  echo "release-check:canonical_component_metadata=SKIPPED clean_start_no_registered_component"
fi
wait_for_sql_equals "baseline_migration_row" "1" "select count(*) from schema_migration where version='001_pre_production_baseline.sql'"
wait_for_sql_equals "secret_broker_process_role_migration_row" "1" "select count(*) from schema_migration where version='002_secret_broker_process_role.sql'"
wait_for_sql_equals "component_onboarding_v1_1_migration_row" "1" "select count(*) from schema_migration where version='003_component_onboarding_v1_1.sql'"
wait_for_sql_equals "dashboard_topology_migration_row" "1" "select count(*) from schema_migration where version='004_dashboard_topology.sql'"
wait_for_sql_equals "dashboard_identity_delete_guards_migration_row" "1" "select count(*) from schema_migration where version='005_dashboard_identity_delete_guards.sql'"
wait_for_sql_equals "component_control_queue_state_migration_row" "1" "select count(*) from schema_migration where version='006_component_control_queue_state.sql'"
wait_for_sql_equals "watchdog_health_transition_policy_epoch_migration_row" "1" "select count(*) from schema_migration where version='007_watchdog_health_transition_policy_epoch.sql'"
wait_for_sql_equals "immutable_e2e_evidence_migration_row" "1" "select count(*) from schema_migration where version='008_retain_immutable_component_e2e_evidence.sql'"
wait_for_sql_equals "internal_generation_migration_row" "1" "select count(*) from schema_migration where version='009_internal_generation.sql'"
wait_for_sql_equals "generation_repair_webhook_migration_row" "1" "select count(*) from schema_migration where version='010_generation_repair_webhooks.sql'"
wait_for_sql_equals "generation_integration_egress_secrets_migration_row" "1" "select count(*) from schema_migration where version='011_generation_integration_egress_secrets.sql'"
wait_for_sql_equals "generation_follow_up_runs_migration_row" "1" "select count(*) from schema_migration where version='013_generation_follow_up_runs.sql'"
wait_for_sql_equals "generation_discussion_migration_row" "1" "select count(*) from schema_migration where version='014_generation_discussion.sql'"
wait_for_sql_equals "browser_automation_runtime_migration_row" "1" "select count(*) from schema_migration where version='015_browser_automation_runtime.sql'"
wait_for_sql_equals "generation_discussion_browser_runtime_completion_migration_row" "1" "select count(*) from schema_migration where version='016_generation_discussion_browser_runtime_completion.sql'"
wait_for_sql_equals "discussion_turn_exclusivity_and_cancellation_migration_row" "1" "select count(*) from schema_migration where version='017_discussion_turn_exclusivity_and_cancellation.sql'"
wait_for_sql_equals "wedos_dns_operation_migration_row" "1" "select count(*) from schema_migration where version='018_wedos_dns_operation.sql'"
wait_for_sql_equals "wedos_dns_author_comment_compatibility_migration_row" "1" "select count(*) from schema_migration where version='019_wedos_dns_author_comment_compatibility.sql'"
wait_for_sql_equals "wedos_dns_ascii_author_comment_migration_row" "1" "select count(*) from schema_migration where version='020_wedos_dns_ascii_author_comment.sql'"
wait_for_sql_equals "retire_legacy_generation_states_migration_row" "1" "select count(*) from schema_migration where version='021_retire_legacy_generation_states.sql'"
wait_for_sql_equals "generation_execution_authority_migration_row" "1" "select count(*) from schema_migration where version='022_generation_execution_authority.sql'"
wait_for_sql_equals "readiness_gate_evidence_idempotency_migration_row" "1" "select count(*) from schema_migration where version='012_readiness_gate_evidence_idempotency.sql'"
wait_for_sql_equals "browser_automation_execution_runtime_migration_row" "1" "select count(*) from schema_migration where version='023_browser_automation_execution_runtime.sql'"
wait_for_sql_equals "browser_automation_worker_heartbeat_migration_row" "1" "select count(*) from schema_migration where version='024_browser_automation_worker_heartbeat.sql'"
wait_for_sql_equals "single_owner_human_role_migration_row" "1" "select count(*) from schema_migration where version='025_single_owner_human_role.sql'"
wait_for_sql_equals "generation_browser_session_contract_migration_row" "1" "select count(*) from schema_migration where version='026_generation_browser_session_contract.sql'"
wait_for_sql_equals "single_owner_role_violations" "0" "select count(*) from admin_account where role <> 'OWNER'"
wait_for_sql_equals "single_owner_role_constraint" "1" "select count(*) from pg_constraint where conname='admin_account_role_check' and pg_get_constraintdef(oid) like '%role = ''OWNER''%'"
wait_for_sql_equals "schema_migration_count" "26" "select count(*) from schema_migration"

step verify-runtime-readiness
require_deterministic_runtime_readiness "$admin_host"

trap - ERR
finish_step
echo "release-timing:top10-slowest-steps"
sort -nr -k1,1 "$step_timing_file" | head -10 | while IFS=$'\t' read -r elapsed name result; do
  echo "release-timing:step=$name:elapsedMs=$elapsed:result=$result"
done
echo "release-installed:$release_id"
