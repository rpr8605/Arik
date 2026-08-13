-- db/016_eligibility_screeners.sql
-- Applies the eligibility-screener schema per the owner-reviewed proposal
-- (docs/build-plans/eligibility-screener-schema-proposal-2026-08-12.md,
-- V1+V2). RMA is explicitly deferred (no row, no data); the ephemeral
-- immigration flow stays enforced-by-absence; ADAP and real CHIP seeding
-- are future passes.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. exploits: referral_only + the no-dollar-figure rule at DB level.
alter table exploits
  add column if not exists referral_only boolean not null default false;
-- Hard rule: a referral_only row may never carry a savings figure.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exploits_referral_only_no_dollars') then
    alter table exploits add constraint exploits_referral_only_no_dollars
      check (referral_only = false or estimated_savings_usd is null);
  end if;
end $$;

-- 2. eligibility_programs (reference data): benefits that reprice a whole
-- regimen or reroute the patient to another coverage system — not per-drug.
create table if not exists eligibility_programs (
  id uuid primary key default gen_random_uuid(),
  program_key text unique not null,      -- 'extra_help_lis', 'ihs_health', 'nbccedp', ...
  display_name text not null,
  category text not null check (category in ('regimen_benefit','population_pathway')),
  administering_body text,
  eligibility_rules jsonb,               -- income/asset/age/status gates, machine-readable
  benefit_summary text not null,         -- what it changes, plain language; no dollar figures on referral_only rows
  referral_only boolean not null default false,
  channel_restriction text,              -- e.g. 'ihs_tribal_urban_pharmacy_only'; null = no channel constraint
  screening_data_policy text not null default 'persist_profile'
    check (screening_data_policy in ('persist_profile','ephemeral_only')),
  requires_legal_status_caveat boolean not null default false,
  render_caveat text,
  -- The state-legal caveat is STRUCTURAL: the row cannot exist without it.
  check (requires_legal_status_caveat = false or render_caveat is not null),
  source_id uuid not null references sources(id),  -- Ticket-1 standing rule: NOT NULL on new sourced tables
  last_verified_at timestamptz,
  effective_date date,
  created_at timestamptz default now()
);
alter table eligibility_programs enable row level security;
drop policy if exists "eligibility_programs authenticated read" on eligibility_programs;
create policy "eligibility_programs authenticated read" on eligibility_programs
  for select to authenticated using (true);
drop policy if exists "eligibility_programs service-role all" on eligibility_programs;
create policy "eligibility_programs service-role all" on eligibility_programs
  for all to service_role using (true) with check (true);

-- 3. patient_eligibility_results (user data; mirrors mtm_eligibility_checks).
create table if not exists patient_eligibility_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  program_key text references eligibility_programs(program_key),
  result text not null check (result in ('likely_eligible','likely_not','insufficient_info')),
  basis jsonb,                           -- which profile facts drove the result
  computed_at timestamptz default now()
);
alter table patient_eligibility_results enable row level security;
drop policy if exists "own" on patient_eligibility_results;
create policy "own" on patient_eligibility_results for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 4. Sources rows (URL-guarded).
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'PAN Foundation TotalAssist — fund list with live open/closed status', 'https://totalassist.org/funds/', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://totalassist.org/funds/');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'PAN Foundation TotalAssist — Sickle Cell Disease fund page ($2,800 guaranteed / $5,600 max, 500% FPL COLI-adjusted, government insurance)', 'https://totalassist.org/funds/sickle-cell-disease/', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://totalassist.org/funds/sickle-cell-disease/');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'cms_data', 'IHS patient FAQ — eligibility (tribal enrollment) and pharmacy cost handling (IHS fill = no charge; external = patient pays)', 'https://www.ihs.gov/forpatients/faq/', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.ihs.gov/forpatients/faq/');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'cms_data', 'CDC NBCCEDP screenings page — income <=250% FPL, ages 40-64 breast / 21-64 cervical', 'https://www.cdc.gov/breast-cervical-cancer-screening/about/screenings.html', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.cdc.gov/breast-cervical-cancer-screening/about/screenings.html');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'secondary_research_report', 'Guttmacher Institute — Features and Benefits of the Title X Program (free <=100% FPL, sliding to 250%; all genders; serves undocumented immigrants). Secondary: OPA page extracted too thin to cite directly.', 'https://www.guttmacher.org/fact-sheet/features-and-benefits-title-x-program', 'B', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.guttmacher.org/fact-sheet/features-and-benefits-title-x-program');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'Point of Pride — HRT Access Fund (direct financial assistance for gender-affirming HRT)', 'https://www.pointofpride.org/hrt-access-fund', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.pointofpride.org/hrt-access-fund');

-- 5. Seed: PAN sickle cell fund as an exploits foundation_grant row,
-- status CLOSED (verified 2026-08-12). drug_id null: a disease fund is not
-- tied to one drug; the diagnosis gate lives in eligibility_criteria.
insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, estimated_savings_usd, status, closed_reason, source_id, last_verified_at)
select null, 'foundation_grant',
  'PAN Foundation Sickle Cell Disease Fund (via TotalAssist)',
  'Copay/premium assistance for people with sickle cell disease: $2,800 guaranteed award, $5,600 maximum. Income at or below 500% FPL (COLI-adjusted); requires government insurance (Medicare, Medicaid, or TRICARE). Fund CLOSED as of 2026-08-12 — notification signup available on the fund page.',
  '{"diagnosis_required": "sickle cell disease", "income_fpl_max_pct": 500, "income_coli_adjusted": true, "insurance_requirement": "government", "fund_status": "closed", "fund_status_checked_at": "2026-08-12"}'::jsonb,
  null, 'closed', 'Fund closed per TotalAssist fund list, checked 2026-08-12; reopen notification signup available',
  (select id from sources where url = 'https://totalassist.org/funds/sickle-cell-disease/' limit 1),
  '2026-08-12'
where not exists (select 1 from exploits where exploit_type = 'foundation_grant' and title like 'PAN Foundation Sickle Cell%');

-- 6. Seed: eligibility_programs rows. NO RMA row (deferred). No CHIP row
-- (schema support only; real seeding is a second pass).
insert into eligibility_programs
  (program_key, display_name, category, administering_body, eligibility_rules, benefit_summary, referral_only, channel_restriction, screening_data_policy, requires_legal_status_caveat, render_caveat, source_id, last_verified_at)
select v.program_key, v.display_name, v.category, v.administering_body, v.eligibility_rules::jsonb, v.benefit_summary, v.referral_only, v.channel_restriction, v.screening_data_policy, v.requires_legal_status_caveat, v.render_caveat,
  (select id from sources where url = v.source_url limit 1), '2026-08-12'
from (values
  ('ihs_health', 'Indian Health Service pharmacy benefit', 'population_pathway', 'Indian Health Service (HHS)',
   '{"gate": "tribal_enrollment", "detail": "Enrolled member of a federally recognized tribe (IHM Part 2 Ch. 1 classes); NOT a race/ethnicity self-report", "prc_note": "Purchased/Referred Care is funding-prioritized and PRCDA-residence-limited"}',
   'Medications filled at IHS, tribal, or urban Indian health program pharmacies carry no charge for eligible patients. Fills at outside pharmacies are normally the patient''s own cost.',
   true, 'ihs_tribal_urban_pharmacy_only', 'persist_profile', false, null,
   'https://www.ihs.gov/forpatients/faq/'),
  ('nbccedp', 'National Breast and Cervical Cancer Early Detection Program', 'regimen_benefit', 'CDC / state health departments',
   '{"income_fpl_max_pct": 250, "age_bands": {"breast": [40, 64], "cervical": [21, 64]}, "sex_linked": "women", "insurance": "uninsured_or_underinsured", "exceptions": "some younger/older may qualify", "treatment_path": "state Medicaid BCCTP after program-screened diagnosis"}',
   'Free breast and cervical cancer screening and diagnostic services for women with low income who are uninsured or underinsured; treatment costs route through state Medicaid treatment programs after a program-screened diagnosis.',
   false, null, 'persist_profile', false, null,
   'https://www.cdc.gov/breast-cervical-cancer-screening/about/screenings.html'),
  ('title_x', 'Title X family planning services', 'regimen_benefit', 'HHS Office of Population Affairs grantees',
   '{"income": "free_at_or_below_100pct_fpl_sliding_101_to_250pct", "serves": "all genders; adolescents without parental consent; undocumented immigrants", "note": "secondary source (Guttmacher) - OPA page extraction too thin to cite directly"}',
   'Family planning and related preventive services free at or below 100% FPL and on a sliding scale up to 250% FPL, at Title X clinics, regardless of gender or immigration status.',
   false, null, 'persist_profile', false, null,
   'https://www.guttmacher.org/fact-sheet/features-and-benefits-title-x-program'),
  ('point_of_pride_hrt_fund', 'Point of Pride HRT Access Fund', 'population_pathway', 'Point of Pride (nonprofit)',
   '{"gate": "self_attested_trans_identity_and_financial_need", "identity_data": "opt-in demographic flag only, never required for core pricing", "award": "varies; direct financial assistance for gender-affirming HRT"}',
   'Direct financial assistance for gender-affirming hormone therapy for trans people who cannot afford it. Apply directly to the fund; award amounts vary.',
   true, null, 'persist_profile', true,
   'Gender-affirming care availability and legal status vary significantly by state and are actively changing. Verify what is legal and available in your state before relying on this pathway.',
   'https://www.pointofpride.org/hrt-access-fund')
) as v(program_key, display_name, category, administering_body, eligibility_rules, benefit_summary, referral_only, channel_restriction, screening_data_policy, requires_legal_status_caveat, render_caveat, source_url)
on conflict (program_key) do nothing;
