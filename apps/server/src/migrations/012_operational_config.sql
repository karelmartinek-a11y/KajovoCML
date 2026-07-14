create table if not exists operational_config_setting (
  key text primary key,
  value_json jsonb,
  value_ciphertext text,
  updated_by uuid references admin_account(id),
  updated_at timestamptz not null default now(),
  check (
    (value_json is not null and value_ciphertext is null)
    or (value_json is null and value_ciphertext is not null)
  )
);
