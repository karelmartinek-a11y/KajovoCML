alter table operational_config_setting
  alter column value_json drop not null,
  add column if not exists secret_ciphertext text,
  add column if not exists is_secret boolean not null default false;

alter table operational_config_setting
  drop constraint if exists operational_config_key_check,
  drop constraint if exists operational_config_value_shape_check;

alter table operational_config_setting
  add constraint operational_config_value_shape_check check (
    (is_secret and value_json is null and secret_ciphertext is not null and secret_ciphertext like 'vault:v1:%')
    or (not is_secret and value_json is not null and secret_ciphertext is null)
  );

create table if not exists operational_config_applied (
  key text not null references operational_config_setting(key) on delete cascade,
  process_role text not null check (process_role in ('web','worker','monitor','egress')),
  version integer not null check (version >= 0),
  applied_at timestamptz not null default now(),
  primary key (key, process_role)
);

create index if not exists operational_config_applied_pending_idx
  on operational_config_applied(process_role, key, version);
