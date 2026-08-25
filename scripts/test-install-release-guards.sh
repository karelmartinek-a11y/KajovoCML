#!/usr/bin/env bash
set -euo pipefail

install_script="deploy/scripts/install-release.sh"
preflight_script="deploy/scripts/preflight.sh"
generation_unit="deploy/systemd/kcml-generation-worker.service"
web_unit="deploy/systemd/kcml.service"
component_unit="deploy/systemd/kcml-generated-component@.service"
helper="deploy/scripts/kcml-generated-runtime-helper"
tls_script="deploy/scripts/ensure-canonical-tls.sh"
acme_auth_hook="deploy/scripts/acme-auth-hook.sh"
acme_cleanup_hook="deploy/scripts/acme-cleanup-hook.sh"
acme_deploy_hook="deploy/scripts/acme-deploy-hook.sh"
renewal_script="deploy/scripts/renew-canonical-tls.sh"
renewal_service="deploy/systemd/kcml-canonical-tls-renew.service"
renewal_failure_service="deploy/systemd/kcml-canonical-tls-renew-failure.service"
renewal_recovered_service="deploy/systemd/kcml-canonical-tls-renew-recovered.service"
renewal_timer="deploy/systemd/kcml-canonical-tls-renew.timer"
lineage_helper="deploy/scripts/certbot-lineage.sh"
playwright_installer="deploy/scripts/install-playwright-browser.sh"
playwright_lock_recovery="deploy/scripts/playwright-lock-recovery.mjs"
playwright_compatibility="deploy/scripts/playwright-browser-compat.mjs"

for file in "$install_script" "$preflight_script" "$web_unit" "$generation_unit" "$component_unit" "$helper" "$tls_script" "$acme_auth_hook" "$acme_cleanup_hook" "$acme_deploy_hook" "$renewal_script" "$renewal_service" "$renewal_failure_service" "$renewal_recovered_service" "$renewal_timer" "$lineage_helper" "$playwright_installer"; do
  test -f "$file"
done
test -f "$playwright_lock_recovery"
test -f "$playwright_compatibility"

grep -Fq 'kcml-generation-worker.service' "$install_script"
grep -Fq 'kcml-browser-automation-worker.service' "$install_script"
test -f deploy/systemd/kcml-browser-automation-worker.service
grep -Fq 'kcml-generated-component@.service' "$install_script"
grep -Fq 'kcml-generated-runtime-helper' "$install_script"
grep -Fq 'dist/cli/ensure-platform-worker-access.js' "$install_script"
grep -Fq 'dist/cli/factory-reset.js' "$install_script"
grep -Fq '(.auth | sort) == ["access_token_bearer"]' "$install_script"
grep -Fq 'release_check admin-login-internal check_admin_login_internal' "$install_script"
grep -Fq 'release_check admin-login-public check_admin_login_public' "$install_script"
grep -Fq 'release_check auth-discovery check_auth_discovery' "$install_script"
grep -Fq 'release_check secret-discovery-internal check_secret_discovery_internal' "$install_script"
grep -Fq 'release_check secret-discovery-public check_secret_discovery_public' "$install_script"
grep -Fq 'release_check secret-health-public check_secret_health_public' "$install_script"
grep -Fq 'release_check unknown-host-guard check_unknown_host' "$install_script"
grep -Fq 'internal_generation_migration_row' "$install_script"
grep -Fq "where version='009_internal_generation.sql'" "$install_script"
grep -Fq 'generation_repair_webhook_migration_row' "$install_script"
grep -Fq "where version='010_generation_repair_webhooks.sql'" "$install_script"
grep -Fq 'generation_integration_egress_secrets_migration_row' "$install_script"
grep -Fq "where version='011_generation_integration_egress_secrets.sql'" "$install_script"
grep -Fq "where version='012_readiness_gate_evidence_idempotency.sql'" "$install_script"
grep -Fq "where version='014_generation_discussion.sql'" "$install_script"
grep -Fq "where version='015_browser_automation_runtime.sql'" "$install_script"
grep -Fq "where version='016_generation_discussion_browser_runtime_completion.sql'" "$install_script"
grep -Fq "where version='017_discussion_turn_exclusivity_and_cancellation.sql'" "$install_script"
grep -Fq "where version='018_wedos_dns_operation.sql'" "$install_script"
grep -Fq "where version='019_wedos_dns_author_comment_compatibility.sql'" "$install_script"
grep -Fq "where version='020_wedos_dns_ascii_author_comment.sql'" "$install_script"
grep -Fq "where version='021_retire_legacy_generation_states.sql'" "$install_script"
grep -Fq "where version='022_generation_execution_authority.sql'" "$install_script"
grep -Fq "where version='023_browser_automation_execution_runtime.sql'" "$install_script"
grep -Fq "where version='024_browser_automation_worker_heartbeat.sql'" "$install_script"
grep -Fq "where version='025_single_owner_human_role.sql'" "$install_script"
grep -Fq "where version='026_generation_browser_session_contract.sql'" "$install_script"
grep -Fq 'single_owner_role_violations' "$install_script"
grep -Fq 'single_owner_role_constraint' "$install_script"
grep -Fq 'step verify-wedos-runtime' "$install_script"
grep -Fq 'step openai-secret-preflight' "$install_script"
grep -Fq 'dist/cli/openai-secret-preflight.js' "$install_script"
grep -Fq 'replaceAll("-", "")' "$install_script"
grep -Fq 'wait_for_sql_equals "schema_migration_count" "26" "select count(*) from schema_migration"' "$install_script"
grep -Fq 'curl -fsS "https://${canonical_component_hostname}/.well-known/oauth-protected-resource/mcp"' "$install_script"
grep -Fq 'deploy/scripts/ensure-canonical-tls.sh' "$install_script"
grep -Fq 'deploy/scripts/renew-canonical-tls.sh' "$renewal_service"
grep -Fq 'systemctl enable --now kcml-canonical-tls-renew.timer' "$install_script"
grep -Fq 'certbot renew' "$renewal_script"
grep -Fq 'restore_previous' "$renewal_script"
grep -Fq 'nginx -t' "$renewal_script"
grep -Fq 'curl --fail' "$renewal_script"
grep -Fq 'OnFailure=kcml-canonical-tls-renew-failure.service' "$renewal_service"
grep -Fq 'kcml-canonical-tls-renew-recovered.service' "$renewal_service"
grep -Fq 'ReadWritePaths=/etc/kcml/tls /run/kcml /var/lib/letsencrypt /etc/letsencrypt /var/log/letsencrypt /var/log/nginx /var/log/dagmar /var/log/hotelapp' "$renewal_service"
grep -Fq 'report-canonical-tls-renewal.js failed' "$renewal_failure_service"
grep -Fq 'report-canonical-tls-renewal.js recovered' "$renewal_recovered_service"
grep -Fq 'kcml-canonical-tls-renew-failure.service' "$install_script"
grep -Fq 'kcml-canonical-tls-renew-recovered.service' "$install_script"
grep -Fq 'step wedos-wapi-preflight' "$install_script"
grep -Fq 'dist/cli/wedos-wapi.js" preflight' "$install_script"
grep -Fq 'step wedos-wapi-recover-preflight' "$install_script"
grep -Fq 'dist/cli/wedos-wapi.js" recover-preflight' "$install_script"
grep -Fq 'step wedos-wapi-recover-acme' "$install_script"
grep -Fq 'dist/cli/wedos-wapi.js" recover-acme' "$install_script"
grep -Fq 'step wedos-wapi-roundtrip' "$install_script"
grep -Fq 'dist/cli/wedos-wapi.js" wapi-test-roundtrip' "$install_script"
grep -Fq 'step install-playwright-browser' "$install_script"
grep -Fq 'install-playwright-browser.sh' "$install_script"
grep -Fq 'PLAYWRIGHT_BROWSERS_PATH=/opt/kcml/playwright-browsers' "$install_script"
grep -Fq 'command -v flock >/dev/null' "$playwright_installer"
grep -Fq 'install --with-deps chromium' "$playwright_installer"
grep -Fq 'playwright_package="$source_dir/apps/server/node_modules/playwright"' "$playwright_installer"
grep -Fq 'playwright_cli="$playwright_package/cli.js"' "$playwright_installer"
grep -Fq 'node "$playwright_cli" install --with-deps chromium' "$playwright_installer"
grep -Fq 'playwright-lock-recovery.mjs' "$playwright_installer"
grep -Fq 'playwright-browser-compat.mjs' "$playwright_installer"
grep -Fq 'needs-system-unzip' "$playwright_installer"
grep -Fq 'install-deps' "$playwright_compatibility"
grep -Fq 'unzip' "$playwright_compatibility"
grep -Fq 'curl' "$playwright_compatibility"
grep -Fq 'flock -n 9' "$playwright_installer"
grep -Fq 'chromium.executablePath()' "$playwright_installer"
grep -Fq 'INSTALLATION_COMPLETE' "$playwright_installer"
grep -Fq 'playwright-browsers' "$playwright_installer"
grep -Fq 'chromium_binary="${CHROMIUM_BINARY:-chromium}"' "$preflight_script"
grep -Fq '"$PUBLIC_BASE_DOMAIN" "$component_hostname_suffix" "$tls_cert_path" "$tls_key_path" "$source_dir"' "$install_script"
grep -Fq 'install -d -m 0700 /etc/kcml/tls' "$install_script"
grep -Fq 'source_dir="${5:?verified release source required}"' "$tls_script"
grep -Fq 'CONFIG_VAULT_MASTER_KEY_BASE64_FILE="$config_vault_master_key_file"' "$tls_script"
grep -Fq 'KCML_PROCESS_ROLE=migrate' "$tls_script"
grep -Fq 'acme-auth-hook.sh' "$tls_script"
grep -Fq 'acme-cleanup-hook.sh' "$tls_script"
grep -Fq 'acme-deploy-hook.sh' "$tls_script"
grep -Fq 'RENEWED_LINEAGE="$certbot_lineage"' "$tls_script"
grep -Fq 'certbot-lineage.sh' "$tls_script"
grep -Fq 'resolve_certbot_lineage_name' "$renewal_script"
if grep -E -n 'WAITING_DNS|kcml-dns-challenge\.json|manual-cleanup-hook /bin/true|--force-renewal' "$tls_script" "$acme_auth_hook" "$acme_cleanup_hook" "$acme_deploy_hook" >/dev/null; then
  echo "legacy manual DNS challenge flow remains in canonical TLS automation" >&2
  exit 1
fi
tls_line="$(grep -n 'step ensure-canonical-tls' "$install_script" | head -1 | cut -d: -f1)"
unit_line="$(grep -n 'for unit in kcml.service' "$install_script" | head -1 | cut -d: -f1)"
split_config_line="$(grep -n 'step split-config-initial' "$install_script" | head -1 | cut -d: -f1)"
migrate_line="$(grep -n 'step migrate' "$install_script" | head -1 | cut -d: -f1)"
openai_line="$(grep -n 'step openai-secret-preflight' "$install_script" | head -1 | cut -d: -f1)"
wapi_line="$(grep -n 'step wedos-wapi-preflight' "$install_script" | head -1 | cut -d: -f1)"
recover_line="$(grep -n 'step wedos-wapi-recover-preflight' "$install_script" | head -1 | cut -d: -f1)"
recover_acme_line="$(grep -n 'step wedos-wapi-recover-acme' "$install_script" | head -1 | cut -d: -f1)"
roundtrip_line="$(grep -n 'step wedos-wapi-roundtrip' "$install_script" | head -1 | cut -d: -f1)"
test -n "$tls_line"
test -n "$unit_line"
test -n "$split_config_line"
test -n "$migrate_line"
test -n "$openai_line"
test -n "$wapi_line"
test -n "$recover_line"
test -n "$recover_acme_line"
test -n "$roundtrip_line"
if [ "$split_config_line" -ge "$migrate_line" ] || [ "$migrate_line" -ge "$openai_line" ] || [ "$openai_line" -ge "$wapi_line" ] || [ "$wapi_line" -ge "$recover_line" ] || [ "$recover_line" -ge "$recover_acme_line" ] || [ "$recover_acme_line" -ge "$roundtrip_line" ] || [ "$roundtrip_line" -ge "$tls_line" ] || [ "$tls_line" -ge "$unit_line" ]; then
  echo "migration and WAPI/TLS must complete before systemd topology activation" >&2
  exit 1
fi
grep -Fq 'GENERATION_WORKER_ENABLED' deploy/scripts/split-service-config.sh
grep -Fq 'ReadWritePaths=/var/lib/kcml/generation /var/lib/kcml/runtime' "$web_unit"
# The only production sudo boundary used by the generation lifecycle helper
# must remain explicit.  Generated component services retain NoNewPrivileges
# and RestrictSUIDSGID; only the two orchestrators may cross this allow-list.
grep -Fq 'NoNewPrivileges=false' "$web_unit"
grep -Fq 'RestrictSUIDSGID=false' "$web_unit"
grep -Fq 'NoNewPrivileges=false' "$generation_unit"
grep -Fq 'RestrictSUIDSGID=false' "$generation_unit"
grep -Fq 'NoNewPrivileges=true' "$component_unit"
grep -Fq 'RestrictSUIDSGID=true' "$component_unit"
grep -Fq 'GENERATION_WORKER_INTERVAL_MS' deploy/scripts/split-service-config.sh
grep -Fq 'COMPONENT_WORKER_INTERVAL_MS' deploy/scripts/split-service-config.sh
grep -Fq 'LoadCredentialEncrypted=runtime_token:' "$component_unit"
grep -Fq 'ReadWritePaths=/var/lib/kcml/runtime /var/lib/kcml/generated-components/%i/data' "$component_unit"
grep -Fq 'credential-stdin)' "$helper"
grep -Fq 'SubState' "$helper"
grep -Fq 'test -x /usr/bin/unshare' "$preflight_script"
grep -Fq 'systemd-creds setup >/dev/null' "$preflight_script"
grep -Fq 'test -x /usr/bin/mount' "$preflight_script"
grep -Fq 'test -x /usr/sbin/chroot' "$preflight_script"
grep -Fq 'test -x /usr/bin/env' "$preflight_script"
grep -Fq 'runuser -u kcml-runtime -- /usr/bin/setpriv --no-new-privs /usr/bin/unshare --user --map-root-user --mount --net --ipc --uts --pid --fork --kill-child=SIGKILL /bin/true' "$preflight_script"
grep -Fq 'GENERATION_WORKER_ENABLED=true KCML_RELEASE_SOURCE="$source_dir" bash "$source_dir/deploy/scripts/preflight.sh"' "$install_script"
grep -Fq 'acceptance-owner-password:reconcile-existing-pass' "$install_script"
grep -Fq 'KCML_ACCEPTANCE_RECONCILE_OWNER_PASSWORD' "$install_script"
grep -Fq "where deregistered_at is null and (code <> ('KCML' || lpad(kcml_number::text,4,'0'))" "$install_script"

if grep -E -n 'kcml-onboarding-worker|GHCR_TOKEN|GITHUB_TOKEN|stage_registry_auth|repository-component-deploy' \
  "$install_script" "$preflight_script" "$generation_unit" "$component_unit" "$helper" deploy/scripts/split-service-config.sh >/dev/null; then
  echo "retired external onboarding dependency remains in production generation deployment" >&2
  exit 1
fi

if grep -E -n 'cleanup_registry_auth' "$install_script" >/dev/null; then
  echo "retired registry-auth cleanup hook remains in the release installer" >&2
  exit 1
fi

if grep -Eq 'client_secret_basic|integration_token_bearer' "$install_script"; then
  echo "secret API deployment checks must be access-token-only" >&2
  exit 1
fi

node scripts/test-ssot-production-acceptance-guard.mjs

echo "install-release-guards:PASS"
