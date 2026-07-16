alter table admin_account
  add column if not exists role text not null default 'ADMIN',
  add column if not exists active boolean not null default true,
  add column if not exists activated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table admin_account
  drop constraint if exists admin_account_role_check;

alter table admin_account
  add constraint admin_account_role_check check (role in ('OWNER','ADMIN','AUDITOR'));

update admin_account set active=false where password_hash is null;
update admin_account
   set activated_at=coalesce(activated_at,password_changed_at,created_at)
 where password_hash is not null;

with first_owner as (
  select id from admin_account
   where active is true and password_hash is not null
   order by created_at,id
   limit 1
)
update admin_account account
   set role='OWNER'
  from first_owner
 where account.id=first_owner.id
   and not exists(select 1 from admin_account where role='OWNER' and active is true);

create table if not exists admin_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references admin_account(id),
  updated_at timestamptz not null default now()
);

insert into admin_bootstrap_state(singleton,completed,completed_at,completed_by)
select true,
       exists(select 1 from admin_account where active is true and password_hash is not null),
       case when exists(select 1 from admin_account where active is true and password_hash is not null) then now() else null end,
       (select id from admin_account where active is true and password_hash is not null order by created_at,id limit 1)
on conflict (singleton) do nothing;

alter table admin_session add column if not exists reauthenticated_at timestamptz;
update admin_session set reauthenticated_at=created_at where reauthenticated_at is null;

create or replace function preserve_last_admin_owner() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.active is true and old.role='OWNER' then
    if tg_op='DELETE' then
      if not exists(select 1 from public.admin_account where id<>old.id and active is true and role='OWNER') then
        raise exception 'last_owner_required';
      end if;
    elsif new.active is not true or new.role<>'OWNER' then
      if not exists(select 1 from public.admin_account where id<>old.id and active is true and role='OWNER') then
        raise exception 'last_owner_required';
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists admin_account_preserve_last_owner on admin_account;
create trigger admin_account_preserve_last_owner
before update or delete on admin_account
for each row execute function preserve_last_admin_owner();

create index if not exists admin_account_active_role_idx on admin_account(active,role);
