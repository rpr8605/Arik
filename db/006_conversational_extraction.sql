-- 006: Feature A - conversational entity extraction
-- (CONVERSATIONAL_ENTITY_EXTRACTION.md). Apply AFTER 005. Idempotent: on a
-- fresh project these tables/columns already exist via schema.sql and this
-- file is a no-op; on an existing project it applies the delta.
--
-- - cases.institution_name + user_matching_profile.insurance_plan_name /
--   state_or_location_raw: durable homes for facts extracted in passing.
-- - pending_case_facts: staging for case-scoped facts extracted pre-case;
--   migrated into the case at creation time, then deleted.
-- - pending_fact_corrections: the don't-silently-overwrite rule. A new
--   extraction that contradicts a stored value waits here for one-tap
--   patient confirmation; the old value keeps being used until then.

alter table cases add column if not exists institution_name text;
alter table user_matching_profile add column if not exists insurance_plan_name text;
alter table user_matching_profile add column if not exists state_or_location_raw text;

create table if not exists pending_case_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  fact_type text not null,
  fact_value text not null,
  created_at timestamptz default now()
);

create table if not exists pending_fact_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),
  target_table text not null,
  target_id uuid not null,
  field text not null,
  old_value text,
  new_value text not null,
  status text default 'pending',
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- RLS (every public table, no exceptions). Both are owner-only: written by
-- the service role in the chat pipeline, read/resolved by the owner via
-- the API. No caregiver path: these are pre-confirmation working rows, not
-- shared case data.
alter table pending_case_facts enable row level security;
drop policy if exists "own" on pending_case_facts;
create policy "own" on pending_case_facts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table pending_fact_corrections enable row level security;
drop policy if exists "own" on pending_fact_corrections;
create policy "own" on pending_fact_corrections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
