insert into managed_service(
  legacy_mcp_server_id,
  code,
  slug,
  display_name,
  description,
  service_kind,
  lifecycle_state,
  operational_state,
  enabled,
  public_hostname,
  base_url,
  resource_uri,
  auth_mode,
  api_state,
  api_disabled_reason,
  criticality,
  owners,
  contacts,
  governance,
  monitoring_enabled,
  monitoring_profile_digest,
  review_approved_at,
  review_due_at,
  review_interval_days,
  revocation_epoch,
  created_at,
  updated_at,
  retired_at
)
select
  ms.id,
  ms.code,
  lower(ms.code),
  ms.display_name,
  ms.description,
  'MCP'::managed_service_kind,
  case
    when ms.registration_state in ('DRAFT','DOCUMENTATION_INCOMPLETE','PENDING_TECH_REVIEW','PENDING_SECURITY_REVIEW','PENDING_TEST','TEST_FAILED','APPROVED')
      then 'DRAFT'::managed_service_state
    when ms.registration_state = 'REGISTERED_DISABLED'
      then 'REGISTERED_DISABLED'::managed_service_state
    when ms.registration_state = 'TRIAL'
      then 'TRIAL'::managed_service_state
    when ms.registration_state = 'ACTIVE'
      then 'ACTIVE'::managed_service_state
    when ms.registration_state = 'SUSPENDED'
      then 'SUSPENDED'::managed_service_state
    when ms.registration_state = 'QUARANTINED'
      then 'QUARANTINED'::managed_service_state
    when ms.registration_state in ('REJECTED','RETIRED')
      then 'RETIRED'::managed_service_state
    else 'DRAFT'::managed_service_state
  end,
  ms.operational_state,
  ms.enabled,
  ms.hostname,
  'https://' || ms.hostname,
  'https://' || ms.hostname || '/mcp',
  'OAUTH2_CLIENT_CREDENTIALS'::managed_service_auth_mode,
  case when ms.enabled then 'ENABLED'::managed_service_api_state else 'DISABLED'::managed_service_api_state end,
  case when ms.enabled then null else 'backfill_from_mcp_enabled_false' end,
  'MEDIUM',
  jsonb_build_object(),
  jsonb_build_object(),
  jsonb_build_object(
    'source', 'mcp_server_backfill',
    'toolName', ms.tool_name,
    'handlerKey', ms.handler_key,
    'handlerVersion', ms.handler_version,
    'contractVersion', ms.contract_version
  ),
  coalesce(mp.enabled, false),
  mp.profile_digest,
  rr.approved_at,
  rr.review_due_at,
  rr.review_interval_days,
  ms.revocation_epoch,
  ms.created_at,
  ms.updated_at,
  ms.retired_at
from mcp_server ms
left join registration_revision rr
  on rr.id = ms.active_revision_id
 and rr.server_id = ms.id
left join monitoring_profile mp
  on mp.server_id = ms.id
 and mp.registration_revision_id = rr.id
on conflict (legacy_mcp_server_id) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      lifecycle_state = excluded.lifecycle_state,
      operational_state = excluded.operational_state,
      enabled = excluded.enabled,
      public_hostname = excluded.public_hostname,
      base_url = excluded.base_url,
      resource_uri = excluded.resource_uri,
      api_state = excluded.api_state,
      api_disabled_reason = excluded.api_disabled_reason,
      monitoring_enabled = excluded.monitoring_enabled,
      monitoring_profile_digest = excluded.monitoring_profile_digest,
      review_approved_at = excluded.review_approved_at,
      review_due_at = excluded.review_due_at,
      review_interval_days = excluded.review_interval_days,
      revocation_epoch = excluded.revocation_epoch,
      updated_at = excluded.updated_at,
      retired_at = excluded.retired_at;

insert into managed_service_revision(
  id,
  managed_service_id,
  revision,
  schema_version,
  service_kind,
  validation_state,
  manifest,
  manifest_digest,
  artifact_digest,
  approved_at,
  review_due_at,
  review_interval_days,
  active,
  created_at
)
select
  rr.id,
  managed.id,
  rr.revision,
  rr.schema_version,
  'MCP'::managed_service_kind,
  coalesce(rr.validation_state, 'APPROVED'),
  rr.manifest,
  rr.manifest_digest,
  rr.artifact_digest,
  rr.approved_at,
  rr.review_due_at,
  rr.review_interval_days,
  rr.active,
  rr.created_at
from registration_revision rr
join managed_service managed
  on managed.legacy_mcp_server_id = rr.server_id
on conflict (id) do update
  set managed_service_id = excluded.managed_service_id,
      revision = excluded.revision,
      schema_version = excluded.schema_version,
      validation_state = excluded.validation_state,
      manifest = excluded.manifest,
      manifest_digest = excluded.manifest_digest,
      artifact_digest = excluded.artifact_digest,
      approved_at = excluded.approved_at,
      review_due_at = excluded.review_due_at,
      review_interval_days = excluded.review_interval_days,
      active = excluded.active;

update managed_service managed
   set active_revision_id = revision.id
  from managed_service_revision revision
 where revision.managed_service_id = managed.id
   and revision.active is true
   and managed.active_revision_id is distinct from revision.id;

insert into managed_service_scope(managed_service_id, scope_name, level, description)
select
  managed.id,
  'mcp.invoke',
  'INVOKE',
  'Invoke the single MCP tool exposed by this managed service.'
from managed_service managed
where managed.service_kind = 'MCP'
on conflict (managed_service_id, scope_name) do nothing;

insert into managed_service_scope(managed_service_id, scope_name, level, description)
select managed.id, seeded.scope_name, seeded.level, seeded.description
from managed_service managed
cross join (
  values
    ('service.read_state', 'DISCOVER', 'Read the current lifecycle, API exposure and recertification state of the managed service.'),
    ('service.read_logs', 'MONITOR', 'Read centrally redacted runtime, operational and audit-safe log evidence of the managed service.'),
    ('service.monitor.read', 'MONITOR', 'Read monitoring profile, probe history, alerts and service health evidence.'),
    ('service.api.enable', 'ADMIN', 'Re-enable the centrally governed API interface after policy and state checks pass.'),
    ('service.api.disable', 'ADMIN', 'Disable the centrally governed API interface without stopping the underlying business application.')
) as seeded(scope_name, level, description)
on conflict (managed_service_id, scope_name) do nothing;

insert into managed_service_api_status(
  managed_service_id,
  api_state,
  disabled_reason,
  changed_by_type,
  changed_by_id,
  correlation_id,
  changed_at
)
select
  managed.id,
  managed.api_state,
  managed.api_disabled_reason,
  'system',
  'backfill',
  null,
  managed.updated_at
from managed_service managed
on conflict (managed_service_id) do update
  set api_state = excluded.api_state,
      disabled_reason = excluded.disabled_reason,
      changed_at = excluded.changed_at;

insert into managed_service_permission(credential_id, managed_service_id, scope_id, granted_at, revoked_at)
select
  kp.credential_id,
  managed.id,
  scope.id,
  kp.granted_at,
  kp.revoked_at
from kaja_permission kp
join managed_service managed
  on managed.legacy_mcp_server_id = kp.server_id
join managed_service_scope scope
  on scope.managed_service_id = managed.id
 and scope.scope_name = 'mcp.invoke'
on conflict (credential_id, managed_service_id, scope_id) do update
  set granted_at = excluded.granted_at,
      revoked_at = excluded.revoked_at;

insert into managed_service_access_token(
  lookup_digest,
  key_id,
  fingerprint,
  credential_id,
  managed_service_id,
  audience,
  scope_names,
  issued_at,
  expires_at,
  revoked_at,
  last_used_at,
  credential_revocation_epoch,
  service_revocation_epoch
)
select
  at.lookup_digest,
  at.key_id,
  at.fingerprint,
  at.credential_id,
  managed.id,
  at.audience,
  array['mcp.invoke']::text[],
  at.issued_at,
  at.expires_at,
  at.revoked_at,
  at.last_used_at,
  at.credential_revocation_epoch,
  at.server_revocation_epoch
from access_token at
join managed_service managed
  on managed.legacy_mcp_server_id = at.server_id
on conflict (lookup_digest) do update
  set credential_id = excluded.credential_id,
      managed_service_id = excluded.managed_service_id,
      audience = excluded.audience,
      scope_names = excluded.scope_names,
      issued_at = excluded.issued_at,
      expires_at = excluded.expires_at,
      revoked_at = excluded.revoked_at,
      last_used_at = excluded.last_used_at,
      credential_revocation_epoch = excluded.credential_revocation_epoch,
      service_revocation_epoch = excluded.service_revocation_epoch;

insert into managed_service_runtime_log_event(
  managed_service_id,
  level,
  event_name,
  fields,
  correlation_id,
  created_at
)
select
  managed.id,
  event.level,
  event.event_name,
  event.fields,
  event.correlation_id,
  event.created_at
from runtime_log_event event
join managed_service managed
  on managed.legacy_mcp_server_id = event.server_id
on conflict do nothing;

insert into managed_service_probe_result(
  managed_service_id,
  probe_type,
  status,
  latency_ms,
  evidence,
  correlation_id,
  checked_at
)
select
  managed.id,
  probe.probe_type,
  probe.status,
  probe.latency_ms,
  probe.evidence,
  probe.correlation_id,
  probe.checked_at
from monitoring_probe_result probe
join managed_service managed
  on managed.legacy_mcp_server_id = probe.server_id
on conflict do nothing;

insert into managed_service_usage_event(
  managed_service_id,
  credential_id,
  scope_name,
  request_digest,
  response_digest,
  outcome,
  latency_ms,
  classification,
  correlation_id,
  created_at
)
select
  managed.id,
  invocation.credential_id,
  'mcp.invoke',
  invocation.request_digest,
  invocation.response_digest,
  invocation.status,
  invocation.latency_ms,
  invocation.error_class,
  invocation.correlation_id,
  invocation.accepted_at
from mcp_invocation invocation
join managed_service managed
  on managed.legacy_mcp_server_id = invocation.server_id
on conflict do nothing;
