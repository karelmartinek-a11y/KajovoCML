-- PRE_PRODUCTION_TESTING completion for post-deploy integration and generalized canonical HTTPS egress.
-- This extends existing generation/permission/Secret Manager mechanisms only.
ALTER TABLE public.component_external_permission
  ADD COLUMN allowed_methods text[] NOT NULL DEFAULT ARRAY['POST']::text[];

ALTER TABLE public.component_external_permission
  ADD CONSTRAINT component_external_permission_allowed_methods_check
  CHECK (
    cardinality(allowed_methods) > 0
    AND allowed_methods <@ ARRAY['GET','POST','PUT','PATCH','DELETE','HEAD']::text[]
  );

ALTER TABLE public.generation_job
  ADD COLUMN resume_state text,
  ADD COLUMN integration_plan jsonb,
  ADD CONSTRAINT generation_job_resume_state_check
  CHECK (resume_state IS NULL OR resume_state = ANY (ARRAY['IMPLEMENTING'::text,'INTEGRATING'::text]));
