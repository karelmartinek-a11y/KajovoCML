#!/usr/bin/env bash
set -euo pipefail

install_script="deploy/scripts/install-release.sh"
preflight_script="deploy/scripts/preflight.sh"
generation_unit="deploy/systemd/kcml-generation-worker.service"
component_unit="deploy/systemd/kcml-generated-component@.service"
helper="deploy/scripts/kcml-generated-runtime-helper"
tls_script="deploy/scripts/ensure-canonical-tls.sh"
acme_auth_hook="deploy/scripts/acme-auth-hook.sh"
acme_cleanup_hook="deploy/scripts/acme-cleanup-hook.sh"
acme_deploy_hook="deploy/scripts/acme-deploy-hook.sh"

for file in "$install_script" "$preflight_script" "$generation_unit" "$component_unit" "$helper" "$tls_script" "$acme_auth_hook" "$acme_cleanup_hook" "$acme_deploy_hook"; do
  test -f "$file"
done

grep -Fq 'kcml-generation-worker.service' "$install_script"
grep -Fq 'kcml-generated-component@.service' "$install_script"
grep -Fq 'kcml-generated-runtime-helper' "$install_script"
grep -Fq 'dist/cli/ensure-platform-worker-access.js' "$install_script"
grep -Fq 'dist/cli/factory-reset.js' "$install_script"
grep -Fq '(.auth | sort) == ["access_token_bearer"]' "$install_script"
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
grep -Fq 'step verify-wedos-runtime' "$install_script"
grep -Fq 'replaceAll("-", "")' "$install_script"
grep -Fq 'wait_for_sql_equals "schema_migration_count" "20" "select count(*) from schema_migration"' "$install_script"
grep -Fq 'curl -fsS "https://${canonical_component_hostname}/.well-known/oauth-protected-resource/mcp"' "$install_script"
grep -Fq 'deploy/scripts/ensure-canonical-tls.sh' "$install_script"
grep -Fq 'step wedos-wapi-preflight' "$install_script"
grep -Fq 'dist/cli/wedos-wapi.js" preflight' "$install_script"
grep -Fq '"$PUBLIC_BASE_DOMAIN" "$component_hostname_suffix" "$tls_cert_path" "$tls_key_path" "$source_dir"' "$install_script"
grep -Fq 'source_dir="${5:?verified release source required}"' "$tls_script"
grep -Fq 'CONFIG_VAULT_MASTER_KEY_BASE64_FILE="$config_vault_master_key_file"' "$tls_script"
grep -Fq 'KCML_PROCESS_ROLE=migrate' "$tls_script"
grep -Fq 'acme-auth-hook.sh' "$tls_script"
grep -Fq 'acme-cleanup-hook.sh' "$tls_script"
grep -Fq 'acme-deploy-hook.sh' "$tls_script"
if grep -E -n 'WAITING_DNS|kcml-dns-challenge\.json|manual-cleanup-hook /bin/true|--force-renewal' "$tls_script" "$acme_auth_hook" "$acme_cleanup_hook" "$acme_deploy_hook" >/dev/null; then
  echo "legacy manual DNS challenge flow remains in canonical TLS automation" >&2
  exit 1
fi
tls_line="$(grep -n 'step ensure-canonical-tls' "$install_script" | head -1 | cut -d: -f1)"
unit_line="$(grep -n 'for unit in kcml.service' "$install_script" | head -1 | cut -d: -f1)"
split_config_line="$(grep -n 'step split-config-initial' "$install_script" | head -1 | cut -d: -f1)"
migrate_line="$(grep -n 'step migrate' "$install_script" | head -1 | cut -d: -f1)"
wapi_line="$(grep -n 'step wedos-wapi-preflight' "$install_script" | head -1 | cut -d: -f1)"
test -n "$tls_line"
test -n "$unit_line"
test -n "$split_config_line"
test -n "$migrate_line"
test -n "$wapi_line"
if [ "$split_config_line" -ge "$migrate_line" ] || [ "$migrate_line" -ge "$wapi_line" ] || [ "$wapi_line" -ge "$tls_line" ] || [ "$tls_line" -ge "$unit_line" ]; then
  echo "migration and WAPI/TLS must complete before systemd topology activation" >&2
  exit 1
fi
grep -Fq 'GENERATION_WORKER_ENABLED' deploy/scripts/split-service-config.sh
grep -Fq 'GENERATION_WORKER_INTERVAL_MS' deploy/scripts/split-service-config.sh
grep -Fq 'COMPONENT_WORKER_INTERVAL_MS' deploy/scripts/split-service-config.sh
grep -Fq 'LoadCredentialEncrypted=runtime_token:' "$component_unit"
grep -Fq 'ReadWritePaths=/var/lib/kcml/runtime /var/lib/kcml/generated-components/%i/data' "$component_unit"
grep -Fq 'credential-stdin)' "$helper"
grep -Fq 'test -x /usr/bin/unshare' "$preflight_script"
grep -Fq 'test -x /usr/bin/mount' "$preflight_script"
grep -Fq 'test -x /usr/sbin/chroot' "$preflight_script"
grep -Fq 'test -x /usr/bin/env' "$preflight_script"
grep -Fq 'runuser -u kcml-runtime -- /usr/bin/setpriv --no-new-privs /usr/bin/unshare --user --map-root-user --mount --net --ipc --uts --pid --fork --kill-child=SIGKILL /bin/true' "$preflight_script"
grep -Fq 'GENERATION_WORKER_ENABLED=true KCML_RELEASE_SOURCE="$source_dir" bash "$source_dir/deploy/scripts/preflight.sh"' "$install_script"
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

echo "install-release-guards:PASS"
