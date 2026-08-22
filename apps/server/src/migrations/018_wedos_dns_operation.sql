-- Durable ownership ledger for WEDOS DNS-01 operations. Challenge values are
-- deliberately represented only by their SHA-256 digest.
CREATE TABLE public.wedos_dns_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'WEDOS_WAPI' CHECK (provider='WEDOS_WAPI'),
  purpose text NOT NULL CHECK (purpose IN ('ACME','PREFLIGHT_TEST')),
  correlation_id uuid NOT NULL UNIQUE,
  zone text NOT NULL CHECK (zone ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$'),
  record_name text NOT NULL CHECK (record_name ~ '^[a-z0-9_-]+([.][a-z0-9_-]+)*$'),
  record_type text NOT NULL DEFAULT 'TXT' CHECK (record_type='TXT'),
  value_digest text NOT NULL CHECK (value_digest ~ '^sha256:[0-9a-f]{64}$'),
  author_comment text NOT NULL UNIQUE CHECK (author_comment ~ '^kcml-(acme|wapi-test):[0-9a-f-]{36}$'),
  wedos_row_id text,
  state text NOT NULL DEFAULT 'CREATED' CHECK (state IN ('CREATED','ROW_ADDED','COMMITTED','PROPAGATED','CLEANUP_REQUESTED','DELETED','CLEANUP_PROPAGATED','FAILED','BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  propagated_at timestamptz,
  cleanup_requested_at timestamptz,
  deleted_at timestamptz,
  cleanup_propagated_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_safe_error_code text,
  UNIQUE(provider, zone, author_comment)
);

CREATE INDEX wedos_dns_operation_active_idx
  ON public.wedos_dns_operation(provider, zone, state, created_at)
  WHERE state NOT IN ('CLEANUP_PROPAGATED','FAILED','BLOCKED');

CREATE INDEX wedos_dns_operation_row_idx
  ON public.wedos_dns_operation(provider, wedos_row_id)
  WHERE wedos_row_id IS NOT NULL;
