-- Forward-compatible correction for the WEDOS author_comment alphabet.
-- Migration 018 is immutable. Existing rows using the original colon marker
-- remain readable for recovery/audit, while new operations use the WEDOS-safe
-- hyphen marker emitted by the application.
ALTER TABLE public.wedos_dns_operation
  DROP CONSTRAINT IF EXISTS wedos_dns_operation_author_comment_check;

ALTER TABLE public.wedos_dns_operation
  ADD CONSTRAINT wedos_dns_operation_author_comment_check
  CHECK (author_comment ~ '^kcml-(acme|wapi-test)(-|:)[0-9a-f-]{36}$');
