alter table mcp_server
  add column if not exists read_only_hint boolean,
  add column if not exists destructive_hint boolean,
  add column if not exists idempotent_hint boolean,
  add column if not exists open_world_hint boolean,
  add column if not exists effect_class text,
  add column if not exists shutdown_policy text,
  add column if not exists idempotency_policy text;

with latest_revision as (
  select distinct on (server_id)
         server_id,
         manifest
    from registration_revision
   where server_id is not null
   order by server_id, created_at desc, id desc
)
update mcp_server server
   set read_only_hint = (revision.manifest->'tool'->'annotations'->>'readOnlyHint')::boolean,
       destructive_hint = (revision.manifest->'tool'->'annotations'->>'destructiveHint')::boolean,
       idempotent_hint = (revision.manifest->'tool'->'annotations'->>'idempotentHint')::boolean,
       open_world_hint = (revision.manifest->'tool'->'annotations'->>'openWorldHint')::boolean,
       effect_class = revision.manifest->'behavior'->>'effectClass',
       shutdown_policy = revision.manifest->'behavior'->>'shutdownPolicy',
       idempotency_policy = revision.manifest->'behavior'->>'idempotencyPolicy'
  from latest_revision revision
 where revision.server_id = server.id
   and server.read_only_hint is null;

alter table mcp_server
  drop constraint if exists mcp_server_effect_class_check,
  drop constraint if exists mcp_server_shutdown_policy_check;

alter table mcp_server
  add constraint mcp_server_effect_class_check
    check (effect_class is null or effect_class in ('READ_ONLY','IDEMPOTENT_WRITE','NON_IDEMPOTENT_WRITE')),
  add constraint mcp_server_shutdown_policy_check
    check (shutdown_policy is null or shutdown_policy in ('COMPLETE_IN_FLIGHT','CANCEL_SAFE','COMPENSATE'));

create table if not exists function_concurrency_lease (
  lease_id uuid primary key default gen_random_uuid(),
  server_id uuid not null references mcp_server(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists function_concurrency_lease_server_idx
  on function_concurrency_lease(server_id, expires_at);

delete from function_rate_bucket;

alter table function_rate_bucket
  add column if not exists credential_id uuid;

alter table function_rate_bucket
  alter column credential_id set not null,
  drop constraint if exists function_rate_bucket_pkey,
  drop constraint if exists function_rate_bucket_credential_id_fkey;

alter table function_rate_bucket
  add primary key (server_id, credential_id),
  add constraint function_rate_bucket_credential_id_fkey
    foreign key (credential_id) references kaja_credential(id) on delete cascade;

create index if not exists function_rate_bucket_window_idx
  on function_rate_bucket(window_started_at);

create table if not exists mcp_invocation_idempotency (
  server_id uuid not null references mcp_server(id) on delete cascade,
  credential_id uuid not null references kaja_credential(id) on delete cascade,
  idempotency_key text not null,
  request_digest text not null,
  status text not null check (status in ('PENDING','COMPLETED')),
  response_json jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (server_id, credential_id, idempotency_key)
);

create index if not exists mcp_invocation_idempotency_created_idx
  on mcp_invocation_idempotency(created_at);
