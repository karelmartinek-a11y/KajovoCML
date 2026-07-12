create extension if not exists pgcrypto;
create extension if not exists citext;

do $$ begin
  create type registration_state as enum ('DRAFT','DOCUMENTATION_INCOMPLETE','PENDING_TECH_REVIEW','PENDING_SECURITY_REVIEW','PENDING_TEST','TEST_FAILED','APPROVED','REGISTERED_DISABLED','TRIAL','ACTIVE','SUSPENDED','QUARANTINED','REJECTED','RETIRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type operational_state as enum ('UNKNOWN','DISABLED','HEALTHY','DEGRADED','UNHEALTHY','QUARANTINED','MAINTENANCE','RETIRED');
exception when duplicate_object then null; end $$;

create sequence if not exists kcml_number_seq start 1;
create sequence if not exists kaja_number_seq start 1;

create table if not exists mcp_server (
  id uuid primary key default gen_random_uuid(),
  kcml_number bigint not null unique,
  code citext not null unique,
  hostname citext not null unique,
  tool_name citext not null unique,
  display_name text not null,
  description text not null,
  enabled boolean not null default false,
  registration_state registration_state not null default 'DRAFT',
  operational_state operational_state not null default 'UNKNOWN',
  input_schema jsonb not null,
  output_schema jsonb not null,
  handler_key text not null,
  handler_version text not null,
  contract_version text not null,
  artifact_digest text not null,
  manifest_digest text not null,
  revocation_epoch uuid not null default gen_random_uuid(),
  lock_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  check (code ~* '^KCML[0-9]{4,}$'),
  check (hostname ~* '^kcml[0-9]{4,}\\.hcasc\\.cz$'),
  check ((registration_state in ('ACTIVE','TRIAL') and enabled is true) or registration_state not in ('ACTIVE','TRIAL') or enabled is false)
);

create table if not exists registration_revision (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references mcp_server(id),
  revision text not null,
  state registration_state not null,
  manifest jsonb not null,
  manifest_digest text not null,
  artifact_digest text not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(server_id, revision)
);

create table if not exists kaja_credential (
  id uuid primary key default gen_random_uuid(),
  public_id citext not null unique,
  secret_hash text not null,
  secret_fingerprint text not null,
  active boolean not null default true,
  revoked_at timestamptz,
  deleted_at timestamptz,
  revocation_epoch uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  check (public_id ~* '^Kaja[0-9]{4,}$')
);

create table if not exists kaja_permission (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references kaja_credential(id),
  server_id uuid not null references mcp_server(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(credential_id, server_id)
);

create table if not exists access_token (
  lookup_digest bytea primary key,
  key_id text not null,
  fingerprint text not null,
  credential_id uuid not null references kaja_credential(id),
  server_id uuid not null references mcp_server(id),
  audience text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  credential_revocation_epoch uuid not null,
  server_revocation_epoch uuid not null
);

create table if not exists audit_event (
  id bigserial primary key,
  event_type text not null,
  actor_type text not null,
  actor_id text,
  object_type text,
  object_id text,
  before_json jsonb,
  after_json jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create or replace function audit_event_no_update_delete() returns trigger language plpgsql as $$
begin
  raise exception 'audit_event is append-only';
end $$;

drop trigger if exists audit_event_append_only_update on audit_event;
create trigger audit_event_append_only_update before update or delete on audit_event
for each row execute function audit_event_no_update_delete();

create table if not exists function_statistics (
  server_id uuid primary key references mcp_server(id),
  success_count bigint not null default 0 check (success_count >= 0),
  unauthorized_count bigint not null default 0 check (unauthorized_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_unauthorized_at timestamptz
);

create table if not exists admin_account (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  password_hash text,
  password_changed_at timestamptz,
  mfa_enabled boolean not null default false,
  mfa_secret text,
  created_at timestamptz not null default now()
);

create table if not exists admin_session (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references admin_account(id),
  session_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

insert into admin_account(username, mfa_enabled)
values ('karmar78', false)
on conflict (username) do nothing;
