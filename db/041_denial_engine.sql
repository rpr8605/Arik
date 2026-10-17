-- db/041_denial_engine.sql
-- Phase 5: the denial engine (spec Appendix B4, M11). Rule text:
-- docs/research/denial_rules_verification.md. Code is the source of truth
-- for the rules (lib/rules/denials/rules.ts); the `rules` rows mirror it so
-- every stored check result can be traced to a cited rule and version
-- (scripts/test_denial_rules.ts proves the two match).
-- Reuses: deadlines (one row per computed patient deadline, now linked to
-- its denial and rule), letters (denial letters, same freeze and hash),
-- uploaded_documents (the denial letter or EOB itself).
-- New: denials, denial_codes, rules, appeal_outcomes.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.
-- Deploy order: apply before the code that writes these tables.

create table if not exists denials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  document_id uuid references uploaded_documents(id) on delete set null,
  payer_name text,
  provider_name text,
  plan_funding text not null check (plan_funding in ('fully_insured', 'self_funded', 'marketplace', 'medicare_part_d', 'medicare_advantage', 'medicaid', 'unknown')),
  medicaid_delivery text not null default 'unknown' check (medicaid_delivery in ('managed_care', 'state', 'unknown')),
  denial_category text not null check (denial_category in ('no_reason_given', 'administrative', 'excluded_service', 'no_prior_authorization', 'medical_necessity', 'other')),
  carc_codes text[] not null default '{}',     -- numbers only, never X12 descriptions
  rarc_codes text[] not null default '{}',
  service_or_drug text,
  service_code text,
  is_drug boolean not null default false,
  notice_date date not null,
  date_of_service date,
  request_date date,
  appeal_level text not null default 'initial' check (appeal_level in ('initial', 'internal_appeal')),
  timing text not null default 'post_service' check (timing in ('pre_service', 'post_service', 'payment')),
  is_prior_auth_decision boolean not null default false,
  is_urgent boolean not null default false,
  stated_reason text,
  claim_number text,
  letter_deadline_days int,
  prior_auth jsonb,                            -- an approval the patient has: {reference, serviceCode, validFrom, validTo}
  check_results jsonb,                         -- DenialFlag[] from lib/rules/denials/checks.ts
  rules_version text,
  status text not null default 'confirmed' check (status in ('confirmed', 'appealing', 'won', 'partial', 'lost', 'closed')),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One denial per document (re-confirming replaces it). A plain unique index
-- so upsert's ON CONFLICT (document_id) can use it; nulls never collide.
drop index if exists denials_document;
create unique index if not exists denials_document_key on denials (document_id);
create index if not exists denials_case on denials (case_id);

create table if not exists denial_codes (
  code_set text not null check (code_set in ('CARC', 'RARC')),
  code text not null,
  arik_explanation text,                       -- Arik's own words; never an X12 description
  explanation_status text not null default 'needs_review' check (explanation_status in ('needs_review', 'approved')),
  x12_url text not null default 'https://x12.org/codes',
  primary key (code_set, code)
);

create table if not exists rules (
  rule_id text not null,
  version text not null,
  plan_funding text[] not null,
  description text not null,
  citation text not null,
  citation_url text not null,
  effective_from date,
  effective_to date,
  active boolean not null default true,
  primary key (rule_id, version)
);

create table if not exists appeal_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  denial_id uuid not null references denials(id) on delete cascade,
  appeal_level text not null,
  argument_types text[] not null default '{}',
  submitted_at timestamptz,
  decided_at timestamptz,
  result text not null default 'pending' check (result in ('won', 'partial', 'lost', 'pending', 'withdrawn')),
  notes text,
  created_at timestamptz not null default now()
);

alter table deadlines add column if not exists denial_id uuid references denials(id) on delete cascade;
alter table deadlines add column if not exists rule_id text;
alter table deadlines add column if not exists step text;

alter table letters add column if not exists denial_id uuid references denials(id) on delete set null;
alter table letters drop constraint if exists letters_letter_type_check;
alter table letters add constraint letters_letter_type_check check (letter_type in (
  'itemized_bill_request', 'billing_dispute', 'hold_collections', 'insurer_appeal', 'medical_necessity_request', 'financial_assistance_cover',
  'claim_file_request', 'specific_reason_request', 'external_review_request', 'part_d_exception'));

-- Row security: patient data is owner or caregiver; reference data is read-only.
alter table denials enable row level security;
alter table appeal_outcomes enable row level security;
alter table denial_codes enable row level security;
alter table rules enable row level security;

drop policy if exists "owner or caregiver" on denials;
create policy "owner or caregiver" on denials for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
drop policy if exists "denials service-role all" on denials;
create policy "denials service-role all" on denials for all to service_role using (true) with check (true);

drop policy if exists "owner or caregiver" on appeal_outcomes;
create policy "owner or caregiver" on appeal_outcomes for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
drop policy if exists "appeal_outcomes service-role all" on appeal_outcomes;
create policy "appeal_outcomes service-role all" on appeal_outcomes for all to service_role using (true) with check (true);

drop policy if exists "authenticated read" on denial_codes;
create policy "authenticated read" on denial_codes for select to authenticated using (true);
drop policy if exists "denial_codes service-role all" on denial_codes;
create policy "denial_codes service-role all" on denial_codes for all to service_role using (true) with check (true);

drop policy if exists "authenticated read" on rules;
create policy "authenticated read" on rules for select to authenticated using (true);
drop policy if exists "rules service-role all" on rules;
create policy "rules service-role all" on rules for all to service_role using (true) with check (true);

grant select, insert, update, delete on denials, appeal_outcomes to authenticated;
grant select on denial_codes, rules to authenticated;
grant select, insert, update, delete on denials, appeal_outcomes, denial_codes, rules to service_role;

-- The rules registry (mirror of lib/rules/denials/rules.ts DENIAL_RULES, version ecfr-2026-10-15).
insert into rules (rule_id, version, plan_funding, description, citation, citation_url, effective_from) values
  ('aca_internal_appeal_window', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'Internal appeal: at least 180 days after receiving the denial', '29 CFR 2560.503-1(h)(4)(i); 45 CFR 147.136(b)', 'https://www.ecfr.gov/current/title-29/section-2560.503-1', '2017-01-01'),
  ('aca_external_review_window', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'External review: within four months after receiving the final internal denial', '45 CFR 147.136(c)(2)(vi), (d)(2)(i)', 'https://www.ecfr.gov/current/title-45/section-147.136', '2017-01-01'),
  ('aca_external_review_decision', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'External review decision: 45 days, 72 hours expedited', '45 CFR 147.136(d)(2)', 'https://www.ecfr.gov/current/title-45/section-147.136', '2017-01-01'),
  ('erisa_first_decision', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'First decision: 72 hours urgent, 15 days pre-service, 30 days post-service (one 15-day extension)', '29 CFR 2560.503-1(f)(2)', 'https://www.ecfr.gov/current/title-29/section-2560.503-1', '2017-01-01'),
  ('erisa_appeal_decision', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'Decision on appeal: 72 hours urgent, 30 days pre-service, 60 days post-service', '29 CFR 2560.503-1(i)(2)', 'https://www.ecfr.gov/current/title-29/section-2560.503-1', '2017-01-01'),
  ('erisa_specific_reason', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'The notice must give the specific reason, the denial code and its meaning, and the standard used', '29 CFR 2560.503-1(g)(1)(i); 45 CFR 147.136(b)(2)(ii)(E)(3)', 'https://www.ecfr.gov/current/title-29/section-2560.503-1', '2017-01-01'),
  ('erisa_claim_file', 'ecfr-2026-10-15', '{fully_insured,self_funded,marketplace}', 'Copies of all documents relevant to the claim, free of charge, on request', '29 CFR 2560.503-1(h)(2)(iii)', 'https://www.ecfr.gov/current/title-29/section-2560.503-1', '2017-01-01'),
  ('part_d_redetermination_window', 'ecfr-2026-10-15', '{medicare_part_d}', 'Redetermination: 60 days after receipt, receipt presumed 5 days after the notice date', '42 CFR 423.582(b)', 'https://www.ecfr.gov/current/title-42/section-423.582', null),
  ('part_d_ire_window', 'ecfr-2026-10-15', '{medicare_part_d}', 'Independent review: 60 days after receipt of the redetermination, receipt presumed 5 days after its date', '42 CFR 423.600(a)', 'https://www.ecfr.gov/current/title-42/section-423.600', null),
  ('part_d_coverage_decision', 'ecfr-2026-10-15', '{medicare_part_d}', 'Coverage decision: 72 hours for a drug, 14 days for payment, 24 hours expedited', '42 CFR 423.568(b), (c); 423.572(a)', 'https://www.ecfr.gov/current/title-42/section-423.568', null),
  ('part_d_redetermination_decision', 'ecfr-2026-10-15', '{medicare_part_d}', 'Redetermination decision: 7 days for a drug, 14 days for payment, 72 hours expedited', '42 CFR 423.590(a), (b), (d)', 'https://www.ecfr.gov/current/title-42/section-423.590', null),
  ('part_d_specific_reason', 'ecfr-2026-10-15', '{medicare_part_d}', 'The notice must state the specific reasons for the denial', '42 CFR 423.568(g)(2); 423.590(g)(2)', 'https://www.ecfr.gov/current/title-42/section-423.568', null),
  ('part_d_exception', 'ecfr-2026-10-15', '{medicare_part_d}', 'Formulary and tier exceptions need the prescriber''s supporting statement', '42 CFR 423.578', 'https://www.ecfr.gov/current/title-42/section-423.578', null),
  ('ma_reconsideration_window', 'ecfr-2026-10-15', '{medicare_advantage}', 'Reconsideration: 60 days after receipt, receipt presumed 5 days after the notice date', '42 CFR 422.582(b)', 'https://www.ecfr.gov/current/title-42/section-422.582', null),
  ('ma_first_decision', 'ecfr-2026-10-15', '{medicare_advantage}', 'First decision: 14 days, 7 days for prior authorization from 2026-01-01, 72 hours expedited or for a Part B drug (14-day extension for services)', '42 CFR 422.568(b); 422.572(a)', 'https://www.ecfr.gov/current/title-42/section-422.568', '2026-01-01'),
  ('ma_reconsideration_decision', 'ecfr-2026-10-15', '{medicare_advantage}', 'Reconsideration decision: 30 days for a service, 60 for payment, 7 for a Part B drug, 72 hours expedited; upheld denials go to the independent reviewer automatically', '42 CFR 422.590', 'https://www.ecfr.gov/current/title-42/section-422.590', null),
  ('ma_specific_reason', 'ecfr-2026-10-15', '{medicare_advantage}', 'The notice must state the specific reasons for the denial', '42 CFR 422.568(e)(2); 422.572(e)(1)', 'https://www.ecfr.gov/current/title-42/section-422.568', null),
  ('ma_follows_medicare_coverage', 'ecfr-2026-10-15', '{medicare_advantage}', 'Medicare Advantage plans must follow national and local Medicare coverage decisions', '42 CFR 422.101(b)', 'https://www.ecfr.gov/current/title-42/section-422.101', null),
  ('medicaid_plan_appeal_window', 'ecfr-2026-10-15', '{medicaid}', 'Managed care plan appeal: 60 days from the date on the notice', '42 CFR 438.402(c)(2)(ii)', 'https://www.ecfr.gov/current/title-42/section-438.402', null),
  ('medicaid_plan_appeal_decision', 'ecfr-2026-10-15', '{medicaid}', 'Plan appeal decision: 30 days, 72 hours expedited (14-day extension)', '42 CFR 438.408(b), (c)', 'https://www.ecfr.gov/current/title-42/section-438.408', null),
  ('medicaid_fair_hearing_window', 'ecfr-2026-10-15', '{medicaid}', 'State fair hearing after the plan upholds: at least 90 and at most 120 days from the plan''s notice', '42 CFR 438.408(f)(2)', 'https://www.ecfr.gov/current/title-42/section-438.408', null),
  ('medicaid_state_hearing_window', 'ecfr-2026-10-15', '{medicaid}', 'State Medicaid hearing: a time the state sets, not more than 90 days from the notice', '42 CFR 431.221(d)', 'https://www.ecfr.gov/current/title-42/section-431.221', null),
  ('medicaid_first_decision', 'ecfr-2026-10-15', '{medicaid}', 'Authorization decision: 7 days for rating periods from 2026-01-01 (14 before), 72 hours expedited (14-day extension)', '42 CFR 438.210(d)', 'https://www.ecfr.gov/current/title-42/section-438.210', null),
  ('medicaid_reasons', 'ecfr-2026-10-15', '{medicaid}', 'The notice must explain the reasons for the decision', '42 CFR 438.404(b)(2)', 'https://www.ecfr.gov/current/title-42/section-438.404', null)
on conflict (rule_id, version) do update set plan_funding = excluded.plan_funding, description = excluded.description, citation = excluded.citation, citation_url = excluded.citation_url, effective_from = excluded.effective_from;

-- Arik's own words for common CARC numbers. NOT shown to patients until the
-- owner sets explanation_status = 'approved' (M11-AC4). Re-running never
-- overwrites an approved explanation.
insert into denial_codes (code_set, code, arik_explanation) values
  ('CARC', '4', 'A billing code modifier was missing or did not fit the service.'),
  ('CARC', '11', 'The diagnosis on the claim does not fit the service billed.'),
  ('CARC', '15', 'An approval number the plan needed was missing or did not match.'),
  ('CARC', '16', 'The claim was missing information or had a mistake.'),
  ('CARC', '18', 'The plan thinks this claim was already sent.'),
  ('CARC', '22', 'Another insurance may need to pay first.'),
  ('CARC', '29', 'The claim reached the plan after its filing deadline.'),
  ('CARC', '31', 'The plan could not match the patient to its member records.'),
  ('CARC', '49', 'The plan treats this as a routine or preventive service it does not cover here.'),
  ('CARC', '50', 'The plan decided the care was not medically needed.'),
  ('CARC', '55', 'The plan sees this treatment as experimental or investigational.'),
  ('CARC', '56', 'The plan does not consider the treatment proven to work for this use.'),
  ('CARC', '96', 'The plan says this charge is not covered.'),
  ('CARC', '109', 'The plan says a different payer is responsible for this claim.'),
  ('CARC', '119', 'The most the plan pays for this benefit has been reached.'),
  ('CARC', '125', 'There was a problem with how the claim was submitted.'),
  ('CARC', '140', 'The name and member ID on the claim do not match the plan''s records.'),
  ('CARC', '150', 'The plan says the records do not support the level of service billed.'),
  ('CARC', '151', 'The plan says the records do not support how often the service was given.'),
  ('CARC', '167', 'The plan does not cover this service for the diagnosis on the claim.'),
  ('CARC', '181', 'A billing code on the claim was not valid on the date of service.'),
  ('CARC', '182', 'A billing code modifier was not valid on the date of service.'),
  ('CARC', '197', 'The plan needed to approve this in advance and has no record of an approval.'),
  ('CARC', '198', 'More care was given than the plan approved.'),
  ('CARC', '204', 'The plan says the current benefits do not include this.'),
  ('CARC', '206', 'A provider identification number on the claim was missing.'),
  ('CARC', '252', 'The plan needs another document to process the claim.')
on conflict (code_set, code) do update set arik_explanation = excluded.arik_explanation
  where denial_codes.explanation_status = 'needs_review';
