alter table schema_migration
  add column if not exists sequence_number integer,
  add column if not exists checksum_sha256 text;

create table if not exists legacy_schema_migration (
  version text primary key,
  applied_at timestamptz not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  archived_at timestamptz not null default now(),
  archive_reason text not null
);

insert into legacy_schema_migration(version,applied_at,checksum_sha256,archive_reason)
select migration.version,migration.applied_at,known.checksum_sha256,'superseded by canonical forensic hardening sequence 007-016'
  from schema_migration migration
  join (values
    ('007_auth_hardening.sql','a6ad2fb9bac37adfe07b5ca651b82058544528bf7abdb965fb7b68e9a24c2382'),
    ('008_mcp_runtime_policies.sql','ac88afe03864b1d59a4ce5aa16b19e3ec26636a1918c7f0751d6dfcbab8524e6'),
    ('009_permission_and_tool_scope.sql','58f2f3521441628384329f2350191b8f3f4aca50c65a882d6c663eadf4a3166e'),
    ('010_audit_hash_chain.sql','2e6b184fe8d6cdac659df437e30145dd3557bc6eda61d538c90909346f936e8a'),
    ('011_admin_bootstrap_recovery.sql','19b090f20e430a6bd678a359f527c39671c3b92772a2c11be276698595956868'),
    ('011_integration_token_descriptor.sql','10743adb22ba9b5d1660377315872a3b7aa54a8273a0a674ef05247113c3ff74'),
    ('012_operational_config.sql','46ee0d82f5c500d347736568c60bfc90eb5bbf499e21ea709d8280de2c2f9c12'),
    ('013_rate_bucket_per_client.sql','4de287763bd0457fca0eaa1818ddb9847b22d727cbcf40b36c88fa6b3b02ee8f'),
    ('014_mcp_idempotency.sql','5e9faa5244712be200f8aa38750ccadbd8aa91e87897fc1819a0c065f9f147e3')
  ) as known(version,checksum_sha256) on known.version=migration.version
on conflict (version) do nothing;

delete from schema_migration
 where version in (select version from legacy_schema_migration);

update schema_migration
   set sequence_number = substring(version from '^([0-9]{3})_')::integer
 where sequence_number is null
   and version ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$';

alter table schema_migration
  drop constraint if exists schema_migration_version_format_check,
  drop constraint if exists schema_migration_checksum_format_check;

alter table schema_migration
  add constraint schema_migration_version_format_check
    check (version ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$'),
  add constraint schema_migration_checksum_format_check
    check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$');

create index if not exists schema_migration_sequence_idx
  on schema_migration(sequence_number, version);
