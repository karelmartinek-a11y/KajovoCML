alter table schema_migration
  alter column sequence_number set not null,
  alter column checksum_sha256 set not null;

alter table admin_session
  add column if not exists lookup_digest bytea;

create unique index if not exists admin_session_lookup_digest_idx
  on admin_session(lookup_digest)
  where lookup_digest is not null;

create table if not exists admin_login_throttle (
  attempt_key bytea primary key,
  failure_count integer not null default 0 check (failure_count >= 0),
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists admin_login_throttle_expiry_idx
  on admin_login_throttle(updated_at);
