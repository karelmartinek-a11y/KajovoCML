-- Retire the pre-discussion generation lifecycle without rewriting history.
-- Existing rows are preserved as BLOCKED and can be continued through the
-- current OWNER discussion/follow-up flow or input resume path.
UPDATE public.generation_job
   SET state='BLOCKED',
       blocker_code=coalesce(blocker_code,'LEGACY_GENERATION_STATE_RETIRED'),
       blocker_summary=coalesce(blocker_summary,'Legacy generation state was retired; continue through persistent OWNER discussion.'),
       updated_at=now()
 WHERE state IN ('CREATED','PLAN_READY');

UPDATE public.generation_job
   SET state='BLOCKED',
       blocker_code=coalesce(blocker_code,'OWNER_INPUT_REQUIRED'),
       blocker_summary=coalesce(blocker_summary,'OWNER input is required to resume this generation job.'),
       updated_at=now()
 WHERE state='NEEDS_INPUT';

ALTER TABLE public.generation_job
  DROP CONSTRAINT IF EXISTS generation_job_state_check;
ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_state_check CHECK (state = ANY (ARRAY[
    'DISCUSSING','ANALYZING','IMPLEMENTING','INTEGRATING','VALIDATING',
    'CML_CONFORMANCE','ACTIVATING','COMPLETED','FAILED','BLOCKED','CANCELLED'
  ]));
