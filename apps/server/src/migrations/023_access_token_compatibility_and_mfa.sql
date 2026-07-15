alter table managed_service_access_token
  add column if not exists legacy_access_token_digest bytea;

update managed_service_access_token token
   set legacy_access_token_digest = token.lookup_digest
  from managed_service service
 where service.id = token.managed_service_id
   and service.legacy_mcp_server_id is not null
   and token.legacy_access_token_digest is null
   and exists (
     select 1
       from access_token legacy
      where legacy.lookup_digest = token.lookup_digest
        and legacy.credential_id = token.credential_id
        and legacy.server_id = service.legacy_mcp_server_id
   );

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'managed_service_access_token_legacy_access_token_digest_fkey'
  ) then
    alter table managed_service_access_token
      add constraint managed_service_access_token_legacy_access_token_digest_fkey
      foreign key (legacy_access_token_digest)
      references access_token(lookup_digest)
      deferrable initially deferred;
  end if;
end $$;

create unique index if not exists managed_service_access_token_legacy_access_token_digest_idx
  on managed_service_access_token(legacy_access_token_digest)
  where legacy_access_token_digest is not null;
