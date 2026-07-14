alter table integration_token
  add column if not exists descriptor jsonb not null default '{}'::jsonb;

update integration_token
   set descriptor = coalesce(descriptor, '{}'::jsonb)
 where descriptor is null;
