alter table monitoring_profile
  add column if not exists registration_revision_id uuid references registration_revision(id),
  add column if not exists profile_digest text,
  add column if not exists next_probe_at timestamptz not null default now(),
  add column if not exists last_probe_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0 check (consecutive_failures >= 0);

insert into monitoring_profile(server_id, profile, enabled, registration_revision_id, profile_digest)
select server.id,
       revision.manifest->'monitoringProfile',
       server.registration_state in ('ACTIVE','TRIAL'),
       revision.id,
       'sha256:' || encode(digest(convert_to((revision.manifest->'monitoringProfile')::text, 'UTF8'), 'sha256'), 'hex')
  from mcp_server server
  join registration_revision revision on revision.id=server.active_revision_id
 where revision.manifest ? 'monitoringProfile'
on conflict (server_id) do update
  set registration_revision_id=excluded.registration_revision_id,
      profile_digest=excluded.profile_digest,
      enabled=monitoring_profile.enabled or excluded.enabled;

update monitoring_profile
   set profile_digest='sha256:' || encode(digest(convert_to(profile::text, 'UTF8'), 'sha256'), 'hex')
 where profile_digest is null;

create table if not exists server_state_history (
  id bigserial primary key,
  server_id uuid not null references mcp_server(id),
  registration_state registration_state not null,
  operational_state operational_state not null,
  recertification_phase text not null,
  reason text not null,
  correlation_id uuid not null,
  recorded_at timestamptz not null default now()
);

create index if not exists server_state_history_server_recorded_idx
  on server_state_history(server_id, recorded_at desc);

create table if not exists operational_alert (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references mcp_server(id),
  severity text not null check (severity in ('WARNING','HIGH','CRITICAL')),
  alert_type text not null,
  status text not null default 'OPEN' check (status in ('OPEN','ACKNOWLEDGED','SUPPRESSED','CLOSED')),
  title text not null,
  detail jsonb not null default '{}',
  correlation_id uuid not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references admin_account(id),
  acknowledged_at timestamptz,
  suppression_reason text,
  suppression_owner uuid references admin_account(id),
  suppressed_until timestamptz,
  closed_at timestamptz
);

create index if not exists operational_alert_status_severity_idx
  on operational_alert(status, severity, last_seen_at desc);

create unique index if not exists operational_alert_active_unique_idx
  on operational_alert(coalesce(server_id, '00000000-0000-0000-0000-000000000000'::uuid), alert_type)
  where status in ('OPEN','ACKNOWLEDGED','SUPPRESSED');

create table if not exists alert_webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references operational_alert(id) on delete cascade,
  channel text not null check (channel in ('PRIMARY','BACKUP')),
  idempotency_key uuid not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  state text not null default 'PENDING' check (state in ('PENDING','DELIVERED','RETRY','DEAD_LETTER')),
  last_http_status integer,
  last_error text,
  response_digest text,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(alert_id, channel)
);

create index if not exists alert_webhook_delivery_runnable_idx
  on alert_webhook_delivery(next_attempt_at, created_at)
  where state in ('PENDING','RETRY');

create table if not exists monitoring_scheduler_heartbeat (
  singleton boolean primary key default true check (singleton),
  worker_id text not null,
  last_started_at timestamptz not null,
  last_completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
