-- 007: Feature B - language preference (UNIVERSAL_ACCESS.md) + the
-- consent ledger (SECURITY.md requirement cited by DATA_RETENTION.md;
-- closes the "consent ledger gap" known open item in HANDOFF.md).
-- Apply AFTER 006. Idempotent, same pattern as 006.
--
-- Launch scope: preferred_language accepts 'en'/'es' only, enforced at
-- the application layer (UNIVERSAL_ACCESS.md itself cautions non-English
-- extraction quality is unvalidated - this is a launch-scope decision,
-- not a technical limitation).

alter table user_matching_profile
  add column if not exists preferred_language text default 'en';

create table if not exists consent_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  category text not null,
  action text not null,
  detail jsonb,
  created_at timestamptz default now()
);

-- RLS: the ledger is an audit trail - the owner reads their own history;
-- ALL writes go through the service role (no authenticated write policy,
-- so a patient cannot rewrite or delete their own ledger).
alter table consent_ledger enable row level security;
drop policy if exists "own read" on consent_ledger;
create policy "own read" on consent_ledger for select to authenticated
  using ((select auth.uid()) = user_id);
