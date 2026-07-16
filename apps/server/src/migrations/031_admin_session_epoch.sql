alter table admin_account
  add column if not exists session_epoch uuid not null default gen_random_uuid();

alter table admin_session
  add column if not exists session_epoch uuid;

update admin_session session
   set session_epoch=account.session_epoch
  from admin_account account
 where account.id=session.account_id
   and session.session_epoch is null;

alter table admin_session
  alter column session_epoch set not null;

create index if not exists admin_session_account_epoch_idx
  on admin_session(account_id,session_epoch)
  where revoked_at is null;
