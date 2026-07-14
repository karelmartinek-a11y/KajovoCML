alter table admin_session
  add column if not exists lookup_digest bytea;

create unique index if not exists admin_session_lookup_digest_idx
  on admin_session(lookup_digest)
  where lookup_digest is not null;
