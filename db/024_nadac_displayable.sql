-- db/024_nadac_displayable.sql
-- NADAC is public CMS data (National Average Drug Acquisition Cost - what
-- pharmacies pay). It may be SHOWN to patients as the labeled benchmark
-- "what pharmacies pay" - context for whether a cash price is fair - while
-- lib/ranking.ts:290-293 keeps acquisition_benchmark rows out of patient
-- pathways forever (a benchmark is not a patient-payable price).
-- allow_ai_processing stays true (public data, no partner restriction).
-- Applies to: local dev + Supabase project. Idempotent: yes.

update price_sources
set allow_patient_display = true
where name = 'nadac';
