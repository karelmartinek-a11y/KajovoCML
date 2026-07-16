create table if not exists audit_archive_outbox (
  event_id bigint primary key references audit_event(id),
  payload jsonb not null,
  state text not null default 'PENDING' check (state in ('PENDING','PROCESSING','ARCHIVED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  last_error text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_archive_outbox_pending_idx
  on audit_archive_outbox(next_attempt_at,event_id)
  where state <> 'ARCHIVED';

create or replace function enqueue_audit_archive_event() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.audit_archive_outbox(event_id,payload)
  values (
    new.id,
    pg_catalog.jsonb_build_object(
      'id',new.id,
      'sequence',new.chain_sequence,
      'eventType',new.event_type,
      'actorType',new.actor_type,
      'actorId',new.actor_id,
      'objectType',new.object_type,
      'objectId',new.object_id,
      'before',new.before_json,
      'after',new.after_json,
      'correlationId',new.correlation_id,
      'createdAt',new.created_at,
      'previousHash',case when new.prev_hash is null then null else pg_catalog.encode(new.prev_hash,'hex') end,
      'eventHash',pg_catalog.encode(new.event_hash,'hex')
    )
  ) on conflict (event_id) do nothing;
  return new;
end $$;

drop trigger if exists audit_event_archive_enqueue on audit_event;
create trigger audit_event_archive_enqueue
after insert on audit_event
for each row execute function enqueue_audit_archive_event();

insert into audit_archive_outbox(event_id,payload,state)
select event.id,
       jsonb_build_object(
         'id',event.id,
         'sequence',event.chain_sequence,
         'eventType',event.event_type,
         'actorType',event.actor_type,
         'actorId',event.actor_id,
         'objectType',event.object_type,
         'objectId',event.object_id,
         'before',event.before_json,
         'after',event.after_json,
         'correlationId',event.correlation_id,
         'createdAt',event.created_at,
         'previousHash',case when event.prev_hash is null then null else encode(event.prev_hash,'hex') end,
         'eventHash',encode(event.event_hash,'hex')
       ),
       'PENDING'
  from audit_event event
on conflict (event_id) do nothing;

revoke insert, update, delete, truncate on audit_event from public;
revoke insert, update, delete, truncate on audit_event from current_user;
grant select on audit_event to current_user;
revoke all on function enqueue_audit_archive_event() from public;
