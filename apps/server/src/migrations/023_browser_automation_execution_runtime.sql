-- Forward-only execution completion for the canonical Browser Automation Runtime.
-- The declarative registry in 015/016 remains the source of truth; this migration
-- only adds fenced worker execution metadata and the terminal states required by
-- the runtime contract.
ALTER TABLE public.browser_automation_run
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.browser_automation_run
  DROP CONSTRAINT IF EXISTS browser_automation_run_status_check;
ALTER TABLE public.browser_automation_run
  ADD CONSTRAINT browser_automation_run_status_check
    CHECK (status = ANY (ARRAY[
      'QUEUED','RUNNING','CANCEL_REQUESTED','SUCCEEDED','FAILED',
      'CANCELLED','CHALLENGE_REQUIRED','MANUAL_REVIEW','DRIFT','REAUTH_REQUIRED'
    ]));

ALTER TABLE public.browser_automation_run_step
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS side_effect_class text,
  ADD COLUMN IF NOT EXISTS safe_observation jsonb;

ALTER TABLE public.browser_automation_run_step
  DROP CONSTRAINT IF EXISTS browser_automation_run_step_status_check;
ALTER TABLE public.browser_automation_run_step
  ADD CONSTRAINT browser_automation_run_step_status_check
    CHECK (status = ANY (ARRAY[
      'PENDING','RUNNING','SUCCEEDED','FAILED','SKIPPED',
      'CHALLENGE_REQUIRED','UNCERTAIN','MANUAL_REVIEW'
    ]));

ALTER TABLE public.browser_automation_definition
  ADD COLUMN IF NOT EXISTS last_preflight_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_preflight_error text;

CREATE INDEX IF NOT EXISTS browser_automation_run_lease_idx
  ON public.browser_automation_run(lease_until)
  WHERE status IN ('RUNNING','CANCEL_REQUESTED');
CREATE INDEX IF NOT EXISTS browser_automation_run_definition_created_idx
  ON public.browser_automation_run(definition_id, created_at desc);

-- 016 replaced the original unique constraint with a caller-scoped index. Keep
-- administrative runs idempotent as well; NULL caller principals are a valid
-- OWNER-only execution boundary and must not create duplicate work under race.
CREATE UNIQUE INDEX IF NOT EXISTS browser_automation_admin_idempotency_idx
  ON public.browser_automation_run(definition_id, idempotency_key)
  WHERE caller_principal_id IS NULL;
