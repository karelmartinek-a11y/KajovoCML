-- Persistent generation discussion, immutable specification revisions and SSE log.
ALTER TABLE public.generation_job
  DROP CONSTRAINT IF EXISTS generation_job_state_check;
ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_state_check CHECK (state = ANY (ARRAY[
    'DISCUSSING','CREATED','ANALYZING','NEEDS_INPUT','PLAN_READY','IMPLEMENTING','INTEGRATING',
    'VALIDATING','CML_CONFORMANCE','ACTIVATING','COMPLETED','FAILED','BLOCKED','CANCELLED'
  ]));

ALTER TABLE public.generation_job
  ADD COLUMN IF NOT EXISTS discussion_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_spec_revision_id uuid,
  ADD COLUMN IF NOT EXISTS approved_spec_revision_id uuid,
  ADD COLUMN IF NOT EXISTS approved_spec_digest text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

CREATE TABLE public.generation_job_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  role text NOT NULL CHECK (role = ANY (ARRAY['OWNER','ASSISTANT','SYSTEM'])),
  status text NOT NULL DEFAULT 'COMPLETED' CHECK (status = ANY (ARRAY['STREAMING','COMPLETED','INTERRUPTED','FAILED'])),
  content text NOT NULL CHECK (char_length(content) <= 200000),
  turn_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence),
  UNIQUE(job_id, idempotency_key)
);
CREATE INDEX generation_job_message_order_idx ON public.generation_job_message(job_id, sequence);

CREATE TABLE public.generation_discussion_turn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  input_message_id uuid NOT NULL REFERENCES public.generation_job_message(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status = ANY (ARRAY['QUEUED','RUNNING','COMPLETED','INTERRUPTED','FAILED','CANCELLED'])),
  lease_owner text,
  lease_until timestamptz,
  provider_response_id text,
  error_code text,
  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX generation_discussion_active_turn_idx
  ON public.generation_discussion_turn(job_id)
  WHERE status IN ('QUEUED','RUNNING');

CREATE TABLE public.generation_spec_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  spec jsonb NOT NULL,
  canonical_json text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  source_turn_id uuid REFERENCES public.generation_discussion_turn(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, revision),
  UNIQUE(job_id, digest)
);
CREATE UNIQUE INDEX generation_spec_current_job_idx ON public.generation_spec_revision(job_id, id);
ALTER TABLE public.generation_job
  ADD CONSTRAINT generation_job_current_spec_fk FOREIGN KEY (current_spec_revision_id) REFERENCES public.generation_spec_revision(id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_job_approved_spec_fk FOREIGN KEY (approved_spec_revision_id) REFERENCES public.generation_spec_revision(id) ON DELETE RESTRICT;

CREATE TABLE public.generation_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.generation_job(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence)
);
CREATE INDEX generation_event_replay_idx ON public.generation_event(job_id, sequence);
