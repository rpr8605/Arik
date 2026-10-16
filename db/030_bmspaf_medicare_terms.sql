-- db/030_bmspaf_medicare_terms.sql
-- BMS Patient Assistance Foundation: Medicare terms as the foundation states
-- them (2026-10-16). Read by lib/ranking.ts eligibilityNotes().
--
-- Source: https://www.bmspaf.org/#/eligibility (rendered page, checked
-- 2026-10-16): "You do not have insurance coverage for a medicine listed on
-- this site, or you have Medicare and you have spent at least 3% of your
-- yearly household income on out-of-pocket prescription expenses in the
-- same calendar year you are applying to BMSPAF, and You are age 65 and
-- over and you do not qualify for the Medicare Part D Low-Income Subsidy
-- (LIS) program (also called "Extra Help"). Proof of denial will be
-- required."
-- So: medicare_allowed stays true, the 3% test stays, and the Extra Help
-- denial requirement is added.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

update exploits
set eligibility_criteria = coalesce(eligibility_criteria, '{}'::jsonb)
      || '{"medicare_allowed": true, "medicare_oop_spend_test_pct": 3, "medicare_requires_lis_denial": true}'::jsonb
where title = 'Bristol Myers Squibb Patient Assistance Foundation';

-- Cite the eligibility page itself and the date it was read.
update sources s
set url = 'https://www.bmspaf.org/#/eligibility',
    last_verified_at = '2026-10-16'
from exploits e
where e.source_id = s.id
  and e.title = 'Bristol Myers Squibb Patient Assistance Foundation'
  and s.url in ('https://www.bmspaf.org/', 'https://www.bmspaf.org/#/eligibility');
