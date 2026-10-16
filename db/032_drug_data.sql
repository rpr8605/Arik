-- db/032_drug_data.sql
-- Drug data depth, top 200 (docs/kimi/DRUG_DATA_TOP200.md, 2026-10-16).
-- Identity (FDA NDC Directory + RxNorm), the Part D spending list that
-- picks the 200, the NADAC benchmark's pricing unit and as-of date, and a
-- review queue for anything that didn't match cleanly (never guessed).
-- Loaded by scripts/load_drug_data.ts (local database only); the demo gets
-- it through scripts/export_seed.mjs + scripts/apply_remote.mjs.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. Identity on drugs.
alter table drugs add column if not exists generic_name text;
alter table drugs add column if not exists rxcui text;          -- RxNorm concept id (ingredient or brand)

-- 2. The list that picks the 200: CMS Medicare Part D Spending by Drug,
--    ranked by total spending for one data year.
create table if not exists drug_rank_list (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,                 -- 'partd_spending'
  data_year int not null,
  rank int not null check (rank > 0),
  brand_name text not null,               -- as CMS writes it
  generic_name text not null,
  total_spending_usd numeric,             -- Part D gross drug cost that year (not a price)
  drug_id uuid references drugs(id) on delete set null,
  source_id uuid references sources(id),
  unique (list_key, data_year, rank)
);

-- 3. NDC identity from the FDA NDC Directory (package level, 11 digits).
create table if not exists drug_ndcs (
  ndc11 text primary key check (ndc11 ~ '^\d{11}$'),
  drug_id uuid not null references drugs(id) on delete cascade,
  product_ndc text,
  package_description text,
  proprietary_name text,
  nonproprietary_name text,
  strength text,
  dosage_form text,
  route text,
  labeler text,
  marketing_category text,
  marketing_end_date date,
  rxcui text,
  source_id uuid references sources(id)
);
create index if not exists drug_ndcs_drug on drug_ndcs (drug_id);

-- 4. NADAC benchmark fields (CMS NADAC Data Field Definitions, Jan 2021:
--    "Pricing Unit: Indicates the pricing unit for the associated NDC
--    ('ML', 'GM' or 'EA')"). as_of_date = the weekly file the row came from.
alter table price_points add column if not exists pricing_unit text;
alter table price_points add column if not exists as_of_date date;
-- NADAC "Classification for Rate Setting" (same definitions doc): 'B'
-- brand, 'G' generic, 'B-ANDA', 'B-BIO'. Lets a generic's benchmark use
-- generic rows, not the brand's.
alter table price_points add column if not exists rate_class text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'price_points_pricing_unit_values') then
    alter table price_points add constraint price_points_pricing_unit_values
      check (pricing_unit is null or pricing_unit in ('EA', 'ML', 'GM'));
  end if;
end $$;

-- 5. Review queue: names and NDCs that didn't match cleanly. A person
--    resolves them; the loaders never guess.
create table if not exists drug_data_review (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('name_unmatched', 'name_ambiguous', 'ndc_unmatched', 'rxnorm_unmatched')),
  subject text not null,
  detail text,
  source_id uuid references sources(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (kind, subject)
);

-- RLS: identity and the list are reference data (authenticated read);
-- the review queue is internal (service role only).
alter table drug_rank_list enable row level security;
drop policy if exists "drug_rank_list authenticated read" on drug_rank_list;
create policy "drug_rank_list authenticated read" on drug_rank_list for select to authenticated using (true);
drop policy if exists "drug_rank_list service-role all" on drug_rank_list;
create policy "drug_rank_list service-role all" on drug_rank_list for all to service_role using (true) with check (true);

alter table drug_ndcs enable row level security;
drop policy if exists "drug_ndcs authenticated read" on drug_ndcs;
create policy "drug_ndcs authenticated read" on drug_ndcs for select to authenticated using (true);
drop policy if exists "drug_ndcs service-role all" on drug_ndcs;
create policy "drug_ndcs service-role all" on drug_ndcs for all to service_role using (true) with check (true);

alter table drug_data_review enable row level security;
drop policy if exists "drug_data_review service-role all" on drug_data_review;
create policy "drug_data_review service-role all" on drug_data_review for all to service_role using (true) with check (true);

grant select on drug_rank_list, drug_ndcs to authenticated;
grant select, insert, update, delete on drug_rank_list, drug_ndcs, drug_data_review to service_role;
