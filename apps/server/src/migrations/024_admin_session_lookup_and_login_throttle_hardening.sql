update admin_session
   set revoked_at = coalesce(revoked_at, now())
 where lookup_digest is null
   and revoked_at is null;
