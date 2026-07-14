alter table registration_revision
  add column if not exists schema_version text,
  add column if not exists approved_at timestamptz,
  add column if not exists review_due_at timestamptz,
  add column if not exists review_interval_days integer,
  add column if not exists certification_digest text,
  add column if not exists validation_state text,
  add column if not exists active boolean not null default false,
  add column if not exists superseded_at timestamptz,
  add column if not exists warning_emitted_at timestamptz;

with normalized as (
  select id,
         coalesce(manifest->>'schemaVersion', 'legacy') as schema_version,
         coalesce(
           nullif(manifest->'review'->>'reviewDueAt', '')::timestamptz,
           nullif(manifest->'change'->>'reviewDueAt', '')::timestamptz
         ) as review_due_at,
         nullif(manifest->'review'->>'approvedAt', '')::timestamptz as declared_approved_at,
         coalesce(
           nullif(manifest->'review'->>'intervalDays', '')::integer,
           case
             when manifest->'behavior'->>'effectClass' = 'NON_IDEMPOTENT_WRITE'
               or coalesce((manifest->'dependencies'->'dataClassification'->>'containsPersonalData')::boolean, false)
               or coalesce((manifest->'dataGovernance'->>'containsPersonalData')::boolean, false)
               or manifest->'dataGovernance'->>'classification' in ('CONFIDENTIAL','RESTRICTED')
               or manifest->>'criticality' = 'CRITICAL'
             then 180
             else 365
           end
         ) as review_interval_days
    from registration_revision
   where schema_version is null
)
update registration_revision revision
   set schema_version = normalized.schema_version,
       approved_at = coalesce(
         normalized.declared_approved_at,
         normalized.review_due_at - make_interval(days => normalized.review_interval_days)
       ),
       review_due_at = normalized.review_due_at,
       review_interval_days = normalized.review_interval_days,
       certification_digest = revision.manifest_digest,
       validation_state = case
         when normalized.review_due_at is null then 'INVALID'
         when normalized.schema_version = '1.5' and normalized.declared_approved_at is null then 'INVALID'
         else 'VALID'
       end
  from normalized
 where normalized.id = revision.id;

with ranked as (
  select id,
         row_number() over (partition by server_id order by created_at desc, id desc) as position
    from registration_revision
   where server_id is not null
)
update registration_revision revision
   set active = ranked.position = 1,
       superseded_at = case when ranked.position = 1 then null else coalesce(revision.superseded_at, now()) end
  from ranked
 where ranked.id = revision.id;

alter table registration_revision
  drop constraint if exists registration_revision_validation_state_check,
  drop constraint if exists registration_revision_review_interval_check;

alter table registration_revision
  add constraint registration_revision_validation_state_check
    check (validation_state in ('VALID','INVALID')),
  add constraint registration_revision_review_interval_check
    check (review_interval_days between 1 and 365);

create unique index if not exists registration_revision_one_active_idx
  on registration_revision(server_id)
  where active is true and server_id is not null;

alter table mcp_server
  add column if not exists active_revision_id uuid references registration_revision(id);

update mcp_server server
   set active_revision_id = revision.id
  from registration_revision revision
 where revision.server_id = server.id
   and revision.active is true
   and server.active_revision_id is null;
