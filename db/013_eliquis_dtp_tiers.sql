-- db/013_eliquis_dtp_tiers.sql
-- Open question D resolution (2026-08-11, owner decision): ship ALL FOUR
-- Eliquis Direct-to-Patient tiers now, not just the $345 entry point —
-- shipping only $345 would present a partial number as complete.
-- Tiers (verified by owner research, 2026-08-11): $345 (30-day/60 tabs),
-- $426 (30-day/74 tabs), $690 (60-day), $1,035 (90-day).
--
-- price_points needs one new column to tell the two 30-day tiers apart:
-- unit_count (tablets/capsules per fill). supply_days alone collides
-- (both tiers are 30-day).
--
-- SOURCING HONESTY (per the Ticket-1 principle): the sources row below is
-- the BMS/Pfizer announcement of the Eliquis 360 Support direct-to-patient
-- option (launch Sept 8, 2025, "more than 40% less than the current list
-- price"). That document establishes the PROGRAM; it does not itself print
-- the four tier numbers in the text we could retrieve — the tier values
-- come from the owner's verified pull of 2026-08-11. effective_date is
-- left null (the announcement states a launch date, not per-tier effective
-- dates).
--
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. New column.
alter table price_points
  add column if not exists unit_count int;  -- tablets/capsules per fill; distinguishes same-day-supply tiers

-- 2. Source row (URL-guarded).
insert into sources (source_type, title, url, evidence_grade, last_verified_at, effective_date)
select 'manufacturer_program_terms',
       'Bristol Myers Squibb / Pfizer — Direct-to-Patient Eliquis via Eliquis 360 Support (announcement, launch Sept 8 2025)',
       'https://news.bms.com/news/details/2025/Bristol-Myers-Squibb-and-Pfizer-Announce-Direct-to-Patient-Eliquis-apixaban-Option/default.aspx',
       'A', '2026-08-11', '2025-09-08'
where not exists (select 1 from sources where url = 'https://news.bms.com/news/details/2025/Bristol-Myers-Squibb-and-Pfizer-Announce-Direct-to-Patient-Eliquis-apixaban-Option/default.aspx');

-- 3. The four tiers. price_type 'direct_to_patient' is a new value alongside
-- 'list'/'ira_negotiated'/'cash_pay'/'nadac'/'medicare_part_d' — a
-- manufacturer-run cash channel, distinct from pharmacy-counter cash_pay.
insert into price_points (drug_id, price_type, supply_days, unit_count, price_usd, source_id)
select d.id, 'direct_to_patient', v.supply_days, v.unit_count, v.price_usd,
  (select id from sources where url = 'https://news.bms.com/news/details/2025/Bristol-Myers-Squibb-and-Pfizer-Announce-Direct-to-Patient-Eliquis-apixaban-Option/default.aspx' limit 1)
from drugs d
cross join (values
  (30, 60,   345.00),
  (30, 74,   426.00),
  (60, null, 690.00),
  (90, null, 1035.00)
) as v(supply_days, unit_count, price_usd)
where d.name = 'Eliquis'
  and not exists (
    select 1 from price_points p
    where p.drug_id = d.id
      and p.price_type = 'direct_to_patient'
      and p.supply_days = v.supply_days
      and p.unit_count is not distinct from v.unit_count
  );
