-- db/037_program_card_details.sql
-- Cash vs insurance + "At the counter" card (docs/kimi/PLAN_CASH_VS_INSURANCE.md,
-- owner approved 2026-10-16). Read by lib/rules/cashVsInsurance.ts (via
-- lib/ranking.ts) and lib/counterCard.ts.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. Card details the pharmacist needs (BIN, PCN, group, member id rule),
--    ONLY as the program publishes them, with the page they came from.
--    Empty means the card tells the patient where to get them; never a
--    placeholder.
alter table exploits add column if not exists card_bin text;
alter table exploits add column if not exists card_pcn text;
alter table exploits add column if not exists card_group text;
alter table exploits add column if not exists card_member_id_rule text;   -- e.g. "printed on the card you download"
alter table exploits add column if not exists card_details_source_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exploits_card_details_sourced') then
    alter table exploits add constraint exploits_card_details_sourced
      check ((card_bin is null and card_pcn is null and card_group is null) or card_details_source_url is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exploits_card_bin_digits') then
    alter table exploits add constraint exploits_card_bin_digits check (card_bin is null or card_bin ~ '^\d{6}$');
  end if;
end $$;

-- 2. Program facts the cash-vs-insurance rule reads. Default 'unknown':
--    a government-insured patient is never steered to a drug maker's
--    program until the program is confirmed to allow it ('yes').
alter table exploits add column if not exists federal_program_allowed text not null default 'unknown';
alter table exploits add column if not exists counts_toward_deductible text not null default 'unknown';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exploits_federal_program_allowed_values') then
    alter table exploits add constraint exploits_federal_program_allowed_values check (federal_program_allowed in ('yes', 'no', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exploits_counts_toward_deductible_values') then
    alter table exploits add constraint exploits_counts_toward_deductible_values check (counts_toward_deductible in ('yes', 'no', 'unknown'));
  end if;
end $$;
