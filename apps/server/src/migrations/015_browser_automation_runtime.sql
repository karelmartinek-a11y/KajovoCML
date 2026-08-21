-- Declarative browser automation registry and durable run state.
CREATE TABLE public.browser_automation_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]{2,80}$'),
  display_name text NOT NULL,
  owner_component_id uuid REFERENCES public.component(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DISABLED' CHECK (status = ANY (ARRAY['DISABLED','ENABLED','DEGRADED','REAUTH_REQUIRED','REPAIR_REQUIRED'])),
  active_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.browser_automation_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES public.browser_automation_definition(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  manifest jsonb NOT NULL,
  canonical_json text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status = ANY (ARRAY['DRAFT','PREFLIGHTED','ACTIVE','SUPERSEDED','ROLLED_BACK','FAILED'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE(definition_id, revision),
  UNIQUE(definition_id, digest)
);
ALTER TABLE public.browser_automation_definition
  ADD CONSTRAINT browser_automation_active_revision_fk FOREIGN KEY (active_revision_id) REFERENCES public.browser_automation_revision(id) ON DELETE RESTRICT;

CREATE TABLE public.browser_automation_auth_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES public.browser_automation_definition(id) ON DELETE CASCADE,
  stable_secret_name public.citext NOT NULL,
  mode text NOT NULL CHECK (mode = ANY (ARRAY['SECRET_MANAGER','HYBRID','OWNER_CHALLENGE'])),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(definition_id, stable_secret_name)
);

CREATE TABLE public.browser_automation_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES public.browser_automation_definition(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES public.browser_automation_revision(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status = ANY (ARRAY['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','CHALLENGE_REQUIRED','MANUAL_REVIEW','DRIFT','REAUTH_REQUIRED'])),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  error_code text,
  lease_owner text,
  lease_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(definition_id, idempotency_key)
);

CREATE TABLE public.browser_automation_run_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.browser_automation_run(id) ON DELETE CASCADE,
  step_index integer NOT NULL CHECK (step_index >= 0),
  action text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status = ANY (ARRAY['PENDING','RUNNING','SUCCEEDED','FAILED','SKIPPED','MANUAL_REVIEW'])),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(run_id, step_index)
);

CREATE TABLE public.browser_automation_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.browser_automation_run(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = ANY (ARRAY['SCREENSHOT','TRACE','DOWNLOAD','UPLOAD','EVIDENCE'])),
  storage_key text NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  content_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX browser_automation_run_status_idx ON public.browser_automation_run(status, created_at);
