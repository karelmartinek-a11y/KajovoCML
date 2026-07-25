-- Successful E2E evidence is cryptographically bound to the active component
-- revision and runtime digests. It is invalidated by a revision/runtime change,
-- not by elapsed wall-clock time. A post-handoff component cannot safely replay
-- onboarding-only scenarios solely to refresh this evidence.
do $$
begin
  -- The pre-production clean baseline may not materialize generic component
  -- tables until component onboarding is enabled. Existing installations do;
  -- keep this forward correction valid for both supported paths.
  if to_regclass('public.component_readiness_gate_evidence') is not null then
    update public.component_readiness_gate_evidence
       set expires_at = null
     where gate_key in (
       'E2E_ALL_SCENARIOS',
       'EACH_TOOL_POSITIVE_CALL',
       'EACH_TOOL_OUTPUT_SCHEMA',
       'EACH_ENDPOINT_VARIANT',
       'EACH_INCOMING_PULSE_VARIANT',
       'EACH_OUTGOING_PULSE_VARIANT',
       'OPERATION_LEASE_ENFORCEMENT',
       'REGISTERED_TO_REGISTERED_DISPATCH'
     )
       and expires_at is not null;
  end if;
end
$$;
