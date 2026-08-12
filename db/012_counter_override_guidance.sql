-- db/012_counter_override_guidance.sql
-- Ticket 1 (2026-08-11): pharmacy counter-reality checklist. Complaint
-- pattern #1 across the research passes is "copay card/coupon rejected at
-- the counter" — usually a coordination-of-benefits misfire, where the fix
-- is the pharmacy tech resubmitting with the correct NCPDP Other Coverage
-- Code (Telecommunication Standard field 308-C8). This table is the cited
-- lookup that lets chat surface that checklist instead of a shrug.
--
-- SOURCING: the NCPDP standard text itself is licensed/paywalled. The value
-- set for field 308-C8 is reproduced verbatim in official payer documents;
-- the two used here are the NYSDOH eMedNY ProDUR-ECCA Provider Manual (full
-- 0-8 list, with NYSDOH's processing equivalences) and the Colorado HCPF
-- Other Coverage Code Guidance (detailed when-to-use for codes 0-4; CO
-- Medicaid accepts only 0-4). Both are cited as sources rows below.
--
-- SCOPE GUARD: these rows explain what the codes mean and the legitimate
-- resubmission path. They are not instructions to misrepresent coverage —
-- chat_system_prompt.md's insurance-fraud red line applies to anything
-- surfaced from this table.
--
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. Table. Note source_id is NOT NULL here on purpose: the older reference
-- tables enforce the source rule at the app layer only (AGENTS.md); new
-- tables should not repeat that gap.
create table if not exists counter_override_guidance (
  id uuid primary key default gen_random_uuid(),
  code_system text not null,           -- 'ncpdp_other_coverage_code' (field 308-C8)
  code_value text not null,            -- '0'..'8'
  official_definition text not null,   -- definition as published by the cited payer document
  plain_language text not null,        -- what it means at the counter, in patient terms
  counter_action text not null,        -- the legitimate verify/resubmit path for pharmacy staff
  source_id uuid not null references sources(id),
  created_at timestamptz default now(),
  unique (code_system, code_value)
);

-- 2. RLS — reference data: authenticated read, service-role manages writes.
-- Table-level grants come from db/004's default privileges, same as 010.
alter table counter_override_guidance enable row level security;
drop policy if exists "counter_guidance authenticated read" on counter_override_guidance;
create policy "counter_guidance authenticated read" on counter_override_guidance
  for select to authenticated using (true);
drop policy if exists "counter_guidance service-role all" on counter_override_guidance;
create policy "counter_guidance service-role all" on counter_override_guidance
  for all to service_role using (true) with check (true);

-- 3. Sources rows (guarded by URL so re-runs stay clean).
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'state_medicaid_provider_manual',
       'NYSDOH eMedNY ProDUR-ECCA Provider Manual — NCPDP field 308-C8 (Other Coverage Code) value list',
       'https://www.emedny.org/ProviderManuals/Pharmacy/ProDUR-ECCA_Provider_Manual/1_19/ProDUR-ECCA%20Provider%20Manual.htm',
       'A', '2026-08-11'
where not exists (select 1 from sources where url = 'https://www.emedny.org/ProviderManuals/Pharmacy/ProDUR-ECCA_Provider_Manual/1_19/ProDUR-ECCA%20Provider%20Manual.htm');

insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'state_medicaid_provider_manual',
       'Colorado HCPF — Colorado Medicaid Pharmacy Billing Other Coverage Code (OCC) Guidance',
       'https://hcpf.colorado.gov/other-coverage-code-guidance',
       'A', '2026-08-11'
where not exists (select 1 from sources where url = 'https://hcpf.colorado.gov/other-coverage-code-guidance');

-- 4. Seed: the nine 308-C8 values. Definitions per the eMedNY manual;
-- when-to-use detail for 0-4 per HCPF guidance.
insert into counter_override_guidance
  (code_system, code_value, official_definition, plain_language, counter_action, source_id)
select v.code_system, v.code_value, v.official_definition, v.plain_language, v.counter_action,
  (select id from sources where url = 'https://www.emedny.org/ProviderManuals/Pharmacy/ProDUR-ECCA_Provider_Manual/1_19/ProDUR-ECCA%20Provider%20Manual.htm' limit 1)
from (values
  ('ncpdp_other_coverage_code','0','Not Specified',
   'The claim was sent without saying whether you have other coverage — the system default when the pharmacy has not identified any.',
   'Default for initial claim processing when no other coverage has been identified (HCPF). If the claim then bounces with an other-insurance rejection, the tech checks what coverage is actually on file and resubmits with the code that matches reality (1, 2, 3, or 4).'),
  ('ncpdp_other_coverage_code','1','No Other Coverage Identified',
   'The pharmacy verified you have no other insurance — this payer is the only coverage.',
   'Used only after verifying no other active coverage exists (HCPF). If the payer''s own file shows other insurance, a claim sent with code 1 will deny — the fix is resubmitting with 2, 3, or 4, whichever matches.'),
  ('ncpdp_other_coverage_code','2','Other Coverage Exists - Payment Collected',
   'Your other insurance actually paid part of the claim; this claim bills the remainder to the second payer.',
   'Requires the COB/other-payer fields to carry what the primary payer paid (Other Payer Amount Paid must be greater than 0). Missing payment values reject the claim (HCPF). Contrast with code 4, where the other payer processed but paid nothing.'),
  ('ncpdp_other_coverage_code','3','Other Coverage Exists - This Claim Not Covered',
   'The other payer refused this claim — not covered, coverage not active on the fill date, or an ID mismatch — so this payer is being billed instead.',
   'The standard code when a primary rejects the claim as not covered. Per HCPF this covers product/service not covered, not covered under Part D law, patient not covered, filled before coverage effective or after termination, non-matched cardholder ID, and similar rejections. This is the usual resubmission path when a copay card was wrongly treated as primary coverage.'),
  ('ncpdp_other_coverage_code','4','Other Coverage Exists - Payment Not Collected',
   'The other payer processed the claim but paid nothing — the amount went to your deductible or copay responsibility.',
   'The COB fields must carry the patient-responsibility amounts exactly as the other payer returned them; missing COB values cause rejection (HCPF). Distinct from code 2, where money actually moved.'),
  ('ncpdp_other_coverage_code','5','Managed Care Plan - Denial',
   'A managed-care plan denied the claim.',
   'NYSDOH processes this as equivalent to code 3. For payers that accept only codes 0-4 (e.g., Colorado Medicaid), the claim goes in as a 3.'),
  ('ncpdp_other_coverage_code','6','Other Coverage Denied - Not Participating Provider',
   'The other coverage denied the claim because this pharmacy is not in its network.',
   'NYSDOH processes this as equivalent to code 3. First check whether using an in-network pharmacy resolves it; otherwise resubmit as a 3 where the payer only accepts 0-4.'),
  ('ncpdp_other_coverage_code','7','Other Coverage - Not in Effect at Time of Service',
   'The coverage on file was not active on the fill date — not yet effective, expired, or terminated.',
   'NYSDOH processes this as equivalent to code 1. Verify the coverage dates first: if the other coverage genuinely lapsed, the rejection is correct and there is no override — the next step is checking the patient''s current coverage, not resubmitting.'),
  ('ncpdp_other_coverage_code','8','Claim is Billing for Copay',
   'The primary payer already paid; this claim is billing the remaining copay amount to another payer.',
   'NYSDOH processes this as equivalent to code 2 (payment-collected path, so other-payer amount fields apply). When a primary has paid and the remaining copay is being billed to a secondary payer, this is the code that describes that situation; where a payer accepts only 0-4, the claim goes in as a 2.')
) as v(code_system, code_value, official_definition, plain_language, counter_action)
on conflict (code_system, code_value) do nothing;
