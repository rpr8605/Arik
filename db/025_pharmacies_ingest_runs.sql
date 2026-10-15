-- db/025_pharmacies_ingest_runs.sql
-- S2 close-out (2026-10-05): pharmacy registry (M06-AC3), per-run ingest
-- audit (M06-AC6), discount-card processor field for duplicate collapse
-- (M05-AC6), source admin audit for disable/purge (M07-AC5).
-- Applies to: local dev + Supabase project. Idempotent: yes.

-- 1. Pharmacies. NPI/NCPDP are the match keys adapters carry on records.
create table if not exists pharmacies (
  id uuid primary key default gen_random_uuid(),
  npi text unique,                  -- National Provider Identifier (10 digits)
  ncpdp text,                       -- NCPDP provider id
  name text,
  address text,
  zip text,
  lat double precision,
  lng double precision,
  chain text,
  created_at timestamptz default now()
);
alter table price_points add column if not exists pharmacy_id uuid references pharmacies(id);

-- 2. One audit row per ingest run. Counts only - never price values.
create table if not exists ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references price_sources(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'failed', 'skipped_disabled', 'dry_run')),
  rows_read int,
  rows_accepted int,
  rows_upserted int,
  rows_rejected int,
  error_summary text                -- reason -> count map; no prices, no payloads
);

-- 3. Discount-card duplicate collapse key (BLUE_BUTTON_AND_DISCOUNT_GRAPH.md:
-- cards sharing an underlying processor/BIN-PCN are the same network).
alter table exploits add column if not exists underlying_processor text;

-- 4. Kill-switch / purge audit trail (M07-AC5).
create table if not exists source_admin_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references price_sources(id),
  action text not null check (action in ('disable', 'enable', 'purge')),
  detail jsonb,                     -- e.g. { rows_deleted: n }; no price values
  created_at timestamptz default now()
);

-- RLS: pharmacies is reference data (authenticated read); ingest_runs and
-- source_admin_events are internals (service-role only).
alter table pharmacies enable row level security;
drop policy if exists "pharmacies authenticated read" on pharmacies;
create policy "pharmacies authenticated read" on pharmacies
  for select to authenticated using (true);
drop policy if exists "pharmacies service-role all" on pharmacies;
create policy "pharmacies service-role all" on pharmacies
  for all to service_role using (true) with check (true);

alter table ingest_runs enable row level security;
drop policy if exists "ingest_runs service-role all" on ingest_runs;
create policy "ingest_runs service-role all" on ingest_runs
  for all to service_role using (true) with check (true);

alter table source_admin_events enable row level security;
drop policy if exists "source_admin_events service-role all" on source_admin_events;
create policy "source_admin_events service-role all" on source_admin_events
  for all to service_role using (true) with check (true);

grant select on pharmacies to authenticated;
grant select, insert, update, delete on pharmacies, ingest_runs, source_admin_events to service_role;
