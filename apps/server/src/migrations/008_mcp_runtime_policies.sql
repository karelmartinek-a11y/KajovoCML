alter table mcp_server
  add column if not exists read_only_hint boolean not null default true,
  add column if not exists destructive_hint boolean not null default false,
  add column if not exists idempotent_hint boolean not null default true,
  add column if not exists open_world_hint boolean not null default false,
  add column if not exists effect_class text not null default 'READ_ONLY',
  add column if not exists shutdown_policy text not null default 'COMPLETE_IN_FLIGHT',
  add column if not exists idempotency_policy text not null default 'read only';

create table if not exists function_concurrency_lease (
  lease_id uuid primary key default gen_random_uuid(),
  server_id uuid not null references mcp_server(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists function_concurrency_lease_server_idx
  on function_concurrency_lease(server_id, expires_at);
