-- db/033_imbruvica_negotiated_price.sql
-- The tenth first-cycle Medicare negotiated price (2026-10-16). The seed
-- (seed_drugs.json) had 9 of the 10; Imbruvica was missing.
-- Source: CMS fact sheet "Medicare Drug Price Negotiation Program:
-- Negotiated Prices for Initial Price Applicability Year 2026" (August
-- 2024), https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf
-- table row: "Imbruvica | Pharmacyclics LLC | Blood cancers | $9,319.00 |
-- $14,934.00 | 38%" (negotiated price for a 30-day supply, CY 2026; list
-- price for a 30-day supply, CY 2023). The other nine seeded figures match
-- the same table. Effective January 1, 2026.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

insert into drugs (name, drug_class, generic_available)
select 'Imbruvica', 'blood cancers (BTK inhibitor)', false
where not exists (select 1 from drugs where lower(name) = 'imbruvica');

insert into sources (source_type, title, url, evidence_grade, effective_date, retrieved_at, last_verified_at)
select 'cms_data',
       'CMS fact sheet: Negotiated Prices for Initial Price Applicability Year 2026 (August 2024)',
       'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf',
       'A', '2026-01-01', now(), '2026-10-16'
where not exists (
  select 1 from sources
  where url = 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf'
);

insert into price_points (drug_id, price_type, supply_days, price_usd, effective_date, source_id)
select d.id, v.price_type, 30, v.price, v.eff::date, s.id
from (values ('ira_negotiated', 9319.00, '2026-01-01'), ('list', 14934.00, '2023-01-01')) as v(price_type, price, eff)
cross join (select id from drugs where lower(name) = 'imbruvica' order by created_at limit 1) d
cross join (select id from sources where url = 'https://www.cms.gov/files/document/fact-sheet-negotiated-prices-initial-price-applicability-year-2026.pdf' order by retrieved_at limit 1) s
where not exists (
  select 1 from price_points p where p.drug_id = d.id and p.price_type = v.price_type and p.price_source_id is null
);
