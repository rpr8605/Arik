-- db/023_price_sources_defaults_false.sql
-- M06-AC2 (audit fix 2026-10-05): the consent flags on price_sources must
-- DEFAULT to false so a new source is display/AI-barred until someone
-- explicitly allows it - a default-true flag turns a forgotten insert into
-- a consent violation.
--
-- Existing rows keep their stored values (SET DEFAULT does not rewrite
-- rows). The only seeded row ('nadac', db/022:140-143) already sets both
-- columns explicitly; it is restated here so its values are pinned no
-- matter how the row was created: NADAC is public CMS benchmark data, so
-- AI processing stays allowed while patient display stays off (benchmarks
-- inform checks; they are not patient-payable prices).
-- Applies to: local dev + Supabase project. Idempotent: yes.

alter table price_sources alter column allow_patient_display set default false;
alter table price_sources alter column allow_ai_processing set default false;

update price_sources
set allow_patient_display = false, allow_ai_processing = true
where name = 'nadac';
