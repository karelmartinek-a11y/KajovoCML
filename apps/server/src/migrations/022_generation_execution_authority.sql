-- Forward-only execution authority for CREATE, technical retry, repair and remediation.
-- Functional execution is never authorized by original_prompt or diagnostic prose.
ALTER TABLE public.generation_job
  ADD COLUMN IF NOT EXISTS authority_kind text,
  ADD COLUMN IF NOT EXISTS authority_source_job_id uuid,
  ADD COLUMN IF NOT EXISTS authority_source_spec_revision_id uuid,
  ADD COLUMN IF NOT EXISTS authority_spec_digest text;

ALTER TABLE public.generation_discussion_turn
  ADD COLUMN IF NOT EXISTS lease_token uuid;

CREATE INDEX IF NOT EXISTS generation_discussion_lease_recovery_idx
  ON public.generation_discussion_turn(lease_until)
  WHERE status IN ('RUNNING','INTERRUPT_REQUESTED');

-- Existing approved jobs are preserved as OWNER-approved authority. Their immutable
-- specification rows and digests are not rewritten.
UPDATE public.generation_job
   SET authority_kind='OWNER_APPROVED',
       authority_source_job_id=id,
       authority_source_spec_revision_id=approved_spec_revision_id,
       authority_spec_digest=approved_spec_digest
 WHERE approved_spec_revision_id IS NOT NULL
   AND authority_kind IS NULL;

ALTER TABLE public.generation_job
  DROP CONSTRAINT IF EXISTS generation_job_authority_kind_check,
  DROP CONSTRAINT IF EXISTS generation_job_authority_fields_check,
  DROP CONSTRAINT IF EXISTS generation_job_authority_digest_check,
  DROP CONSTRAINT IF EXISTS generation_job_authority_source_spec_fk;

ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_authority_kind_check
    CHECK (authority_kind IS NULL OR authority_kind IN ('OWNER_APPROVED','INHERITED_TECHNICAL')),
  ADD CONSTRAINT generation_job_authority_fields_check
    CHECK (
      (authority_kind IS NULL AND authority_source_job_id IS NULL AND authority_source_spec_revision_id IS NULL AND authority_spec_digest IS NULL)
      OR
      (authority_kind IS NOT NULL AND authority_source_job_id IS NOT NULL AND authority_source_spec_revision_id IS NOT NULL AND authority_spec_digest IS NOT NULL)
    ),
  ADD CONSTRAINT generation_job_authority_digest_check
    CHECK (authority_spec_digest IS NULL OR authority_spec_digest ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT generation_job_authority_source_spec_fk
    FOREIGN KEY (authority_source_job_id,authority_source_spec_revision_id)
    REFERENCES public.generation_spec_revision(job_id,id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS generation_job_authority_source_idx
  ON public.generation_job(authority_source_job_id,authority_source_spec_revision_id);
