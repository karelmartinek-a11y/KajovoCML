-- Durable control workers claim QUEUED dispatches.  PENDING was a legacy
-- default that left newly-created commands permanently invisible to workers.
alter table public.component_control_dispatch
  alter column state set default 'QUEUED';

update public.component_control_dispatch
   set state = 'QUEUED', updated_at = now()
 where state = 'PENDING'
   and deadline_at > now();
