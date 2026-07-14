do $$ begin
  create type managed_service_kind as enum ('MCP','EXTERNAL_API');
exception when duplicate_object then null; end $$;

do $$ begin
  create type managed_service_state as enum (
    'DRAFT',
    'REGISTERED_DISABLED',
    'TRIAL',
    'ACTIVE',
    'SUSPENDED',
    'QUARANTINED',
    'RETIRED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type managed_service_auth_mode as enum (
    'OAUTH2_CLIENT_CREDENTIALS',
    'STATIC_BEARER',
    'STATIC_API_KEY',
    'MTLS',
    'NONE'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_pipeline_kind as enum ('MCP_ONBOARDING','EXTERNAL_API_REGISTRATION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type managed_service_api_state as enum ('ENABLED','DISABLED');
exception when duplicate_object then null; end $$;

create table if not exists managed_service (
  id uuid primary key default gen_random_uuid(),
  legacy_mcp_server_id uuid unique references mcp_server(id) on delete set null,
  code citext not null unique,
  slug citext not null unique,
  display_name text not null,
  description text not null,
  service_kind managed_service_kind not null,
  lifecycle_state managed_service_state not null default 'DRAFT',
  operational_state operational_state not null default 'UNKNOWN',
  enabled boolean not null default false,
  public_hostname citext,
  base_url text,
  resource_uri text,
  auth_mode managed_service_auth_mode not null default 'OAUTH2_CLIENT_CREDENTIALS',
  api_state managed_service_api_state not null default 'DISABLED',
  api_disabled_reason text,
  criticality text not null default 'MEDIUM' check (criticality in ('LOW','MEDIUM','HIGH','CRITICAL')),
  owners jsonb not null default '{}'::jsonb,
  contacts jsonb not null default '{}'::jsonb,
  governance jsonb not null default '{}'::jsonb,
  active_revision_id uuid,
  monitoring_enabled boolean not null default false,
  monitoring_profile_digest text,
  review_approved_at timestamptz,
  review_due_at timestamptz,
  review_interval_days integer check (review_interval_days is null or review_interval_days between 1 and 365),
  revocation_epoch uuid not null default gen_random_uuid(),
  lock_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  check (
    public_hostname is null
    or public_hostname ~* '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
  ),
  check (
    base_url is null
    or base_url ~* '^https://'
  ),
  check (
    resource_uri is null
    or resource_uri ~* '^https://'
  ),
  check (
    (lifecycle_state in ('ACTIVE','TRIAL') and enabled is true)
    or lifecycle_state not in ('ACTIVE','TRIAL')
    or enabled is false
  )
);

create table if not exists managed_service_api_status (
  managed_service_id uuid primary key references managed_service(id) on delete cascade,
  api_state managed_service_api_state not null,
  disabled_reason text,
  changed_by_type text not null,
  changed_by_id text,
  correlation_id uuid,
  changed_at timestamptz not null default now()
);

create table if not exists managed_service_revision (
  id uuid primary key default gen_random_uuid(),
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  revision text not null,
  schema_version text not null,
  service_kind managed_service_kind not null,
  validation_state text not null default 'APPROVED',
  manifest jsonb not null,
  manifest_digest text not null,
  artifact_digest text,
  contract_digest text,
  sbom_digest text,
  provenance_digest text,
  evidence jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  review_due_at timestamptz,
  review_interval_days integer check (review_interval_days is null or review_interval_days between 1 and 365),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique(managed_service_id, revision)
);

create unique index if not exists managed_service_active_revision_unique_idx
  on managed_service_revision(managed_service_id)
  where active is true;

alter table managed_service
  drop constraint if exists managed_service_active_revision_id_fkey;

alter table managed_service
  add constraint managed_service_active_revision_id_fkey
  foreign key (active_revision_id)
  references managed_service_revision(id)
  deferrable initially deferred;

create table if not exists managed_service_scope (
  id uuid primary key default gen_random_uuid(),
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  scope_name text not null,
  level text not null check (level in ('DISCOVER','MONITOR','INVOKE','READ','WRITE','ADMIN')),
  description text not null,
  constraints_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(managed_service_id, scope_name)
);

create table if not exists managed_service_permission (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references kaja_credential(id),
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  scope_id uuid not null references managed_service_scope(id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(credential_id, managed_service_id, scope_id)
);

create index if not exists managed_service_permission_lookup_idx
  on managed_service_permission(credential_id, managed_service_id)
  where revoked_at is null;

create table if not exists managed_service_access_token (
  lookup_digest bytea primary key,
  key_id text not null,
  fingerprint text not null,
  credential_id uuid not null references kaja_credential(id),
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  audience text not null,
  scope_names text[] not null default '{}',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  credential_revocation_epoch uuid not null,
  service_revocation_epoch uuid not null
);

create index if not exists managed_service_access_token_service_expires_idx
  on managed_service_access_token(managed_service_id, expires_at desc)
  where revoked_at is null;

create table if not exists managed_service_usage_event (
  id bigserial primary key,
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  credential_id uuid references kaja_credential(id),
  scope_name text,
  request_digest text,
  response_digest text,
  outcome text not null check (outcome in ('ACCEPTED','SUCCEEDED','FAILED','UNAUTHORIZED','RATE_LIMITED')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  classification text,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists managed_service_usage_event_service_created_idx
  on managed_service_usage_event(managed_service_id, created_at desc);

create table if not exists managed_service_runtime_log_event (
  id bigserial primary key,
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  level text not null check (level in ('info','warn','error')),
  event_name text not null,
  fields jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists managed_service_runtime_log_correlation_idx
  on managed_service_runtime_log_event(correlation_id);

create table if not exists managed_service_probe_result (
  id bigserial primary key,
  managed_service_id uuid not null references managed_service(id) on delete cascade,
  probe_type text not null,
  status text not null check (status in ('PASS','FAIL','STALE')),
  latency_ms integer,
  evidence jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  checked_at timestamptz not null default now()
);

create index if not exists managed_service_probe_service_checked_idx
  on managed_service_probe_result(managed_service_id, probe_type, checked_at desc);

create table if not exists external_api_service_profile (
  managed_service_id uuid primary key references managed_service(id) on delete cascade,
  base_url text not null check (base_url ~* '^https://'),
  healthcheck_url text check (healthcheck_url is null or healthcheck_url ~* '^https://'),
  readiness_url text check (readiness_url is null or readiness_url ~* '^https://'),
  token_endpoint_url text check (token_endpoint_url is null or token_endpoint_url ~* '^https://'),
  jwks_url text check (jwks_url is null or jwks_url ~* '^https://'),
  auth_metadata_url text check (auth_metadata_url is null or auth_metadata_url ~* '^https://'),
  api_style text not null default 'REST' check (api_style in ('REST','GRAPHQL','CUSTOM_HTTP')),
  auth_header_name text not null default 'Authorization',
  auth_header_scheme text,
  token_forwarding_mode text not null default 'BEARER' check (token_forwarding_mode in ('BEARER','HEADER_VALUE','QUERY_FORBIDDEN')),
  rate_window_seconds integer check (rate_window_seconds is null or rate_window_seconds between 1 and 86400),
  rate_max_requests integer check (rate_max_requests is null or rate_max_requests between 1 and 100000),
  timeout_ms integer check (timeout_ms is null or timeout_ms between 100 and 60000),
  upstream_contract jsonb not null default '{}'::jsonb,
  monitoring_contract jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists service_pipeline_run (
  id uuid primary key default gen_random_uuid(),
  managed_service_id uuid references managed_service(id) on delete cascade,
  integration_token_id uuid references integration_token(id) on delete set null,
  pipeline_kind service_pipeline_kind not null,
  state text not null,
  source_revision integer not null default 0,
  lock_version bigint not null default 0,
  request_digest text,
  blocking_error_code text,
  blocking_error_detail text,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists service_pipeline_run_service_created_idx
  on service_pipeline_run(managed_service_id, created_at desc);

create table if not exists service_pipeline_event (
  id bigserial primary key,
  pipeline_run_id uuid not null references service_pipeline_run(id) on delete cascade,
  from_state text,
  to_state text not null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists service_pipeline_event_run_created_idx
  on service_pipeline_event(pipeline_run_id, created_at desc);
