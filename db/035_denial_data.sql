-- db/035_denial_data.sql
-- Free data loaders, Part A (docs/kimi/free_data_loaders.md, 2026-10-16):
-- insurer denial statistics (D1, CMS Transparency in Coverage PUF) and
-- prior authorization metrics (D2, posted by each payer, entered by hand
-- from a CSV template). Registry: docs/research/arik_free_data_sources.md.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. ingest_runs can record non-price datasets: source_id (a price source)
--    becomes optional and `dataset` names what ran. One of the two is set.
alter table ingest_runs add column if not exists dataset text;
alter table ingest_runs alter column source_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingest_runs_source_or_dataset') then
    alter table ingest_runs add constraint ingest_runs_source_or_dataset check (source_id is not null or dataset is not null);
  end if;
end $$;

-- 2. D1: one row per issuer, state and marketplace sheet, for the plan
--    year the data COVERS (the PY2026 file holds plan-year 2024 data).
--    Issuer-level counts as reported; denial-reason counts are plan-level
--    in the file and summed here per issuer. A value the file marks
--    * / ** / *** / N/A is stored as null with its reason in value_flags
--    ({"claims_denied_in": "suppressed", ...}); reasons_partial = some
--    plan's reason count was not a number, so the sums are a floor.
create table if not exists payer_denial_stats (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('individual_qhp', 'individual_sadp', 'shop')),
  state text not null check (state ~ '^[A-Z]{2}$'),
  issuer_id text not null,
  issuer_name text not null,
  plan_year int not null,            -- year the data covers
  file_year int not null,            -- PUF plan year (file)
  claims_received_in bigint,
  claims_received_out bigint,
  claims_denied_in bigint,
  claims_denied_out bigint,
  claims_resubmitted_in bigint,
  claims_resubmitted_out bigint,
  internal_appeals_filed bigint,
  internal_appeals_overturned bigint,
  external_appeals_filed bigint,
  external_appeals_overturned bigint,
  denied_prior_auth bigint,
  denied_out_of_network bigint,
  denied_excluded_service bigint,
  denied_not_medically_necessary bigint,
  denied_not_medically_necessary_bh bigint,
  denied_benefit_limit bigint,
  denied_member_not_covered bigint,
  denied_investigational bigint,
  denied_administrative bigint,
  denied_other bigint,
  plans_count int not null default 0,
  reasons_partial boolean not null default false,
  value_flags jsonb not null default '{}'::jsonb,
  source_id uuid not null references sources(id),
  unique (market, state, issuer_id, plan_year)
);
create index if not exists payer_denial_stats_lookup on payer_denial_stats (state, lower(issuer_name));

-- 3. D2: prior authorization metrics each payer posts (CMS-0057-F).
--    Medical items and services only, not drugs. Entered from the CSV
--    template; numbers exactly as the payer reports them.
create table if not exists prior_auth_metrics (
  id uuid primary key default gen_random_uuid(),
  payer text not null,
  program text not null check (program in ('MA', 'Medicaid', 'CHIP', 'QHP')),
  reporting_level text not null check (reporting_level in ('contract', 'state', 'plan', 'issuer')),
  reporting_unit text,               -- contract/plan/issuer id when the level needs one
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  report_year int not null,          -- the year the report covers
  pct_standard_approved numeric check (pct_standard_approved between 0 and 100),
  pct_standard_denied numeric check (pct_standard_denied between 0 and 100),
  pct_standard_approved_after_appeal numeric check (pct_standard_approved_after_appeal between 0 and 100),
  pct_expedited_approved numeric check (pct_expedited_approved between 0 and 100),
  pct_expedited_denied numeric check (pct_expedited_denied between 0 and 100),
  avg_decision_time numeric check (avg_decision_time >= 0),
  median_decision_time numeric check (median_decision_time >= 0),
  decision_time_unit text,           -- as reported (hours, days, ...)
  source_url text not null,
  retrieved_date date not null,
  captured_by text not null check (captured_by in ('manual', 'auto')),
  source_id uuid not null references sources(id),
  unique (payer, program, reporting_level, reporting_unit, state, report_year)
);

-- RLS: reference data (authenticated read), service role writes.
alter table payer_denial_stats enable row level security;
drop policy if exists "payer_denial_stats authenticated read" on payer_denial_stats;
create policy "payer_denial_stats authenticated read" on payer_denial_stats for select to authenticated using (true);
drop policy if exists "payer_denial_stats service-role all" on payer_denial_stats;
create policy "payer_denial_stats service-role all" on payer_denial_stats for all to service_role using (true) with check (true);
alter table prior_auth_metrics enable row level security;
drop policy if exists "prior_auth_metrics authenticated read" on prior_auth_metrics;
create policy "prior_auth_metrics authenticated read" on prior_auth_metrics for select to authenticated using (true);
drop policy if exists "prior_auth_metrics service-role all" on prior_auth_metrics;
create policy "prior_auth_metrics service-role all" on prior_auth_metrics for all to service_role using (true) with check (true);
grant select on payer_denial_stats, prior_auth_metrics to authenticated;
grant select, insert, update, delete on payer_denial_stats, prior_auth_metrics to service_role;

-- 4. Registry sources (docs/research/arik_free_data_sources.md D1, D2, V1).
--    Loaded rows cite their own dated source (the PUF file, each payer's
--    page); these name the datasets themselves.
insert into sources (source_type, title, url, evidence_grade, retrieved_at, last_verified_at)
select v.t, v.title, v.url, 'A', now(), '2026-10-16'
from (values
  ('cms_data', 'CMS Exchange public use files: Transparency in Coverage PUF (registry D1)', 'https://www.cms.gov/marketplace/resources/data/public-use-files'),
  ('cms_rule', 'CMS Interoperability and Prior Authorization final rule (CMS-0057-F): payer-posted prior authorization metrics (registry D2)', 'https://www.cms.gov/initiatives/burden-reduction/overview/interoperability/frequently-asked-questions/prior-authorization-api/improving-prior-authorization-processes'),
  ('cms_data', 'CMS Medicare Coverage Database downloads: NCDs, LCDs, Articles (registry V1)', 'https://www.cms.gov/medicare-coverage-database/downloads/downloads.aspx')
) as v(t, title, url)
where not exists (select 1 from sources s where s.url = v.url and s.title = v.title);
