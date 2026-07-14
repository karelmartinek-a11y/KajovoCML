alter table function_rate_bucket
  add column if not exists credential_id uuid;

update function_rate_bucket
   set credential_id='00000000-0000-0000-0000-000000000000'
 where credential_id is null;

alter table function_rate_bucket
  alter column credential_id set not null;

alter table function_rate_bucket
  drop constraint if exists function_rate_bucket_pkey;

alter table function_rate_bucket
  add primary key (server_id, credential_id);

create index if not exists function_rate_bucket_window_idx
  on function_rate_bucket(window_started_at);
