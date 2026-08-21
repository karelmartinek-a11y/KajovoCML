-- Forward-only completion of the discussion and automation contracts. 014/015
-- have already been applied in production, therefore this migration preserves
-- their data and tightens the target schema in place.
ALTER TABLE public.generation_job
  ADD COLUMN IF NOT EXISTS client_request_id text,
  ADD COLUMN IF NOT EXISTS discussion_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_spec_job_id uuid,
  ADD COLUMN IF NOT EXISTS approved_spec_job_id uuid,
  ADD COLUMN IF NOT EXISTS event_retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS blocker_code text,
  ADD COLUMN IF NOT EXISTS blocker_origin_state text;
CREATE UNIQUE INDEX IF NOT EXISTS generation_job_owner_request_id_idx
  ON public.generation_job(owner_admin_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE public.generation_job_message
  ADD COLUMN IF NOT EXISTS client_message_id text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS provider_response_id text,
  ADD COLUMN IF NOT EXISTS previous_response_id text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS interrupted_at timestamptz;
ALTER TABLE public.generation_job_message
  DROP CONSTRAINT IF EXISTS generation_job_message_status_check;
ALTER TABLE public.generation_job_message
  ADD CONSTRAINT generation_job_message_status_check CHECK (status = ANY (ARRAY['QUEUED','STREAMING','COMPLETED','INTERRUPTED','FAILED']));
CREATE UNIQUE INDEX IF NOT EXISTS generation_job_message_client_id_idx
  ON public.generation_job_message(job_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE public.generation_discussion_turn
  ADD COLUMN IF NOT EXISTS interrupt_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS interrupted_at timestamptz,
  ADD COLUMN IF NOT EXISTS previous_response_id text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE public.generation_discussion_turn
  DROP CONSTRAINT IF EXISTS generation_discussion_turn_status_check;
ALTER TABLE public.generation_discussion_turn
  ADD CONSTRAINT generation_discussion_turn_status_check CHECK (status = ANY (ARRAY['QUEUED','RUNNING','INTERRUPT_REQUESTED','COMPLETED','INTERRUPTED','FAILED','CANCELLED']));
ALTER TABLE public.generation_discussion_turn
  ADD CONSTRAINT generation_discussion_turn_job_id_id_key UNIQUE(job_id,id);
DROP INDEX IF EXISTS public.generation_discussion_active_turn_idx;
CREATE UNIQUE INDEX generation_discussion_running_turn_idx
  ON public.generation_discussion_turn(job_id)
  WHERE status IN ('QUEUED','RUNNING');

ALTER TABLE public.generation_spec_revision
  ADD COLUMN IF NOT EXISTS rendered_markdown text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_job_id uuid;
UPDATE public.generation_spec_revision SET source_job_id=job_id WHERE source_job_id IS NULL;
ALTER TABLE public.generation_spec_revision ALTER COLUMN source_job_id SET NOT NULL;
ALTER TABLE public.generation_spec_revision DROP CONSTRAINT IF EXISTS generation_spec_revision_job_id_digest_key;
ALTER TABLE public.generation_spec_revision ADD CONSTRAINT generation_spec_revision_job_id_id_key UNIQUE(job_id,id);
ALTER TABLE public.generation_spec_revision ADD CONSTRAINT generation_spec_revision_source_turn_same_job_fk
  FOREIGN KEY (source_job_id,source_turn_id) REFERENCES public.generation_discussion_turn(job_id,id) DEFERRABLE INITIALLY DEFERRED;

UPDATE public.generation_job SET current_spec_job_id=id WHERE current_spec_revision_id IS NOT NULL AND current_spec_job_id IS NULL;
UPDATE public.generation_job SET approved_spec_job_id=id WHERE approved_spec_revision_id IS NOT NULL AND approved_spec_job_id IS NULL;
ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_current_spec_same_job_check CHECK (current_spec_revision_id IS NULL OR current_spec_job_id=id),
  ADD CONSTRAINT generation_job_approved_spec_same_job_check CHECK (approved_spec_revision_id IS NULL OR approved_spec_job_id=id),
  ADD CONSTRAINT generation_job_current_spec_same_job_fk FOREIGN KEY (current_spec_job_id,current_spec_revision_id) REFERENCES public.generation_spec_revision(job_id,id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT generation_job_approved_spec_same_job_fk FOREIGN KEY (approved_spec_job_id,approved_spec_revision_id) REFERENCES public.generation_spec_revision(job_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS public.generation_external_operation_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  owner_instruction_message_id uuid NOT NULL REFERENCES public.generation_job_message(id) ON DELETE RESTRICT,
  purpose text NOT NULL, allowed_origins text[] NOT NULL, allowed_operations text[] NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','CONSUMED')),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.generation_irreversible_action_confirmation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  scope_id uuid REFERENCES public.generation_external_operation_scope(id) ON DELETE RESTRICT,
  action_digest text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','USED','EXPIRED','REVOKED')),
  confirmed_at timestamptz, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,action_digest)
);
CREATE TABLE IF NOT EXISTS public.generation_browser_teaching_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.generation_browser_teaching_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), teaching_run_id uuid NOT NULL REFERENCES public.generation_browser_teaching_run(id) ON DELETE CASCADE,
  sequence integer NOT NULL, action text NOT NULL, locator jsonb, observed_state jsonb, evidence_ref text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(teaching_run_id,sequence)
);

ALTER TABLE public.browser_automation_definition
  ADD COLUMN IF NOT EXISTS stable_key text,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_code text;
UPDATE public.browser_automation_definition SET stable_key=code WHERE stable_key IS NULL;
ALTER TABLE public.browser_automation_definition ALTER COLUMN stable_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_definition_stable_key_idx ON public.browser_automation_definition(stable_key);
ALTER TABLE public.browser_automation_revision
  ADD COLUMN IF NOT EXISTS source_generation_job_id uuid REFERENCES public.generation_job(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_spec_revision_id uuid REFERENCES public.generation_spec_revision(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','PASS','FAIL'));
ALTER TABLE public.browser_automation_run
  ADD COLUMN IF NOT EXISTS caller_principal_id uuid REFERENCES public.principal(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'ASYNC' CHECK (execution_mode IN ('SYNC','ASYNC')),
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_step integer,
  ADD COLUMN IF NOT EXISTS safe_error jsonb;
ALTER TABLE public.browser_automation_run DROP CONSTRAINT IF EXISTS browser_automation_run_definition_id_idempotency_key_key;
CREATE UNIQUE INDEX browser_automation_run_caller_idempotency_idx
  ON public.browser_automation_run(definition_id,caller_principal_id,idempotency_key)
  WHERE caller_principal_id IS NOT NULL;
