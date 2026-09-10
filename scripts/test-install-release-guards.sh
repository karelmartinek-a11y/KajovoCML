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
acceptance_script="deploy/scripts/run-production-acceptance.sh"
infrastructure_acceptance_script="deploy/scripts/run-wedos-infrastructure-acceptance.sh"
webhook_acceptance_script="deploy/scripts/run-webhook-infrastructure-acceptance.sh"
production_runtime_test="scripts/test-production-shaped-generated-runtime.sh"
production_runtime_container_test="scripts/test-production-shaped-generated-runtime-container.sh"
readiness_policy_test="scripts/test-release-readiness-policy.sh"
release_pin_test="scripts/test-release-pin-policy.mjs"

for file in "$install_script" "$preflight_script" "$web_unit" "$generation_unit" "$component_unit" "$helper" "$tls_script" "$acme_auth_hook" "$acme_cleanup_hook" "$acme_deploy_hook" "$renewal_script" "$renewal_service" "$renewal_failure_service" "$renewal_recovered_service" "$renewal_timer" "$lineage_helper" "$playwright_installer"; do
  test -f "$file"
done
for executable in "$helper" "$acceptance_script" "$infrastructure_acceptance_script" "$webhook_acceptance_script" "$production_runtime_test" "$production_runtime_container_test"; do
  test "$(git ls-files -s -- "$executable" | awk '{print $1}')" = 100755
done
test -x "$acceptance_script"
test -x "$infrastructure_acceptance_script"
test -x "$webhook_acceptance_script"
test -x "$helper"
test -x "$production_runtime_test"
test -x "$production_runtime_container_test"
grep -Fq 'docker run --detach --privileged' "$production_runtime_container_test"
grep -Fq 'ubuntu@sha256:' "$production_runtime_container_test"
grep -Fq 'ubuntu_image_digest_part_a=' "$production_runtime_container_test"
grep -Fq 'ubuntu_image_digest_part_b=' "$production_runtime_container_test"
grep -Fq 'GITHUB_SHA' "$production_runtime_container_test"
grep -Fq 'git rev-parse HEAD' "$production_runtime_container_test"
grep -Fq 'KCML_TEST_NODE_BIN' "$production_runtime_container_test"
if grep -E -n 'kcml-deploy|production secrets|/etc/kcml/credentials' "$production_runtime_container_test" >/dev/null; then
  echo "systemd harness must not use the production runner or production credentials" >&2
  exit 1
fi
grep -Fq 'systemctl start "$unit"' "$production_runtime_test"
grep -Fq 'systemctl restart "$unit"' "$production_runtime_test"
grep -Fq 'systemd-run' "$production_runtime_test"
grep -Fq 'LoadCredentialEncrypted' "$production_runtime_test"
grep -Fq 'kcml-runtime' "$production_runtime_test"
grep -Fq 'trap cleanup EXIT' "$production_runtime_test"
test -x "$readiness_policy_test"
test -f "$release_pin_test"
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
grep -Fq 'step verify-runtime-readiness' "$install_script"
grep -Fq 'api/version' "$install_script"
grep -Fq 'run-production-acceptance.sh' "$install_script"
grep -Fq 'run-wedos-infrastructure-acceptance.sh' "$install_script"
grep -Fq 'run-webhook-infrastructure-acceptance.sh' "$install_script"
grep -Fq 'kcml-production-workflows' "$install_script"
grep -Fq 'visudo -cf /etc/sudoers.d/kcml-production-workflows' "$install_script"
if grep -Fq 'wapi-test-roundtrip' "$install_script"; then
  echo "mutating WEDOS roundtrip must not be part of ordinary deploy" >&2
  exit 1
fi
if grep -E -n 'wait-alert-webhooks|finalize-webhook-smoke|queue-webhook-smoke|seq 1 75|seq 1 45' "$install_script" >/dev/null; then
  echo "ordinary deploy retains a long webhook/readiness soak" >&2
  exit 1
fi
grep -Fq 'consecutive=0' "$install_script"
grep -Fq 'platform_worker_heartbeat' "$install_script"
grep -Fq 'readiness_max_attempts=8' "$install_script"
grep -Fq 'readiness_required_consecutive=4' "$install_script"
grep -Fq 'monitoring_scheduler_heartbeat' "$install_script"
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
if grep -Fq 'KCML_RUN_FULL_SSOT_ACCEPTANCE' "$install_script"; then
  echo "full acceptance must not be part of ordinary deploy" >&2
  exit 1
fi
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
test -n "$tls_line"
test -n "$unit_line"
test -n "$split_config_line"
test -n "$migrate_line"
test -n "$openai_line"
test -n "$wapi_line"
test -n "$recover_line"
test -n "$recover_acme_line"
if [ "$split_config_line" -ge "$migrate_line" ] || [ "$migrate_line" -ge "$openai_line" ] || [ "$openai_line" -ge "$wapi_line" ] || [ "$wapi_line" -ge "$recover_line" ] || [ "$recover_line" -ge "$recover_acme_line" ] || [ "$recover_acme_line" -ge "$tls_line" ] || [ "$tls_line" -ge "$unit_line" ]; then
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
for directive in 'User=kcml-runtime' 'Group=kcml' 'LoadCredentialEncrypted=runtime_token:' 'PrivateTmp=true' 'ProtectSystem=strict' 'ProtectHome=true' 'PrivateDevices=true' 'ProtectKernelTunables=true' 'ProtectKernelModules=true' 'ProtectControlGroups=true' 'ProtectHostname=true' 'LockPersonality=true' 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'; do
  grep -Fq "$directive" "$component_unit"
done
if grep -E -n -- '--privileged|CAP_SYS_ADMIN|AppArmor|seccomp|KCML_SYSTEMD_HARNESS_IMAGE' "$component_unit" deploy/scripts/preflight.sh apps/server/src/generation/handler-sandbox.mjs deploy/scripts/kcml-generated-runtime-helper >/dev/null; then
  echo "container-only harness privileges must not enter the production runtime boundary" >&2
  exit 1
fi
grep -Fq 'GENERATION_WORKER_INTERVAL_MS' deploy/scripts/split-service-config.sh
grep -Fq 'COMPONENT_WORKER_INTERVAL_MS' deploy/scripts/split-service-config.sh
grep -Fq 'LoadCredentialEncrypted=runtime_token:' "$component_unit"
grep -Fq 'ReadWritePaths=/var/lib/kcml/runtime /var/lib/kcml/generated-components/%i/data' "$component_unit"
grep -Fq 'credential-stdin)' "$helper"
grep -Fq 'SubState' "$helper"
grep -Fq 'journalctl -u "$unit"' "$helper"
grep -Fq "grep -E 'Error:|error|EACCES|ENOENT|permission|generated_runtime|runtime_token'" "$helper"
grep -Fq 'test -x /usr/bin/unshare' "$preflight_script"
grep -Fq 'systemd-creds setup >/dev/null' "$preflight_script"
grep -Fq 'test -x /usr/bin/mount' "$preflight_script"
grep -Fq 'test -x /usr/sbin/chroot' "$preflight_script"
grep -Fq 'test -x /usr/bin/env' "$preflight_script"
grep -Fq 'runuser -u kcml-runtime -- /usr/bin/setpriv --no-new-privs /usr/bin/unshare --user --map-root-user --mount --net --ipc --uts --pid --fork --kill-child=SIGKILL /bin/true' "$preflight_script"
grep -Fq 'GENERATION_WORKER_ENABLED=true KCML_RELEASE_SOURCE="$source_dir" bash "$source_dir/deploy/scripts/preflight.sh"' "$install_script"
if grep -E -n 'acceptance-owner-password|KCML_ACCEPTANCE_RECONCILE_OWNER_PASSWORD|KCML_ADMIN_PASSWORD_ROTATION_CONFIRM|ROTATE_KCML_OWNER_PASSWORD' "$install_script" >/dev/null; then
  echo "OWNER password reconciliation is not an ordinary deploy operation" >&2
  exit 1
fi
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
