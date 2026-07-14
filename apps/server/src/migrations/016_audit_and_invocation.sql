drop trigger if exists audit_event_append_only_update on audit_event;

alter table audit_event
  add column if not exists chain_sequence bigint,
  add column if not exists prev_hash bytea,
  add column if not exists event_hash bytea;

create or replace function compute_audit_event_hash(
  p_prev_hash bytea,
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_object_type text,
  p_object_id text,
  p_before jsonb,
  p_after jsonb,
  p_correlation_id uuid
) returns bytea
language sql
immutable
set search_path = pg_catalog, public
as $$
  select public.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'prevHash', case when p_prev_hash is null then null else pg_catalog.encode(p_prev_hash, 'hex') end,
        'eventType', p_event_type,
        'actorType', p_actor_type,
        'actorId', p_actor_id,
        'objectType', p_object_type,
        'objectId', p_object_id,
        'before', coalesce(p_before, 'null'::jsonb),
        'after', coalesce(p_after, 'null'::jsonb),
        'correlationId', p_correlation_id::text
      )::text,
      'UTF8'
    ),
    'sha256'
  )
$$;

do $$
declare
  audit_row record;
  previous_hash bytea := null;
  next_sequence bigint := 0;
begin
  lock table audit_event in access exclusive mode;
  for audit_row in
    select * from audit_event order by id asc
  loop
    next_sequence := next_sequence + 1;
    update audit_event
       set chain_sequence = next_sequence,
           prev_hash = previous_hash,
           event_hash = compute_audit_event_hash(
             previous_hash,
             audit_row.event_type,
             audit_row.actor_type,
             audit_row.actor_id,
             audit_row.object_type,
             audit_row.object_id,
             audit_row.before_json,
             audit_row.after_json,
             audit_row.correlation_id
           )
     where id = audit_row.id;
    select event_hash into previous_hash from audit_event where id = audit_row.id;
  end loop;
end $$;

alter table audit_event
  alter column chain_sequence set not null,
  alter column event_hash set not null;

create unique index if not exists audit_event_chain_sequence_idx on audit_event(chain_sequence);
create unique index if not exists audit_event_event_hash_idx on audit_event(event_hash);

create table if not exists audit_head (
  singleton boolean primary key default true check (singleton),
  last_sequence bigint not null,
  event_hash bytea,
  updated_at timestamptz not null default now()
);

insert into audit_head(singleton, last_sequence, event_hash)
select true,
       coalesce(max(chain_sequence), 0),
       (array_agg(event_hash order by chain_sequence desc))[1]
  from audit_event
on conflict (singleton) do update
  set last_sequence=excluded.last_sequence,
      event_hash=excluded.event_hash,
      updated_at=now();

create or replace function audit_event_hash_before_insert() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  head audit_head%rowtype;
begin
  select * into head from audit_head where singleton is true for update;
  if not found then
    raise exception 'audit_head_missing';
  end if;
  new.chain_sequence := head.last_sequence + 1;
  new.prev_hash := head.event_hash;
  new.event_hash := compute_audit_event_hash(
    head.event_hash,
    new.event_type,
    new.actor_type,
    new.actor_id,
    new.object_type,
    new.object_id,
    new.before_json,
    new.after_json,
    new.correlation_id
  );
  update audit_head
     set last_sequence=new.chain_sequence,
         event_hash=new.event_hash,
         updated_at=now()
   where singleton is true;
  return new;
end $$;

drop trigger if exists audit_event_hash_insert on audit_event;
create trigger audit_event_hash_insert
before insert on audit_event
for each row execute function audit_event_hash_before_insert();

create or replace function audit_event_no_update_delete() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'audit_event is append-only';
end $$;

create trigger audit_event_append_only_update
before update or delete on audit_event
for each row execute function audit_event_no_update_delete();

create or replace function append_audit_event(
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_object_type text,
  p_object_id text,
  p_before jsonb,
  p_after jsonb,
  p_correlation_id uuid
) returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_id bigint;
begin
  insert into public.audit_event(
    event_type, actor_type, actor_id, object_type, object_id,
    before_json, after_json, correlation_id
  ) values (
    p_event_type, p_actor_type, p_actor_id, p_object_type, p_object_id,
    p_before, p_after, p_correlation_id
  ) returning id into inserted_id;
  return inserted_id;
end $$;

revoke all on function append_audit_event(text,text,text,text,text,jsonb,jsonb,uuid) from public;
grant execute on function append_audit_event(text,text,text,text,text,jsonb,jsonb,uuid) to current_user;

create or replace function verify_audit_chain()
returns table(valid boolean, event_count bigint, latest_event_id bigint, broken_event_id bigint)
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  audit_row record;
  previous_hash bytea := null;
  expected_sequence bigint := 0;
  expected_hash bytea;
begin
  select count(*), max(id) into event_count, latest_event_id from audit_event;
  for audit_row in select * from audit_event order by chain_sequence asc loop
    expected_sequence := expected_sequence + 1;
    expected_hash := compute_audit_event_hash(
      previous_hash,
      audit_row.event_type,
      audit_row.actor_type,
      audit_row.actor_id,
      audit_row.object_type,
      audit_row.object_id,
      audit_row.before_json,
      audit_row.after_json,
      audit_row.correlation_id
    );
    if audit_row.chain_sequence <> expected_sequence
       or audit_row.prev_hash is distinct from previous_hash
       or audit_row.event_hash is distinct from expected_hash then
      valid := false;
      broken_event_id := audit_row.id;
      return next;
      return;
    end if;
    previous_hash := audit_row.event_hash;
  end loop;
  valid := true;
  broken_event_id := null;
  return next;
end $$;

create table if not exists mcp_invocation (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references mcp_server(id),
  credential_id uuid not null references kaja_credential(id),
  correlation_id uuid not null unique,
  request_digest text not null,
  idempotency_key text,
  status text not null check (status in ('ACCEPTED','SUCCEEDED','FAILED','FINALIZATION_FAILED')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_class text,
  response_digest text,
  accepted_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index if not exists mcp_invocation_server_accepted_idx
  on mcp_invocation(server_id, accepted_at desc);
