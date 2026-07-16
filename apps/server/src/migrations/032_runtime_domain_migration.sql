alter table mcp_server
  drop constraint if exists mcp_server_hostname_check;

alter table mcp_server
  add constraint mcp_server_hostname_check check (
    split_part(lower(hostname::text),'.',1)=lower(code::text)
    and hostname ~* '^kcml[0-9]{4,}[.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  );

alter table onboarding_job
  drop constraint if exists onboarding_job_hostname_check;

alter table onboarding_job
  add constraint onboarding_job_hostname_check check (
    hostname is null
    or (
      code is not null
      and split_part(lower(hostname::text),'.',1)=lower(code::text)
      and hostname ~* '^kcml[0-9]{4,}[.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  );
