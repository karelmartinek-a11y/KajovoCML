-- PRE_PRODUCTION_TESTING corrective migration for internal generation.
-- Adds external webhook endpoint verification metadata and repair-job provenance without
-- introducing a second security, monitoring, permission, secret, or audit control plane.

ALTER TABLE public.component_endpoint_contract
  ADD COLUMN auth_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing external gateway remains the only outbound control plane. Generated permissions
-- can select provider authentication backed by the canonical Secret Manager.
ALTER TABLE public.component_external_permission
  ADD COLUMN auth_config jsonb NOT NULL DEFAULT '{"mode":"FORWARD_KCML_BEARER"}'::jsonb;

ALTER TABLE public.generation_job
  ADD COLUMN job_kind text NOT NULL DEFAULT 'CREATE'
    CHECK (job_kind = ANY (ARRAY['CREATE'::text,'REPAIR'::text])),
  ADD COLUMN repair_component_id uuid REFERENCES public.component(id) ON DELETE SET NULL,
  ADD COLUMN repair_evidence jsonb,
  ADD COLUMN repair_base_release_id uuid REFERENCES public.local_component_release(id) ON DELETE SET NULL,
  ADD COLUMN repair_trigger_key text,
  ADD COLUMN repair_cooldown_until timestamptz;

CREATE UNIQUE INDEX generation_job_active_repair_component_idx
  ON public.generation_job(repair_component_id)
  WHERE job_kind='REPAIR' AND state NOT IN ('COMPLETED','FAILED','BLOCKED','CANCELLED') AND repair_component_id IS NOT NULL;

ALTER TABLE public.local_component_release
  ADD COLUMN generation_job_id uuid REFERENCES public.generation_job(id) ON DELETE SET NULL,
  ADD COLUMN conformance_passed_at timestamptz;

-- A generated component may participate in its original CREATE job and any number of
-- subsequent REPAIR jobs. The job/element key remains unique; component identity stays stable.
ALTER TABLE public.generation_component DROP CONSTRAINT IF EXISTS generation_component_component_id_key;
CREATE INDEX generation_component_component_idx ON public.generation_component(component_id,created_at DESC);

-- The single INTERNAL_GENERATED runtime identity is a source identity, not a target-bound
-- handoff token. Existing permissions remain the authority for every destination route/scope.
UPDATE public.principal_access_token token
   SET target_component_id=null,
       audience='*'
  FROM public.component_runtime_identity identity
  JOIN public.component generated_component ON generated_component.id=identity.component_id
 WHERE identity.access_token_id=token.id
   AND generated_component.registration_type='INTERNAL_GENERATED';

-- INTERNAL_GENERATED components participate in the same platform watchdog/heartbeat lifecycle.
-- No data rewrite is needed: existing monitoring and heartbeat tables are canonical.
-- Undeclared conformance capabilities are represented explicitly. They must never be
-- persisted as synthetic PASS evidence. Activation accepts PASS or NOT_APPLICABLE; a
-- declared capability without current measured evidence remains FAIL.
ALTER TABLE public.component_readiness_gate_evidence
  DROP CONSTRAINT IF EXISTS component_readiness_gate_evidence_status_check;
ALTER TABLE public.component_readiness_gate_evidence
  ADD CONSTRAINT component_readiness_gate_evidence_status_check
  CHECK (status = ANY (ARRAY['PASS'::text,'FAIL'::text,'NOT_APPLICABLE'::text]));

CREATE OR REPLACE VIEW public.component_current_readiness AS
 SELECT c.id AS component_id,
    c.active_revision_id,
    COALESCE(bool_and(((g.status = ANY (ARRAY['PASS'::text,'NOT_APPLICABLE'::text])) AND ((g.expires_at IS NULL) OR (g.expires_at > now())))), false) AS ready
   FROM (public.component c
     LEFT JOIN LATERAL ( SELECT DISTINCT ON (public.component_readiness_gate_evidence.gate_key) public.component_readiness_gate_evidence.gate_key,
            public.component_readiness_gate_evidence.status,
            public.component_readiness_gate_evidence.expires_at
           FROM public.component_readiness_gate_evidence
          WHERE ((public.component_readiness_gate_evidence.component_id = c.id) AND (public.component_readiness_gate_evidence.revision_id = c.active_revision_id))
          ORDER BY public.component_readiness_gate_evidence.gate_key, public.component_readiness_gate_evidence.executed_at DESC) g ON (true))
  GROUP BY c.id, c.active_revision_id;
