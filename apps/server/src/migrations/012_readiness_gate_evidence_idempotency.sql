-- Production installations created before the canonical generation migration
-- may carry a legacy three-column readiness uniqueness constraint. Keep the
-- latest measurement for every idempotency key, then make correlation ID part
-- of the enforced key used by all current writers.
DO $$
BEGIN
  IF to_regclass('public.component_readiness_gate_evidence') IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.component_readiness_gate_evidence older
  USING public.component_readiness_gate_evidence newer
  WHERE older.component_id = newer.component_id
    AND older.revision_id = newer.revision_id
    AND older.gate_key = newer.gate_key
    AND older.correlation_id = newer.correlation_id
    AND (older.executed_at, older.id) < (newer.executed_at, newer.id);

  ALTER TABLE public.component_readiness_gate_evidence
    DROP CONSTRAINT IF EXISTS component_readiness_gate_evid_component_id_revision_id_gate_key;
  ALTER TABLE public.component_readiness_gate_evidence
    DROP CONSTRAINT IF EXISTS component_readiness_gate_evid_component_id_revision_id_gate;
  ALTER TABLE public.component_readiness_gate_evidence
    ADD CONSTRAINT component_readiness_gate_evid_component_id_revision_id_gate_key
      UNIQUE (component_id, revision_id, gate_key, correlation_id);
END $$;
