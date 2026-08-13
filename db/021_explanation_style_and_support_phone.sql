-- db/021_explanation_style_and_support_phone.sql
-- Guided-advocate ticket (2026-08-12): (a) the explanation-style preference
-- column ('standard' default — never assumed 'simple'); (b) exploits
-- support_phone so the "Call the program" recovery action can render only
-- when a REAL number exists in sourced data. First value comes from the
-- official Eliquis customer-connect page ("Call 1-855-ELIQUIS (354-7847)
-- ... Co-pay Card information"), verified 2026-08-12 — set on the copay
-- card row only, since the page ties the number to the card explicitly.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

alter table user_matching_profile
  add column if not exists explanation_style text not null default 'standard';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'explanation_style_values') then
    alter table user_matching_profile add constraint explanation_style_values
      check (explanation_style in ('standard','simple'));
  end if;
end $$;

alter table exploits
  add column if not exists support_phone text;  -- only ever set from a cited program page; null = no Call button

update exploits set support_phone = '1-855-354-7847'
where title like 'Eliquis Co-pay Card%' and support_phone is null;
