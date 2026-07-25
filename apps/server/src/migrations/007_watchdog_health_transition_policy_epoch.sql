-- A watchdog health transition fails closed at authorization time because the
-- component state is checked on every call.  It must not also invalidate the
-- policy epoch of a control callback that is still reporting its result.
-- Administrative and lifecycle changes continue to advance the epoch.
CREATE OR REPLACE FUNCTION public.component_policy_epoch_sync() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if coalesce(current_setting('kcml.watchdog_health_transition', true), 'false') <> 'true'
     and (new.enabled, new.ingress_enabled, new.pulse_enabled, new.egress_enabled, new.activation_state,
          new.operational_state, new.monitoring_state, new.lifecycle_state)
         is distinct from
         (old.enabled, old.ingress_enabled, old.pulse_enabled, old.egress_enabled, old.activation_state,
          old.operational_state, old.monitoring_state, old.lifecycle_state) then
    new.policy_epoch := old.policy_epoch + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
