alter table public.operational_config_applied
  drop constraint if exists operational_config_applied_process_role_check;

alter table public.operational_config_applied
  add constraint operational_config_applied_process_role_check
  check (process_role = any (array['web'::text, 'worker'::text, 'monitor'::text, 'egress'::text, 'secret-broker'::text]));
