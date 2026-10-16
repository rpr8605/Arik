-- db/040_bill_rights_checks.sql
-- Patient rights checks on a confirmed bill (No Surprises, good faith
-- estimate, hospital financial assistance; lib/rules/bills/rights.ts).
-- A finding may name dollar figures that are not bill lines (the good
-- faith estimate the patient entered, the bill total, the difference), so
-- a letter written from the stored finding can cite them and still pass
-- the letter grounding check (lib/production/contracts.ts).
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.
-- Deploy order: apply before the code that writes this column. The bill
-- routes return 403 in DEMO_MODE, so the demo never writes it.

alter table bill_audit_findings add column if not exists ref_amounts_usd numeric[];  -- Finding.refsUsd
