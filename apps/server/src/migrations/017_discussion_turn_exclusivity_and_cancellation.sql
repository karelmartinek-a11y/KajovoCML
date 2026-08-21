-- Forward-only discussion safety completion.  A steer may retain one queued
-- successor while the prior provider request is being interrupted, but two
-- upstream requests for one job are never permitted.
DROP INDEX IF EXISTS public.generation_discussion_running_turn_idx;

CREATE UNIQUE INDEX generation_discussion_upstream_active_turn_idx
  ON public.generation_discussion_turn(job_id)
  WHERE status IN ('RUNNING','INTERRUPT_REQUESTED');

CREATE UNIQUE INDEX generation_discussion_pending_turn_idx
  ON public.generation_discussion_turn(job_id)
  WHERE status='QUEUED';

CREATE INDEX generation_discussion_claimable_turn_idx
  ON public.generation_discussion_turn(status, created_at)
  WHERE status='QUEUED';
