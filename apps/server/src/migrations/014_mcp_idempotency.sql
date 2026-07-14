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
