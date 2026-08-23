-- Forward-only readiness coverage for the canonical Browser Automation worker.
-- The worker remains a service identity backed by the existing platform worker
-- heartbeat table; this does not create a second queue or component registry.
ALTER TABLE public.platform_worker_heartbeat
  DROP CONSTRAINT IF EXISTS platform_worker_heartbeat_worker_kind_check;

ALTER TABLE public.platform_worker_heartbeat
  ADD CONSTRAINT platform_worker_heartbeat_worker_kind_check CHECK (
    worker_kind = ANY (ARRAY[
      'COMPONENT_CONTROL'::text,
      'COMPONENT_E2E'::text,
      'GENERATION'::text,
      'BROWSER_AUTOMATION'::text
    ])
  );
