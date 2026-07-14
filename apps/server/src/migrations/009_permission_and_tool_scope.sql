alter table kaja_permission
  drop constraint if exists kaja_permission_access_level_check;

update kaja_permission
   set access_level='EXECUTE'
 where access_level <> 'EXECUTE';

alter table kaja_permission
  alter column access_level set default 'EXECUTE';

alter table kaja_permission
  add constraint kaja_permission_access_level_check
  check (access_level = 'EXECUTE');

alter table mcp_server
  drop constraint if exists mcp_server_tool_name_key;

alter table onboarding_job
  drop constraint if exists onboarding_job_tool_name_key;
