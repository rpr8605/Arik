-- db/018_bundle_seeds.sql
-- Dupixent + Zepbound bundles (+ Eliquis trial/DTP exploit rows and the
-- Eliquis card conflict), transcribed from the owner-verified research set
-- (Part B answers, 2026-08-11). No new figures invented here: every value
-- traces to that verified set; URLs verified live 2026-08-12. The Zepbound
-- non-covered row intentionally loads with NO trusted annual max — the
-- conflict is the data.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. Drugs.
insert into drugs (name, brand_names, generic_available, drug_class)
select 'Dupixent', '{Dupixent}', false, 'biologic (IL-4/IL-13 inhibitor)'
where not exists (select 1 from drugs where name = 'Dupixent');
insert into drugs (name, brand_names, generic_available, drug_class)
select 'Zepbound', '{Zepbound}', false, 'GIP/GLP-1 receptor agonist (tirzepatide)'
where not exists (select 1 from drugs where name = 'Zepbound');

-- 2. Sources (URL-guarded; the conflict-provenance row by title).
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'DUPIXENT MyWay Copay Card — official program page', 'https://www.dupixent.com/support-savings/copay-card-insurance', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.dupixent.com/support-savings/copay-card-insurance');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'DUPIXENT MyWay patient support / patient assistance program — official page', 'https://www.dupixent.com/support-savings/dupixent-my-way', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.dupixent.com/support-savings/dupixent-my-way');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'Zepbound Savings Card — official Lilly savings page', 'https://zepbound.lilly.com/savings', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://zepbound.lilly.com/savings');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'manufacturer_program_terms', 'Eliquis pricing page (Free 30-Day Trial + co-pay card terms)', 'https://www.eliquis.bmscustomerconnect.com/price', 'A', '2026-08-12'
where not exists (select 1 from sources where url = 'https://www.eliquis.bmscustomerconnect.com/price');
insert into sources (source_type, title, url, evidence_grade, last_verified_at)
select 'secondary_research_report', 'Third-party program-guide figures captured in the owner-verified research passes (2026-08-11); original pages not re-verified — cited ONLY as the dissenting side of evidence_conflicts rows', null, 'unverified', '2026-08-12'
where not exists (select 1 from sources where title like 'Third-party program-guide figures captured%');

-- 3. New exploit rows. Rows that carry conflicts insert as 'unresolved'
-- and the conflict trigger flips them to 'conflicted' in step 5.
insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, verification_status, patient_price_type, patient_price_floor, annual_max_savings, medicare_exclusion_reason, terms_citation_source_id, source_id, last_verified_at)
select d.id, 'copay_card', 'Dupixent MyWay Copay Card',
  'Eligible commercially insured patients may pay as little as $0 per fill; maximum savings $13,000/year. Commercial only by manufacturer terms.',
  '{"requires": "commercial_insurance", "excludes_government_programs": true}'::jsonb,
  'verified_current', 'as_low_as', 0, 13000, 'manufacturer_terms',
  (select id from sources where url = 'https://www.dupixent.com/support-savings/copay-card-insurance' limit 1),
  (select id from sources where url = 'https://www.dupixent.com/support-savings/copay-card-insurance' limit 1),
  '2026-08-12'
from drugs d where d.name = 'Dupixent'
and not exists (select 1 from exploits where title = 'Dupixent MyWay Copay Card');

insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, verification_status, patient_price_type, patient_price_floor, medicare_exclusion_reason, source_id, last_verified_at)
select d.id, 'pap', 'Dupixent MyWay Patient Assistance Program',
  'Free Dupixent for eligible patients: uninsured with household income at or below $100,000, no confirmed insurance coverage; Medicare Part D patients may qualify.',
  '{"requires": "financial_need", "income_max_usd": 100000, "uninsured_or_underinsured": true, "medicare_part_d_may_qualify": true}'::jsonb,
  'verified_current', 'flat', 0, 'none',
  (select id from sources where url = 'https://www.dupixent.com/support-savings/dupixent-my-way' limit 1),
  '2026-08-12'
from drugs d where d.name = 'Dupixent'
and not exists (select 1 from exploits where title = 'Dupixent MyWay Patient Assistance Program');

insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, patient_price_type, patient_price_floor, medicare_exclusion_reason, source_id, last_verified_at)
select d.id, 'copay_card', 'Zepbound Savings Card (commercial, drug not covered)',
  'Commercially insured patients whose plan does not cover Zepbound: as low as $499/month per program terms. ANNUAL MAX IS IN DISPUTE between two official indexed variants ($3,283 vs $6,097) — no trusted value until human resolution.',
  '{"requires": "commercial_insurance", "drug_covered": false, "excludes_government_programs": true}'::jsonb,
  'as_low_as', 499, 'manufacturer_terms',
  (select id from sources where url = 'https://zepbound.lilly.com/savings' limit 1),
  '2026-08-12'
from drugs d where d.name = 'Zepbound'
and not exists (select 1 from exploits where title = 'Zepbound Savings Card (commercial, drug not covered)');

insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, patient_price_type, patient_price_floor, monthly_max_savings, medicare_exclusion_reason, source_id, last_verified_at)
select d.id, 'copay_card', 'Zepbound Savings Card (commercial, drug covered)',
  'Commercially insured patients whose plan covers Zepbound: as low as $25/month. Monthly max savings $150 per official page (provisionally trusted; a third-party guide says $100 — conflict logged).',
  '{"requires": "commercial_insurance", "drug_covered": true, "excludes_government_programs": true}'::jsonb,
  'as_low_as', 25, 150, 'manufacturer_terms',
  (select id from sources where url = 'https://zepbound.lilly.com/savings' limit 1),
  '2026-08-12'
from drugs d where d.name = 'Zepbound'
and not exists (select 1 from exploits where title = 'Zepbound Savings Card (commercial, drug covered)');

insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, verification_status, patient_price_type, patient_price_floor, medicare_exclusion_reason, source_id, last_verified_at)
select d.id, 'free_trial', 'Eliquis Free 30-Day Trial Offer',
  'Free 30-day supply (up to 74 tablets) with valid 30-day prescription at participating pharmacies; cannot be combined with other offers; cannot seek reimbursement from insurance or any third party including state/federal programs; card expires 2026-12-31.',
  '{"requires": "new_patient_30day_prescription", "excludes_government_programs": true, "one_time": true}'::jsonb,
  'verified_current', 'flat', 0, 'manufacturer_terms',
  (select id from sources where url = 'https://www.eliquis.bmscustomerconnect.com/price' limit 1),
  '2026-08-12'
from drugs d where d.name = 'Eliquis'
and not exists (select 1 from exploits where title = 'Eliquis Free 30-Day Trial Offer');

insert into exploits (drug_id, exploit_type, title, description, eligibility_criteria, verification_status, patient_price_type, patient_price_floor, medicare_exclusion_reason, source_id, last_verified_at)
select d.id, 'direct_to_patient_program', 'Eliquis Direct-to-Patient Program (Eliquis 360 Support)',
  'Cash-pay direct purchase channel: $345 (30-day/60 tabs), $426 (30-day/74 tabs), $690 (60-day), $1,035 (90-day) — tier rows in price_points. No insurance required; legal cash channel for Medicare patients (not billed to Medicare).',
  '{"requires": "cash_pay", "insurance_required": false}'::jsonb,
  'verified_current', 'flat', 345, 'none',
  (select id from sources where url = 'https://news.bms.com/news/details/2025/Bristol-Myers-Squibb-and-Pfizer-Announce-Direct-to-Patient-Eliquis-apixaban-Option/default.aspx' limit 1),
  '2026-08-12'
from drugs d where d.name = 'Eliquis'
and not exists (select 1 from exploits where title like 'Eliquis Direct-to-Patient%');

-- 4. Eliquis copay card: official $2,000 annual max is provisionally
-- trusted; the $6,400 third-party figure logs as a conflict (step 5).
-- patient_price_floor is the card's own documented "$10 per fill"
-- (as_low_as semantics per the price-page terms).
update exploits set
  annual_max_savings = 2000,
  patient_price_type = 'as_low_as',
  patient_price_floor = 10,
  medicare_exclusion_reason = 'manufacturer_terms',
  terms_citation_source_id = (select id from sources where url = 'https://www.eliquis.bmscustomerconnect.com/price' limit 1)
where title like 'Eliquis Co-pay Card%';

-- 5. The three conflict fixtures. Inserting each flips its parent exploit
-- to 'conflicted' via the db/017 trigger — that flip IS the evidence layer
-- working. Guards make re-runs no-ops.
insert into evidence_conflicts (exploit_id, field_name, value_a, value_b, source_a_id, source_b_id, reason)
select e.id, 'annual_max_savings', '3283', '6097',
  (select id from sources where url = 'https://zepbound.lilly.com/savings' limit 1),
  (select id from sources where title like 'Third-party program-guide figures captured%' limit 1),
  'Two disagreeing indexed variants on the same manufacturer site, both tier-2. No trusted value — a human must resolve.'
from exploits e where e.title = 'Zepbound Savings Card (commercial, drug not covered)'
and not exists (select 1 from evidence_conflicts where exploit_id = e.id and field_name = 'annual_max_savings');

insert into evidence_conflicts (exploit_id, field_name, value_a, value_b, source_a_id, source_b_id, reason)
select e.id, 'monthly_max_savings', '150', '100',
  (select id from sources where url = 'https://zepbound.lilly.com/savings' limit 1),
  (select id from sources where title like 'Third-party program-guide figures captured%' limit 1),
  'Official page ($150) vs third-party guide ($100). Official provisionally trusted pending human resolution; tier mismatch noted.'
from exploits e where e.title = 'Zepbound Savings Card (commercial, drug covered)'
and not exists (select 1 from evidence_conflicts where exploit_id = e.id and field_name = 'monthly_max_savings');

insert into evidence_conflicts (exploit_id, field_name, value_a, value_b, source_a_id, source_b_id, reason)
select e.id, 'annual_max_savings', '2000', '6400',
  (select id from sources where url = 'https://www.eliquis.bmscustomerconnect.com/price' limit 1),
  (select id from sources where title like 'Third-party program-guide figures captured%' limit 1),
  'Official $2,000 annual cap vs third-party $6,400. Official provisionally trusted pending human resolution.'
from exploits e where e.title like 'Eliquis Co-pay Card%'
and not exists (select 1 from evidence_conflicts where exploit_id = e.id and field_name = 'annual_max_savings');
