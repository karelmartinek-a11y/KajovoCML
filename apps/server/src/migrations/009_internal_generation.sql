-- Breaking PRE_PRODUCTION_TESTING transition from external onboarding to internal generation.
-- docs/SSOT_CURRENT.md is the normative target for this migration.

-- Retire the external handoff product flow without destroying historical/audit data that
-- other read-only views may still reference. No active route or worker creates new legacy
-- onboarding jobs after this migration. Existing integration tokens are revoked fail-closed.
-- Preserve the effective secret scope of components that had already completed the legacy
-- handoff. Specific grants are copied directly; legacy all-secrets grants are deliberately
-- expanded only across secrets that exist at migration time so the breaking transition does
-- not grant future secrets implicitly. The source rows remain for audit only.
INSERT INTO public.secret_grant(secret_id,principal_kind,principal_id,principal_public_id,granted_at,granted_by,metadata,all_secrets)
SELECT secret.id,'COMPONENT',legacy.transferred_component_id,principal.public_id,
       coalesce(legacy.transferred_at,legacy.granted_at),legacy.granted_by,
       jsonb_build_object('migratedFrom','integration_token_secret_grant','legacyGrantId',legacy.id),false
  FROM public.integration_token_secret_grant legacy
  JOIN public.component ON component.id=legacy.transferred_component_id
  JOIN public.principal ON principal.id=component.principal_id
  JOIN public.secret_record secret ON secret.deleted_at IS NULL AND (
       (legacy.all_secrets IS FALSE AND lower(secret.stable_name::text)=lower(legacy.secret_stable_name::text))
       OR legacy.all_secrets IS TRUE
  )
 WHERE legacy.transferred_component_id IS NOT NULL AND legacy.revoked_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.secret_grant direct
      WHERE direct.secret_id=secret.id AND direct.principal_kind='COMPONENT'
        AND direct.principal_id=legacy.transferred_component_id AND direct.revoked_at IS NULL
   );

-- Any historical direct integration-token grant is inert from this release onward. It remains
-- queryable for audit, but the schema disallows a live INTEGRATION_TOKEN secret grant.
UPDATE public.secret_grant
   SET revoked_at=coalesce(revoked_at,now())
 WHERE principal_kind='INTEGRATION_TOKEN' AND revoked_at IS NULL;

UPDATE public.integration_token
   SET revoked_at=coalesce(revoked_at,now()), lock_version=lock_version+1
 WHERE revoked_at IS NULL;

UPDATE public.component_onboarding_job
   SET state='CANCELLED', updated_at=now()
 WHERE state NOT IN ('ACTIVE','CANCELLED','FAILED');

UPDATE public.onboarding_job
   SET state='CANCELLED', archived_at=coalesce(archived_at,now()), updated_at=now()
 WHERE state NOT IN ('ACTIVE','CANCELLED','FAILED');

-- Dashboard creation is registered-component-only from this release onward. Historical
-- PRE_REGISTRATION rows are retired but retained for audit continuity.
UPDATE public.dashboard_visual_node
   SET lifecycle_phase='DELETED', deleted_at=coalesce(deleted_at,now()), updated_at=now(), lock_version=lock_version+1
 WHERE lifecycle_phase='PRE_REGISTRATION' AND deleted_at IS NULL;

-- Internal generation worker is a platform principal and may receive explicit Secret Manager grants.
ALTER TABLE public.secret_grant DROP CONSTRAINT IF EXISTS secret_grant_principal_kind_check;
ALTER TABLE public.secret_grant
  ADD CONSTRAINT secret_grant_principal_kind_check CHECK (
    principal_kind = ANY (ARRAY['KAJA'::text,'COMPONENT'::text,'PLATFORM'::text])
    OR (principal_kind='INTEGRATION_TOKEN' AND revoked_at IS NOT NULL)
  );

ALTER TABLE public.platform_worker_heartbeat DROP CONSTRAINT IF EXISTS platform_worker_heartbeat_worker_kind_check;
ALTER TABLE public.platform_worker_heartbeat
  ADD CONSTRAINT platform_worker_heartbeat_worker_kind_check CHECK (worker_kind = ANY (ARRAY['COMPONENT_CONTROL'::text,'COMPONENT_E2E'::text,'GENERATION'::text]));

CREATE TABLE public.generation_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_admin_id uuid NOT NULL REFERENCES public.admin_account(id) ON DELETE RESTRICT,
  original_prompt text NOT NULL CHECK (char_length(original_prompt) BETWEEN 3 AND 50000),
  state text NOT NULL DEFAULT 'CREATED' CHECK (state = ANY (ARRAY[
    'CREATED','ANALYZING','NEEDS_INPUT','PLAN_READY','IMPLEMENTING','INTEGRATING','VALIDATING',
    'CML_CONFORMANCE','ACTIVATING','COMPLETED','FAILED','BLOCKED','CANCELLED'
  ])),
  plan jsonb,
  result_summary jsonb,
  blocker_summary text,
  workspace_path text,
  revision_point text,
  remediation_attempts integer NOT NULL DEFAULT 0 CHECK (remediation_attempts BETWEEN 0 AND 5),
  lease_owner text,
  lease_until timestamptz,
  last_heartbeat_at timestamptz,
  lock_version bigint NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX generation_job_claim_idx ON public.generation_job(state,updated_at) WHERE state NOT IN ('COMPLETED','FAILED','BLOCKED','CANCELLED');

CREATE TABLE public.generation_job_input (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  input_key text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  input_kind text NOT NULL CHECK (input_kind = ANY (ARRAY['TEXT','URL','EMAIL','PHONE','PASSWORD','API_KEY','SECRET','RULE'])),
  required boolean NOT NULL DEFAULT true,
  secret boolean NOT NULL DEFAULT false,
  stable_secret_name public.citext,
  grant_element_keys text[] NOT NULL DEFAULT '{}'::text[],
  value_json jsonb,
  supplied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,input_key),
  CHECK ((secret IS FALSE) OR stable_secret_name IS NOT NULL),
  CHECK ((secret IS TRUE AND value_json IS NULL) OR secret IS FALSE)
);

CREATE TABLE public.generation_job_event (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  phase text NOT NULL,
  event_type text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_job_event_job_idx ON public.generation_job_event(job_id,id);

CREATE TABLE public.generation_component (
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES public.component(id) ON DELETE RESTRICT,
  element_key text NOT NULL,
  element_kind text NOT NULL CHECK (element_kind = ANY (ARRAY['MCP_SERVER','AI_AGENT'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,element_key),
  UNIQUE(component_id)
);

CREATE TABLE public.component_runtime_identity (
  component_id uuid PRIMARY KEY REFERENCES public.component(id) ON DELETE CASCADE,
  access_token_id uuid NOT NULL REFERENCES public.principal_access_token(id) ON DELETE RESTRICT,
  secret_id uuid NOT NULL REFERENCES public.secret_record(id) ON DELETE RESTRICT,
  stable_secret_name public.citext NOT NULL UNIQUE,
  installed_fingerprint text NOT NULL,
  rotated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.local_component_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES public.component(id) ON DELETE CASCADE,
  revision_id uuid REFERENCES public.component_revision(id) ON DELETE SET NULL,
  release_key text NOT NULL,
  source_digest text NOT NULL,
  release_path text NOT NULL,
  previous_release_id uuid REFERENCES public.local_component_release(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'STAGED' CHECK (state = ANY (ARRAY['STAGED','ACTIVE','SUPERSEDED','ROLLED_BACK','FAILED'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE(component_id,release_key)
);
CREATE UNIQUE INDEX local_component_release_active_idx ON public.local_component_release(component_id) WHERE state='ACTIVE';

ALTER TABLE public.generation_component
  ADD COLUMN release_id uuid REFERENCES public.local_component_release(id) ON DELETE SET NULL;

-- Existing platform worker identity receives OPENAI_API_KEY only when that secret already exists;
-- otherwise the OWNER Generation UI creates it and grants it explicitly before a job starts.
INSERT INTO public.secret_grant(secret_id,principal_kind,principal_id,principal_public_id,all_secrets)
SELECT secret.id,'PLATFORM',identity.principal_id,principal.public_id,false
  FROM public.secret_record secret
  CROSS JOIN public.platform_worker_access_identity identity
  JOIN public.principal ON principal.id=identity.principal_id
 WHERE identity.singleton IS TRUE AND secret.stable_name='OPENAI_API_KEY' AND secret.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.secret_grant grant_row
      WHERE grant_row.secret_id=secret.id AND grant_row.principal_kind='PLATFORM'
        AND grant_row.principal_id=identity.principal_id AND grant_row.revoked_at IS NULL
   );
