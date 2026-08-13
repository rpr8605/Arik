-- db/015_income_pct_fpl.sql
-- Single approved column pulled forward from the held evidence fold
-- (which stays unbuilt): owner decision 2026-08-11, Part A answer 6 —
-- "Store numeric %FPL on the profile... ranking logic must use the numeric
-- field only" (income_bracket text stays for UI). Required by every
-- income-gated eligibility screener (db/016). Idempotent: yes.

alter table user_matching_profile
  add column if not exists income_pct_fpl numeric;  -- household income as % of FPL; screener/ranking logic reads THIS, never the bracket text
