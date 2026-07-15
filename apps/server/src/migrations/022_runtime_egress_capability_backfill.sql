with desired_allowlist as (
  select
    server.id as server_id,
    case
      when server.code = 'KCML0002'
        and coalesce(jsonb_array_length(revision.manifest #> '{runtime,egressAllowlist}'), 0) = 0
      then '["ha-inventory.hcasc.cz:443"]'::jsonb
      when jsonb_typeof(revision.manifest #> '{runtime,egressAllowlist}') = 'array'
      then revision.manifest #> '{runtime,egressAllowlist}'
      else null
    end as allowlist
  from mcp_server server
  join registration_revision revision on revision.id = server.active_revision_id
)
update egress_capability capability
   set allowlist = coalesce(desired.allowlist, capability.allowlist),
       expires_at = greatest(capability.expires_at, now() + interval '3650 days')
  from desired_allowlist desired
 where capability.server_id = desired.server_id
   and capability.revoked_at is null
   and (
     capability.expires_at < now() + interval '3650 days'
     or (desired.allowlist is not null and capability.allowlist <> desired.allowlist)
   );
