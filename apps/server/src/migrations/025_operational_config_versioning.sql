alter table operational_config_setting
  add column if not exists version integer not null default 0;
