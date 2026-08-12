-- db/014_case_outcomes_pharmacy.sql
-- Outcome-confirmation wiring (build-plan step 9, closing pass 2026-08-12):
-- the KPI proof loop needs WHERE the patient filled, not just what they
-- paid. Pulled forward from the held evidence-fold migration (which
-- renumbers db/014 -> db/015).
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

alter table case_outcomes
  add column if not exists pharmacy_used text;  -- where the patient actually filled, per patient confirmation
