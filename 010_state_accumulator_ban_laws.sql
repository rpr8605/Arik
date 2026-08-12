-- db/010_state_accumulator_ban_laws.sql
-- Closes the dependency gap flagged 2026-08-11: db/012's should_show_accumulator_warning()
-- takes p_state_has_ban as an input but nothing populated it. This migration is that source.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj
-- Idempotent: yes
-- STATUS: seeded from secondary aggregators (AIDS Institute Feb 2026 report + supporting sources).
-- Every row is verification_status='secondary_aggregated' until someone confirms against the
-- actual statute text (NCSL tracker, Triage Cancer tracker, or the bill itself). Do NOT treat
-- these rows as legally confirmed. Flag any row with ban_enacted IN ('unknown','pending','partial')
-- for manual resolution before it drives a live suppression decision.

-- 1. Interim source row for the aggregator this seed was built from
-- (Fixed 2026-08-11: original used retrieval_date/notes, which do not exist on
-- sources — schema.sql has retrieved_at and no notes column. The note text that
-- was in `notes`: "Interim seed source for state_accumulator_ban_laws. Each
-- state row should be upgraded to a primary statute citation over time — see
-- notes column per row for what is still needed." — that guidance lives in
-- this comment and in each row's notes instead.)
INSERT INTO sources (id, title, url, source_type, retrieved_at, effective_date)
SELECT
  gen_random_uuid(),
  'The AIDS Institute — Shortchanged: The Patient Impact of Copay Accumulator Policies in 2026',
  'https://theaidsinstitute.org/media/documents/02-27-2026-09-23-55-TAI_2026_Report_final.pdf',
  'secondary_research_report',
  '2026-08-11',
  '2026-02-27'
WHERE NOT EXISTS (
  SELECT 1 FROM sources WHERE url = 'https://theaidsinstitute.org/media/documents/02-27-2026-09-23-55-TAI_2026_Report_final.pdf'
);

-- 2. Reference table — one row per US state/DC/territory
CREATE TABLE IF NOT EXISTS state_accumulator_ban_laws (
  state_code TEXT PRIMARY KEY,
  jurisdiction_name TEXT NOT NULL,
  jurisdiction_type TEXT NOT NULL CHECK (jurisdiction_type IN ('state','district','territory')),
  ban_enacted TEXT NOT NULL CHECK (ban_enacted IN ('yes','no','pending','partial','unknown')) DEFAULT 'unknown',
  ban_type TEXT NOT NULL CHECK (ban_type IN ('outright','no_generic_only','no_generic_no_biosimilar','maximizer_only','none','unknown')) DEFAULT 'unknown',
  applies_to_market TEXT, -- e.g. 'fully_insured' — self-funded/ERISA plans are federally exempt regardless
  covers_maximizers TEXT NOT NULL CHECK (covers_maximizers IN ('yes','no','unknown')) DEFAULT 'unknown',
  source_id UUID REFERENCES sources(id),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('primary_source_verified','secondary_aggregated','unknown')) DEFAULT 'secondary_aggregated',
  -- Reconciliation columns (added 2026-08-11 per state-law-reconciliation-plan
  -- B3, before first apply): null until the pass-reconciliation load runs.
  corroboration_count INTEGER,  -- how many of the 3 research passes agree with this row
  source_pass_ids JSONB,        -- per-pass claimed answer + citation, for traceability
  notes TEXT,
  last_reviewed_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. RLS — read-only for authenticated, service-role manages writes
ALTER TABLE state_accumulator_ban_laws ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "state_ban_laws authenticated read" ON state_accumulator_ban_laws;
CREATE POLICY "state_ban_laws authenticated read" ON state_accumulator_ban_laws FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "state_ban_laws service-role all" ON state_accumulator_ban_laws;
CREATE POLICY "state_ban_laws service-role all" ON state_accumulator_ban_laws FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Seed data — 50 states + DC + PR
-- NOTE: source_id below uses a subquery against the sources row inserted in step 1 by title match.
-- Kimi: if you re-run this after step 1 already ran once, the subquery still resolves correctly
-- since step 1 is idempotent (ON CONFLICT DO NOTHING keeps the original row).

INSERT INTO state_accumulator_ban_laws
  (state_code, jurisdiction_name, jurisdiction_type, ban_enacted, ban_type, applies_to_market, covers_maximizers, source_id, verification_status, notes)
SELECT v.state_code, v.jurisdiction_name, v.jurisdiction_type, v.ban_enacted, v.ban_type, v.applies_to_market, v.covers_maximizers,
  (SELECT id FROM sources WHERE title = 'The AIDS Institute — Shortchanged: The Patient Impact of Copay Accumulator Policies in 2026' LIMIT 1),
  v.verification_status, v.notes
FROM (VALUES
  ('CT','Connecticut','state','yes','outright','fully_insured','unknown','secondary_aggregated','Also see CGA CT Report 2024-R-0034 for CT-specific statutory language'),
  ('DE','Delaware','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('IL','Illinois','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('IA','Iowa','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('LA','Louisiana','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('NJ','New Jersey','state','yes','outright','fully_insured','unknown','secondary_aggregated','Signed by Gov. Murphy Jan 13 2026 — 26th state — needs bill number/citation'),
  ('NM','New Mexico','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('NY','New York','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('OK','Oklahoma','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('VA','Virginia','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('WV','West Virginia','state','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('PR','Puerto Rico','territory','yes','outright','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('AZ','Arizona','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','One of first two states per STAT News — verify if actually outright not conditional'),
  ('AR','Arkansas','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('CO','Colorado','state','yes','no_generic_no_biosimilar','fully_insured','unknown','secondary_aggregated','Colorado explicitly extends carve-out to biosimilars, not just generics — distinct from other conditional states'),
  ('DC','District of Columbia','district','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('GA','Georgia','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('IN','Indiana','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('KY','Kentucky','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('ME','Maine','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('MD','Maryland','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('NC','North Carolina','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('ND','North Dakota','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('OR','Oregon','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('TN','Tennessee','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('TX','Texas','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('WA','Washington','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','Needs primary statute URL'),
  ('VT','Vermont','state','yes','no_generic_only','fully_insured','unknown','secondary_aggregated','8 V.S.A Section 4089j per earlier research — verify exact section'),
  ('AL','Alabama','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('AK','Alaska','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('CA','California','state','no','none',NULL,'unknown','secondary_aggregated','Legislation reported pending repeatedly since 2023 — re-verify, high-population state'),
  ('FL','Florida','state','no','none',NULL,'unknown','secondary_aggregated','Reported as expected to introduce — re-verify, high-population state'),
  ('HI','Hawaii','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('ID','Idaho','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('MA','Massachusetts','state','no','none',NULL,'unknown','secondary_aggregated','Reported as pending — re-verify current status'),
  ('MI','Michigan','state','no','none',NULL,'unknown','secondary_aggregated','Reported as pending — re-verify current status'),
  ('MN','Minnesota','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('MS','Mississippi','state','no','none',NULL,'unknown','secondary_aggregated','Reported as pending — re-verify current status'),
  ('MO','Missouri','state','no','none',NULL,'unknown','secondary_aggregated','Reported as expected to introduce — re-verify current status'),
  ('MT','Montana','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('NE','Nebraska','state','unknown','unknown',NULL,'unknown','secondary_aggregated','CONFLICT: earlier research listed NE as banned in first wave; AIDS Institute 2026 list omits NE. Flag for manual resolution before shipping.'),
  ('NV','Nevada','state','partial','unknown',NULL,'unknown','secondary_aggregated','NV Division of Insurance enforcing via regulatory guidance rather than statute — different mechanism, needs its own classification logic'),
  ('NH','New Hampshire','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('OH','Ohio','state','pending','outright',NULL,'unknown','secondary_aggregated','SB 207 reported pending with support letter dated June 1 2026 — verify if passed by build time'),
  ('PA','Pennsylvania','state','no','none',NULL,'unknown','secondary_aggregated','HB 2226 introduced Feb 18 2026, not yet passed as of that source — re-verify current status'),
  ('RI','Rhode Island','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('SC','South Carolina','state','no','none',NULL,'unknown','secondary_aggregated','H.3934/S.330 reported pending as of Jan 2026 — re-verify current status'),
  ('SD','South Dakota','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed'),
  ('UT','Utah','state','no','none',NULL,'unknown','secondary_aggregated','Reported as expected to introduce — re-verify current status'),
  ('WI','Wisconsin','state','no','none',NULL,'unknown','secondary_aggregated','Explicitly confirmed as outlier state with no ban as of Jan 2026 press coverage'),
  ('WY','Wyoming','state','no','none',NULL,'unknown','secondary_aggregated','Not listed in any ban source found — treat as no ban until confirmed')
) AS v(state_code, jurisdiction_name, jurisdiction_type, ban_enacted, ban_type, applies_to_market, covers_maximizers, verification_status, notes)
ON CONFLICT (state_code) DO NOTHING;

-- 5. Helper: raw ban_type lookup
CREATE OR REPLACE FUNCTION get_state_ban_type(p_state_code TEXT)
RETURNS TEXT AS $$
  SELECT ban_type FROM state_accumulator_ban_laws WHERE state_code = p_state_code;
$$ LANGUAGE sql STABLE;

-- 6. Helper: THE function db/012's should_show_accumulator_warning() needs as p_state_has_ban.
-- Applies the conditional-carve-out logic (outright / no_generic_only / no_generic_no_biosimilar).
-- Unresolved states (ban_enacted IN ('unknown','pending','partial')) return FALSE (no confirmed ban)
-- rather than TRUE — this is intentionally conservative on the "does a ban exist" question, but
-- remember db/012's warning function already defaults to WARN when funding type is unknown, so
-- an unresolved state does not silently suppress a warning it shouldn't — it just means the ban
-- input itself isn't asserting protection that hasn't been confirmed yet.
CREATE OR REPLACE FUNCTION state_has_accumulator_ban(
  p_state_code TEXT,
  p_drug_has_generic BOOLEAN DEFAULT NULL,
  p_drug_has_biosimilar BOOLEAN DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_row state_accumulator_ban_laws%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM state_accumulator_ban_laws WHERE state_code = p_state_code;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_row.ban_enacted != 'yes' THEN RETURN FALSE; END IF;

  CASE v_row.ban_type
    WHEN 'outright' THEN RETURN TRUE;
    WHEN 'no_generic_only' THEN RETURN COALESCE(p_drug_has_generic, FALSE) = FALSE;
    WHEN 'no_generic_no_biosimilar' THEN RETURN (COALESCE(p_drug_has_generic, FALSE) = FALSE) AND (COALESCE(p_drug_has_biosimilar, FALSE) = FALSE);
    WHEN 'maximizer_only' THEN RETURN FALSE; -- accumulator-specific check; maximizer handled separately if/when built
    ELSE RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. Rows requiring manual resolution before this table should drive any live suppression decision.
-- Run this as a sanity check after seeding:
--   SELECT state_code, jurisdiction_name, ban_enacted, notes FROM state_accumulator_ban_laws
--   WHERE ban_enacted IN ('unknown','pending','partial') OR verification_status != 'primary_source_verified'
--   ORDER BY state_code;
-- As of this seed, EVERY row returns from that query — none are primary-source-verified yet.
-- Do not treat this table as legally final. It is a structured starting point, not a finished audit.
