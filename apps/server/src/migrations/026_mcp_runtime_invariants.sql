alter table mcp_invocation_idempotency
  add column if not exists pending_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update mcp_invocation_idempotency
   set pending_expires_at = case
     when status = 'PENDING' then created_at + interval '15 minutes'
     else completed_at
   end
 where pending_expires_at is null;

alter table mcp_invocation_idempotency
  alter column pending_expires_at set not null;

create index if not exists mcp_invocation_idempotency_pending_expiry_idx
  on mcp_invocation_idempotency(pending_expires_at)
  where status = 'PENDING';

create table if not exists mcp_rate_bucket (
  scope_type text not null check (scope_type in ('SERVER','CREDENTIAL','SERVER_CREDENTIAL')),
  scope_key bytea not null,
  server_id uuid references mcp_server(id) on delete cascade,
  credential_id uuid references kaja_credential(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_key),
  constraint mcp_rate_bucket_scope_shape_check check (
    (scope_type = 'SERVER' and server_id is not null and credential_id is null)
    or (scope_type = 'CREDENTIAL' and server_id is null and credential_id is not null)
    or (scope_type = 'SERVER_CREDENTIAL' and server_id is not null and credential_id is not null)
  )
);

create index if not exists mcp_rate_bucket_updated_idx on mcp_rate_bucket(updated_at);
