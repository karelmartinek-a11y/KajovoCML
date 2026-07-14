create table if not exists admin_recovery_code (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references admin_account(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists admin_recovery_code_account_idx
  on admin_recovery_code(account_id, created_at desc);
