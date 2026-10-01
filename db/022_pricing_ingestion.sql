-- db/022_pricing_ingestion.sql
-- Source-agnostic pricing ingestion (build ticket 2026-10-01). Adds the
-- source registry every price row hangs off of, the raw-payload staging
-- table, and the price_points columns the ingest runner writes.
-- Applies to: local dev + Supabase project. Idempotent: yes.
--
-- Column-naming note: price_points.source_id already exists and is the
-- CITATION foreign key to sources(id) (schema.sql) - it is not the
-- ingestion source. The ingestion link is therefore price_source_id.

-- 1. Source registry. One row per adapter (lib/pricing/adapters/*).
--    max_staleness_hours: rows older than observed_at + this are excluded
--      from ranking and patient display (null = no age limit).
--    retention_days: hard purge window for this source's rows (null =
--      keep). Enforced by purge_price_ingest_retention() below.
--    allow_patient_display: false = rows may inform internal checks but
--      must never appear in patient-facing output (incl. prompts).
--    allow_ai_processing: false = rows must never be sent to a model
--      provider, even for internal tooling.
create table if not exists price_sources (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,              -- the adapter id, e.g. 'nadac'
  enabled boolean not null default true,
  max_staleness_hours int,
  retention_days int,
  allow_patient_display boolean not null default true,
  allow_ai_processing boolean not null default true,
  notes text,
  created_at timestamptz default now()
);

-- 2. Raw staging: exactly what the source sent, before normalization.
--    Rejected records are kept here with status='rejected' + error -
--    rejections are logged, never silent.
create table if not exists raw_price_ingest (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references price_sources(id),
  payload jsonb not null,
  received_at timestamptz default now(),
  status text not null default 'received'
    check (status in ('received', 'normalized', 'rejected', 'upserted', 'failed')),
  error text,
  source_record_ref text
);

-- 3. price_points additions.
alter table price_points add column if not exists price_source_id uuid references price_sources(id);
alter table price_points add column if not exists ndc text;
alter table price_points add column if not exists observed_at date;
alter table price_points add column if not exists expires_at date;

-- Normalization is enforced at the DB too: an NDC, when present, is
-- always the 11-digit form (lib/pricing/adapter.ts normalizeNdc).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'price_points_ndc_11digit') then
    alter table price_points
      add constraint price_points_ndc_11digit check (ndc is null or ndc ~ '^\d{11}$');
  end if;
end $$;

-- Idempotent ingest: the natural key of a price observation. NULLS NOT
-- DISTINCT keeps legacy rows (null price_source_id/ndc/observed_at)
-- constrained as well; existing seed rows are pairwise distinct on
-- (drug, price_type, supply_days, unit_count), so the index builds
-- cleanly over them.
create unique index if not exists price_points_ingest_natural
  on price_points (price_source_id, drug_id, price_type, ndc, supply_days, unit_count, observed_at)
  nulls not distinct;

-- 4. RLS: same posture as the other reference tables (db/010/012/016/017).
alter table price_sources enable row level security;
drop policy if exists "price_sources authenticated read" on price_sources;
create policy "price_sources authenticated read" on price_sources
  for select to authenticated using (true);
drop policy if exists "price_sources service-role all" on price_sources;
create policy "price_sources service-role all" on price_sources
  for all to service_role using (true) with check (true);

alter table raw_price_ingest enable row level security;
drop policy if exists "raw_price_ingest service-role all" on raw_price_ingest;
create policy "raw_price_ingest service-role all" on raw_price_ingest
  for all to service_role using (true) with check (true);
-- No authenticated read on raw_price_ingest: raw payloads are ingestion
-- internals, not reference data.

grant select on price_sources to authenticated;
grant select, insert, update, delete on price_sources, raw_price_ingest to service_role;

-- 5. Retention purge: hard-deletes rows past their source's window.
--    Runs via pg_cron on Supabase; externally schedulable anywhere else.
create or replace function purge_price_ingest_retention() returns integer
  language plpgsql security definer set search_path = public
as $fn$
declare
  raw_deleted int;
  price_deleted int;
begin
  delete from raw_price_ingest r
  using price_sources s
  where s.id = r.source_id
    and s.retention_days is not null
    and r.received_at < now() - make_interval(days => s.retention_days);
  get diagnostics raw_deleted = row_count;

  delete from price_points p
  using price_sources s
  where s.id = p.price_source_id
    and s.retention_days is not null
    and p.observed_at < (current_date - make_interval(days => s.retention_days));
  get diagnostics price_deleted = row_count;

  return raw_deleted + price_deleted;
end;
$fn$;

-- 6. Schedule where pg_cron exists (Supabase); elsewhere, run
--    select purge_price_ingest_retention() from any external scheduler.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- db/009's idempotent pattern: named unschedule ERRORS on a missing
    -- job (found on real pg_cron, local Supabase 2026-10-01), so guard it.
    perform cron.unschedule('purge-price-ingest-retention')
      where exists (select 1 from cron.job where jobname = 'purge-price-ingest-retention');
    perform cron.schedule('purge-price-ingest-retention', '40 3 * * *',
      $job$select purge_price_ingest_retention();$job$);
  else
    raise notice 'pg_cron not installed; schedule purge_price_ingest_retention() externally';
  end if;
end $$;

-- 7. The first registered source: NADAC (adapter lib/pricing/adapters/nadac.ts).
--    acquisition_benchmark rows are market benchmarks, never patient
--    prices, so patient display is OFF; AI processing stays on for
--    internal tooling (the patient prompt excludes them via the display
--    gate either way - see lib/pricing/enforcement.ts). Staleness bound
--    is a WORKING DEFAULT (90 days): CMS publishes NADAC weekly, so any
--    row older than ~12 weekly cycles is presumed superseded.
insert into price_sources (name, enabled, max_staleness_hours, retention_days, allow_patient_display, allow_ai_processing, notes)
select 'nadac', true, 2160, null, false, true,
       'CMS National Average Drug Acquisition Cost. Benchmark only - never a patient-payable price (see lib/pricing/adapters/nadac.ts header).'
where not exists (select 1 from price_sources where name = 'nadac');
