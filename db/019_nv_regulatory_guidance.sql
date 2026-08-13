-- db/019_nv_regulatory_guidance.sql
-- Owner classification decision (2026-08-12): Nevada is modeled as
-- ban_type='regulatory_guidance' — NOT folded into yes or no. ban_enacted
-- stays 'partial' and verification_status stays 'unknown': the 2020-NBPP
-- plan-year guidance is real enforcement for marketplace plans but is not
-- statute and is less durable (plan-year / administration dependent).
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- Widen the ban_type enum to admit the new classification.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'state_accumulator_ban_laws_ban_type_check') then
    alter table state_accumulator_ban_laws drop constraint state_accumulator_ban_laws_ban_type_check;
  end if;
end $$;
alter table state_accumulator_ban_laws
  add constraint state_accumulator_ban_laws_ban_type_check
  check (ban_type in ('outright','no_generic_only','no_generic_no_biosimilar','maximizer_only','none','unknown','regulatory_guidance'));

update state_accumulator_ban_laws set
  ban_type = 'regulatory_guidance',
  notes = 'OWNER-CLASSIFIED 2026-08-12: regulatory_guidance — NV Division of Insurance enforces copay-assistance counting via 2020-NBPP plan-year guidance for marketplace plans, not an enacted statute. DURABILITY CAVEAT: guidance can change by plan year or administration; less durable than statute. state_has_accumulator_ban() returns FALSE (no statutory ban asserted); callers should surface the regulatory note instead.',
  updated_at = now()
where state_code = 'NV';
