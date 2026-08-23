-- Human authorization is deliberately binary in the product: an authenticated
-- active human account is an OWNER.  Machine principals keep their existing
-- independent kind/status/permission model.
BEGIN;

UPDATE public.admin_account
   SET role = 'OWNER',
       updated_at = now()
 WHERE role IS DISTINCT FROM 'OWNER';

ALTER TABLE public.admin_account
  DROP CONSTRAINT IF EXISTS admin_account_role_check;

ALTER TABLE public.admin_account
  ALTER COLUMN role SET DEFAULT 'OWNER';

ALTER TABLE public.admin_account
  ADD CONSTRAINT admin_account_role_check CHECK (role = 'OWNER');

COMMIT;
