-- Linked OWNER follow-up runs preserve immutable source evidence and the single
-- canonical generated component identity.  No generation data is rewritten.
ALTER TABLE public.generation_job
  ADD COLUMN parent_job_id uuid REFERENCES public.generation_job(id) ON DELETE RESTRICT,
  ADD COLUMN run_sequence integer NOT NULL DEFAULT 1,
  ADD COLUMN operator_prompt text;

ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_run_sequence_check CHECK (run_sequence > 0),
  ADD CONSTRAINT generation_job_operator_prompt_check CHECK (operator_prompt IS NULL OR char_length(operator_prompt) BETWEEN 3 AND 50000);

ALTER TABLE public.generation_job
  DROP CONSTRAINT IF EXISTS generation_job_job_kind_check;
ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_job_kind_check CHECK (job_kind = ANY (ARRAY['CREATE'::text,'REPAIR'::text,'RETRY'::text]));

CREATE UNIQUE INDEX generation_job_parent_run_sequence_idx
  ON public.generation_job(parent_job_id, run_sequence)
  WHERE parent_job_id IS NOT NULL;

DROP INDEX IF EXISTS public.generation_job_active_repair_component_idx;
CREATE UNIQUE INDEX generation_job_active_component_follow_up_idx
  ON public.generation_job(repair_component_id)
  WHERE job_kind = ANY (ARRAY['REPAIR'::text,'RETRY'::text])
    AND state NOT IN ('COMPLETED','FAILED','BLOCKED','CANCELLED')
    AND repair_component_id IS NOT NULL;
