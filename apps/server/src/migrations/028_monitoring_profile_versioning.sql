alter table monitoring_profile
  add column if not exists version bigint not null default 0 check (version >= 0);

create index if not exists monitoring_profile_revision_idx
  on monitoring_profile(registration_revision_id,version);
