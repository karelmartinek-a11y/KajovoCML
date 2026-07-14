create table if not exists operational_config_setting (
  key text primary key,
  value_json jsonb not null,
  updated_by uuid references admin_account(id),
  updated_at timestamptz not null default now(),
  constraint operational_config_key_check check (
    key in ('onboardingWorkerIntervalMs','monitorIntervalMs','logLevel')
  )
);
