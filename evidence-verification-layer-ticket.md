# Build Ticket: Evidence & Verification Layer (Trust Layer)

## Why this ticket exists
Three discovery/verification passes (Gemini, Perplexity, Grok) just proved
the exact failure mode this layer needs to prevent: Zepbound's OFFICIAL
manufacturer pages contain two disagreeing indexed variants for the same
program's annual max ($3,283 vs $6,097). A flat schema would silently pick
one. This ticket makes "pick one" architecturally impossible without human
sign-off.

This does not replace the existing `exploits` / `price_points` /
`accumulator_policies` tables' purpose — it specifies them down to the
field level and adds the verification state machine they were missing.

---

## Part 1 — Schema changes

### New/revised tables

**`evidence_sources`** (raw, never treated as truth)
- id
- url
- publisher
- source_tier (1-7, see hierarchy below)
- retrieved_at
- content_hash
- archived_copy_path (snapshot storage — can be a Supabase Storage bucket
  path to a saved HTML/PDF copy)
- extracted_by (which bot/pass found this — 'gemini_discovery',
  'perplexity_verify', 'grok_heavy', 'manual', etc.)

**`program_records`** (one row per program + coverage branch + product form
— NOT one row per drug)
- id
- drug_id
- manufacturer
- program_name
- program_type (copay_card / pap / self_pay / foundation_grant)
- coverage_branch (commercial_covered / commercial_not_covered /
  uninsured / medicare_excluded / self_pay — enumerate as needed)
- product_form (pen / vial / kwikpen / tablet_count / null if N/A)
- effective_start / effective_end (nullable — null end = current)
- superseded_by (nullable FK to a newer program_records row — this is how
  we preserve history instead of overwriting)

**`program_terms`** (individual fields, not a blob — one row per
program_record, but structured so each field can carry its own confidence)
- program_record_id
- patient_price_type ('as_low_as' | 'flat' | 'range')
- patient_price_floor
- monthly_max_savings
- annual_max_savings
- max_fills
- days_supply
- initial_fill_price
- refill_price
- field_confidence (jsonb — e.g. {"annual_max_savings": 0.31,
  "patient_price_floor": 0.98})

**`program_eligibility`**
- program_record_id
- minimum_age
- commercial_insurance_required (boolean)
- drug_coverage_required (boolean)
- government_insurance_excluded (boolean)
- income_ceiling
- residency_requirement
- diagnosis_requirement (text)

**`verification_status`** — replace any boolean/simple status field with
this enum wherever it appears (program_records, and the existing
state_accumulator_ban_laws table should also migrate to this same enum for
consistency):
- `verified_current`
- `verified_historical`
- `conflicted`
- `unresolved` (nothing found; distinct from "confirmed does not exist")

**`evidence_conflicts`**
- program_record_id
- field_name
- value_a / value_b
- source_a_id / source_b_id (FK to evidence_sources)
- reason (free text — e.g. "conflicting indexed manufacturer content")
- resolved_at (nullable)
- resolved_value (nullable — stays null until a human sets it)
- resolution_note (nullable)

### Source tier reference (store as a lookup, not hardcoded)
1. Manufacturer program terms / official PDF / legal terms
2. Manufacturer patient-facing program page
3. Manufacturer HCP page
4. Manufacturer-affiliated foundation
5. Government / authoritative external documentation
6. Reputable secondary source
7. Aggregator / coupon / blog / search-result snippet

Rule to enforce in code, not just convention: a lower-tier source can
CREATE a conflict record but can never overwrite a higher-tier source's
value. Tier 7 disagreeing with Tier 2 logs a conflict; it does not become
the new trusted value.

---

## Part 2 — Review priority (computed, not manual)

Add a computed `review_priority` on `program_records`, derived from:
- `conflicted` status → CRITICAL
- `unresolved` status with a program_type that's core to the drug's
  known pathway set → MEDIUM
- `verified_current` with no conflicts → LOW

This is what lets you spend 30 seconds on Dupixent and 10 minutes on
Zepbound instead of reading every record equally.

---

## Part 3 — Load today's three research batches as the first real data

Do NOT auto-extract these into trusted records. Load them AS-IS into
`evidence_sources` + draft `program_records` in the appropriate
verification_status, exactly matching what the Perplexity pass already
determined:

- **Dupixent MyWay Copay Card** — `verified_current`, tier 2 source
  (official manufacturer page), no conflicts logged
- **Dupixent MyWay PAP** — `verified_current`, tier 2, no conflicts
- **Zepbound Savings Card (commercial, not covered)** — `conflicted`.
  `annual_max_savings` gets a NULL trusted value with two
  `evidence_conflicts` rows: $3,283 vs $6,097, both tier 2 (same
  manufacturer page, disagreeing indexed variants), review_priority CRITICAL
- **Zepbound Savings Card (commercial, covered)** — `conflicted` on
  `monthly_max_savings` ($150 vs $100 from a third-party source — this one
  IS a tier mismatch, tier 2 vs tier 7, so the $150 official value is
  provisionally trusted but the conflict record stays attached)
- **Eliquis Copay Card** — `conflicted` on `annual_max_savings` ($2,000
  official tier-2 value provisionally trusted, $6,400 third-party tier-7
  logged as a conflict artifact, not discarded)
- **Eliquis Free 30-Day Trial** — `verified_current`, tier 2, no conflicts
- **Eliquis Direct-to-Patient Program** — `verified_current`, tier 2, no
  conflicts (note the pricing here is a range across day-supply tiers, make
  sure `program_terms` handles multiple price points per program cleanly
  rather than forcing one row)

Grok's X-post findings do NOT get `program_records` rows at all — they're
`evidence_sources` at a new tier (call it tier 8, or a separate
`community_signal` flag) that exist purely for human situational awareness,
not for the trust hierarchy. Do not let them participate in conflict
detection against tiers 1-7.

---

## Part 4 — Regression test

Add Zepbound's non-covered-commercial pathway as a permanent fixture in the
eval harness (the one described in the JaneBench-style Phase 5 plan). This
is a real, naturally-occurring example of "official sources disagree with
themselves" — exactly the case that proves the pipeline refuses to guess
instead of silently picking a number.

Test assertion: given this fixture, the pipeline must produce
`verification_status = 'conflicted'` and `annual_max_savings = null` in the
trusted record, never a resolved number, until a human explicitly sets
`resolved_value`.

---

## What this ticket does NOT include (deliberately out of scope here)
- The actual discovery/extraction bots from earlier phases — this ticket
  is schema + data load only
- A review UI — for now, review happens as a filtered Supabase query
  (`WHERE verification_status = 'conflicted' ORDER BY review_priority`),
  build a UI later once there's enough volume to justify it
- Auto-resolution logic of any kind — no code path should ever be able to
  move a record from `conflicted` to `verified_current` without a human
  setting `resolved_value` directly
