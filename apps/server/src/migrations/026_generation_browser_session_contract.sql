-- Forward-only browser-session contract for generation preparation.
-- The long-lived automation registry remains in 015; these tables are scoped
-- to a single generation job and never act as a second component registry.
CREATE TABLE IF NOT EXISTS public.generation_browser_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  owner_admin_id uuid NOT NULL REFERENCES public.admin_account(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status = ANY (ARRAY['ACTIVE','CLOSED','CHALLENGE_REQUIRED','FAILED'])),
  current_url text,
  current_title text,
  sensitive boolean NOT NULL DEFAULT false,
  frame_revision bigint NOT NULL DEFAULT 0 CHECK (frame_revision >= 0),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id)
);

CREATE TABLE IF NOT EXISTS public.generation_browser_preview_frame (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.generation_browser_session(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  mode text NOT NULL CHECK (mode = ANY (ARRAY['NORMAL','SENSITIVE'])),
  storage_key text,
  content_type text,
  url text,
  title text,
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, revision),
  CHECK ((mode = 'NORMAL' AND storage_key IS NOT NULL AND content_type IS NOT NULL)
      OR (mode = 'SENSITIVE' AND storage_key IS NULL))
);
CREATE INDEX IF NOT EXISTS generation_browser_preview_job_idx
  ON public.generation_browser_preview_frame(job_id, created_at DESC);

ALTER TABLE public.generation_external_operation_scope
  ADD COLUMN IF NOT EXISTS browser_session_id uuid REFERENCES public.generation_browser_session(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS target_account_label text,
  ADD COLUMN IF NOT EXISTS scope_digest text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS generation_external_scope_digest_idx
  ON public.generation_external_operation_scope(job_id, scope_digest)
  WHERE scope_digest IS NOT NULL;

ALTER TABLE public.generation_irreversible_action_confirmation
  ADD COLUMN IF NOT EXISTS browser_session_id uuid REFERENCES public.generation_browser_session(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES public.generation_job_message(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS action_summary text,
  ADD COLUMN IF NOT EXISTS target_origin text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.generation_browser_teaching_run
  ADD COLUMN IF NOT EXISTS source_turn_id uuid REFERENCES public.generation_discussion_turn(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS browser_session_id uuid REFERENCES public.generation_browser_session(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS start_url text,
  ADD COLUMN IF NOT EXISTS allowed_origins_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_code text;

ALTER TABLE public.generation_browser_teaching_step
  ADD COLUMN IF NOT EXISTS semantic_purpose text,
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS input_binding_json jsonb,
  ADD COLUMN IF NOT EXISTS precondition_json jsonb,
  ADD COLUMN IF NOT EXISTS wait_policy_json jsonb,
  ADD COLUMN IF NOT EXISTS postcondition_json jsonb,
  ADD COLUMN IF NOT EXISTS side_effect_class text,
  ADD COLUMN IF NOT EXISTS retry_class text,
  ADD COLUMN IF NOT EXISTS uncertain_result_policy_json jsonb;
