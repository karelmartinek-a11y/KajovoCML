#!/usr/bin/env bash
set -euo pipefail

test -n "${KCML_UPGRADE_DATABASE_URL:-}"
test -n "${DATABASE_URL:-}"

upgrade_database_name="${KCML_UPGRADE_DATABASE_NAME:-kcml_upgrade_test}"
case "$upgrade_database_name" in
  *[!a-zA-Z0-9_]*) echo "invalid upgrade database name" >&2; exit 1 ;;
esac

release_version="$(node --input-type=module -e "import('./apps/server/src/domain/release.ts').then(({KCML_RELEASE}) => process.stdout.write(KCML_RELEASE.catalogVersion))")"

run_migrations() {
  if [[ -x apps/server/node_modules/.bin/tsx ]]; then
    KCML_PROCESS_ROLE=migrate DATABASE_URL="$KCML_UPGRADE_DATABASE_URL" \
      apps/server/node_modules/.bin/tsx apps/server/src/cli/migrate.ts
  else
    KCML_PROCESS_ROLE=migrate DATABASE_URL="$KCML_UPGRADE_DATABASE_URL" pnpm db:migrate
  fi
}

reset_database() {
  psql "$DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --command "drop database if exists \"$upgrade_database_name\" with (force)" >/dev/null
  psql "$DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --command "create database \"$upgrade_database_name\"" >/dev/null
}

reset_database
run_migrations
run_migrations

psql "$KCML_UPGRADE_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | grep -Fx 'baseline-clean-install-ok'
select case when
  (select count(*) from schema_migration) = 21
  and exists (
    select 1
      from schema_migration
     where version='001_pre_production_baseline.sql'
       and sequence_number=1
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='002_secret_broker_process_role.sql'
       and sequence_number=2
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='003_component_onboarding_v1_1.sql'
       and sequence_number=3
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='004_dashboard_topology.sql'
       and sequence_number=4
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='005_dashboard_identity_delete_guards.sql'
       and sequence_number=5
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='006_component_control_queue_state.sql'
       and sequence_number=6
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
      select 1
      from schema_migration
     where version='007_watchdog_health_transition_policy_epoch.sql'
       and sequence_number=7
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (select 1 from schema_migration where version='008_retain_immutable_component_e2e_evidence.sql' and sequence_number=8 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='009_internal_generation.sql' and sequence_number=9 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='010_generation_repair_webhooks.sql' and sequence_number=10 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='011_generation_integration_egress_secrets.sql' and sequence_number=11 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='012_readiness_gate_evidence_idempotency.sql' and sequence_number=12 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='013_generation_follow_up_runs.sql' and sequence_number=13 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='014_generation_discussion.sql' and sequence_number=14 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='015_browser_automation_runtime.sql' and sequence_number=15 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='016_generation_discussion_browser_runtime_completion.sql' and sequence_number=16 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='017_discussion_turn_exclusivity_and_cancellation.sql' and sequence_number=17 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='018_wedos_dns_operation.sql' and sequence_number=18 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='019_wedos_dns_author_comment_compatibility.sql' and sequence_number=19 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='020_wedos_dns_ascii_author_comment.sql' and sequence_number=20 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='021_retire_legacy_generation_states.sql' and sequence_number=21 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and (select count(*) from release_epoch) = 1
  and exists (
    select 1
      from release_epoch
     where release_version='${release_version}'
       and blueprint_version='${release_version}'
       and catalog_version='${release_version}'
       and manifest_schema_version='${release_version}'
       and pulse_envelope_version='${release_version}'
  )
  and not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and column_name='release_version'
       and column_default is not null
       and column_default <> quote_literal('${release_version}') || '::text'
  )
  and (select count(*) from release_wave) = 0
  and (select count(*) from release_wave_component) = 0
  and exists (
    select 1
      from admin_account
     where username='karmar78'
       and role='ADMIN'
       and active=false
       and password_hash is null
  )
  and exists (
    select 1
      from admin_bootstrap_state
     where singleton is true
       and completed is false
  )
  and exists (
    select 1
      from principal
     where public_id='KCML-PLATFORM-WORKER'
       and kind='PLATFORM'
       and status='ACTIVE'
  )
  and exists (
    select 1
      from platform_worker_access_identity identity
      join principal on principal.id=identity.principal_id
     where identity.singleton is true
       and principal.public_id='KCML-PLATFORM-WORKER'
       and identity.access_token_id is null
  )
  and (select count(*) from audit_head where singleton is true and last_sequence=0 and event_hash is null) = 1
then 'baseline-clean-install-ok' else 'baseline-clean-install-failed' end;
SQL

psql "$KCML_UPGRADE_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
delete from schema_migration;
insert into schema_migration(version, applied_at, sequence_number, checksum_sha256) values
  ('001_initial.sql', now(), null, null),
  ('055_release_epoch_20260724.sql', now(), null, null),
  ('088_canonical_managed_service_identity.sql', now(), null, null);
SQL

run_migrations
run_migrations

psql "$KCML_UPGRADE_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | grep -Fx 'baseline-compaction-ok'
select case when
  (select count(*) from schema_migration) = 21
  and exists (
    select 1
      from schema_migration
     where version='001_pre_production_baseline.sql'
       and sequence_number=1
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='002_secret_broker_process_role.sql'
       and sequence_number=2
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='003_component_onboarding_v1_1.sql'
       and sequence_number=3
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='004_dashboard_topology.sql'
       and sequence_number=4
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='005_dashboard_identity_delete_guards.sql'
       and sequence_number=5
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='006_component_control_queue_state.sql'
       and sequence_number=6
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
      select 1
      from schema_migration
     where version='007_watchdog_health_transition_policy_epoch.sql'
       and sequence_number=7
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (select 1 from schema_migration where version='008_retain_immutable_component_e2e_evidence.sql' and sequence_number=8 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='009_internal_generation.sql' and sequence_number=9 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='010_generation_repair_webhooks.sql' and sequence_number=10 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='011_generation_integration_egress_secrets.sql' and sequence_number=11 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='012_readiness_gate_evidence_idempotency.sql' and sequence_number=12 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='013_generation_follow_up_runs.sql' and sequence_number=13 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='014_generation_discussion.sql' and sequence_number=14 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='015_browser_automation_runtime.sql' and sequence_number=15 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='016_generation_discussion_browser_runtime_completion.sql' and sequence_number=16 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='017_discussion_turn_exclusivity_and_cancellation.sql' and sequence_number=17 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='018_wedos_dns_operation.sql' and sequence_number=18 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='019_wedos_dns_author_comment_compatibility.sql' and sequence_number=19 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='020_wedos_dns_ascii_author_comment.sql' and sequence_number=20 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='021_retire_legacy_generation_states.sql' and sequence_number=21 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and (select count(*) from release_epoch) = 1
  and not exists (
    select 1
      from information_schema.columns
     where table_schema='public'
       and column_name='release_version'
       and column_default is not null
       and column_default <> quote_literal('${release_version}') || '::text'
  )
  and exists (select 1 from principal where public_id='KCML-PLATFORM-WORKER' and kind='PLATFORM')
  and exists (select 1 from admin_account where username='karmar78')
  and (select valid from verify_audit_chain()) is true
then 'baseline-compaction-ok' else 'baseline-compaction-failed' end;
SQL

psql "$KCML_UPGRADE_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
delete from schema_migration where version='005_dashboard_identity_delete_guards.sql';
insert into schema_migration(version, applied_at, sequence_number, checksum_sha256)
values ('005_dashboard_operational_views.sql', now(), 5, repeat('0', 64));
SQL

run_migrations
run_migrations

psql "$KCML_UPGRADE_DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | grep -Fx 'baseline-retired-dashboard-ledger-ok'
select case when
  (select count(*) from schema_migration) = 21
  and exists (
    select 1
      from schema_migration
     where version='005_dashboard_identity_delete_guards.sql'
       and sequence_number=5
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
    select 1
      from schema_migration
     where version='006_component_control_queue_state.sql'
       and sequence_number=6
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (
      select 1
      from schema_migration
     where version='007_watchdog_health_transition_policy_epoch.sql'
       and sequence_number=7
       and checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
  and exists (select 1 from schema_migration where version='008_retain_immutable_component_e2e_evidence.sql' and sequence_number=8 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='009_internal_generation.sql' and sequence_number=9 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='010_generation_repair_webhooks.sql' and sequence_number=10 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='011_generation_integration_egress_secrets.sql' and sequence_number=11 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='012_readiness_gate_evidence_idempotency.sql' and sequence_number=12 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='013_generation_follow_up_runs.sql' and sequence_number=13 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='014_generation_discussion.sql' and sequence_number=14 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='015_browser_automation_runtime.sql' and sequence_number=15 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='016_generation_discussion_browser_runtime_completion.sql' and sequence_number=16 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='017_discussion_turn_exclusivity_and_cancellation.sql' and sequence_number=17 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='018_wedos_dns_operation.sql' and sequence_number=18 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='019_wedos_dns_author_comment_compatibility.sql' and sequence_number=19 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='020_wedos_dns_ascii_author_comment.sql' and sequence_number=20 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and exists (select 1 from schema_migration where version='021_retire_legacy_generation_states.sql' and sequence_number=21 and checksum_sha256 ~ '^[0-9a-f]{64}$')
  and not exists (
    select 1
      from schema_migration
     where version='005_dashboard_operational_views.sql'
  )
then 'baseline-retired-dashboard-ledger-ok' else 'baseline-retired-dashboard-ledger-failed' end;
SQL
