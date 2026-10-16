-- db/031_pricing_s2_closeout.sql
-- S2 close-out, code half (2026-10-16): what the db/025 tables needed to be
-- used. Read by scripts/ingest_prices.ts, lib/pricing/quoteSources.ts and
-- lib/ranking.ts.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. price_sources: what kind of price a source gives and how it is asked
--    (Appendix B2 A1). A quote source is asked live by the chat; a bulk
--    source is pulled by the ingest runner.
alter table price_sources add column if not exists kind text;
alter table price_sources add column if not exists mode text not null default 'bulk';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'price_sources_kind_values') then
    alter table price_sources add constraint price_sources_kind_values
      check (kind is null or kind in ('benchmark', 'cash', 'discount_card', 'manufacturer', 'direct', 'partner'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'price_sources_mode_values') then
    alter table price_sources add constraint price_sources_mode_values check (mode in ('bulk', 'quote'));
  end if;
end $$;
update price_sources set kind = 'benchmark' where name = 'nadac' and kind is null;

-- 2. The ingest natural key now includes the pharmacy, so two pharmacies'
--    prices for the same NDC on the same day are two rows, not one
--    overwriting the other. Built before the old index is dropped.
create unique index if not exists price_points_ingest_natural_pharmacy
  on price_points (price_source_id, drug_id, price_type, ndc, supply_days, unit_count, observed_at, pharmacy_id)
  nulls not distinct;
drop index if exists price_points_ingest_natural;

-- 3. Zip code centroids for pharmacy distance (M05-AC4). Loaded from the
--    Census Bureau ZCTA gazetteer file (public domain) by
--    scripts/load_zip_centroids.ts; the source row records the file year.
create table if not exists zip_centroids (
  zip text primary key check (zip ~ '^\d{5}$'),
  lat double precision not null,
  lng double precision not null,
  source_id uuid references sources(id)
);
alter table zip_centroids enable row level security;
drop policy if exists "zip_centroids authenticated read" on zip_centroids;
create policy "zip_centroids authenticated read" on zip_centroids
  for select to authenticated using (true);
drop policy if exists "zip_centroids service-role all" on zip_centroids;
create policy "zip_centroids service-role all" on zip_centroids
  for all to service_role using (true) with check (true);
grant select on zip_centroids to authenticated;
grant select, insert, update, delete on zip_centroids to service_role;
