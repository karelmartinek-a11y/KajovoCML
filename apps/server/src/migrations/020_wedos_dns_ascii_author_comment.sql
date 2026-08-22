-- WEDOS rejects punctuation in author_comment on the production account.
-- Keep both historical marker forms readable, but make all new ledger rows
-- use an ASCII-alphanumeric marker that WEDOS accepts consistently.
ALTER TABLE public.wedos_dns_operation
  DROP CONSTRAINT IF EXISTS wedos_dns_operation_author_comment_check;

ALTER TABLE public.wedos_dns_operation
  ADD CONSTRAINT wedos_dns_operation_author_comment_check
  CHECK (
    author_comment ~ '^kcml-(acme|wapi-test)(-|:)[0-9a-f-]{36}$'
    OR author_comment ~ '^kcml(acme|wapitest)[0-9a-f]{32}$'
  );
