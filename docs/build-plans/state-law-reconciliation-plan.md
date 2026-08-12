# State-Law Reconciliation Plan — 2026-08-11

Status: **B1/B2/B4 COMPLETE — awaiting go-ahead before any load.** The three
passes were provided (saved at `docs/research/state-law-pass-{1,2,3}.md`),
parsed, and diffed by `scripts/reconcile_state_law_passes.mjs`. Outputs:
`docs/research/state-law-reconciliation.json` (machine-readable) and
`docs/build-plans/state-law-review-priority.md` (the hand-verification
worklist). Nothing below touches the live DB without a separate go-ahead.

## Actual bucket counts (52 jurisdictions)

- **Disagree: 6** — CA, IA, ND, NE, NV, PA
- **Partial: 24** — 20 all-Y citation conflicts (pass 1 vs pass 3; pass 2
  retrieved zero primary citations) + 4 hedged (DC, MN, MS, SC)
- **Agree: 22** — 5 Y with compatible citations (AZ, IL, MD, TX, VA) + 17 N

Correction to a prior expectation in the ticket: **IN is not a Y/N
disagreement** — all three passes say Y. The conflict is legislative
history (HB 1149/2023 vs HB 1604/2025, likely original law + expansion),
so IN sits in Partial. CA is the clean Y-vs-N case the ticket predicted.

### Data-quality flags found during parsing
- Pass 1's own arithmetic is off: it lists 28 states individually (incl. DC,
  PR) then lumps "Other 25 States" as N — 28+25 = 53 > 52. Only 24
  jurisdictions were actually unnamed. Implied-N rows are marked as such in
  the JSON and treated as weak evidence (pass 1's data also appears to
  predate 2025 enactments — see IA/ND).
- Passes 2 and 3 have **verbatim-identical Part 3 (prevalence) and Part 4
  (complaint patterns) text** — the "three independent passes" premise holds
  for the Part 1 law tables (clearly independent) but not for Parts 3/4.
  A2's fixtures are unaffected: all four complaint patterns also appear
  independently in pass 1's Part 4, so convergence holds via at least two
  independent passes.

## Method (as executed)

### B1 — Parse + diff
- `scripts/reconcile_state_law_passes.mjs`: tolerant markdown-table parser
  scoped to each file's Part 1 table; canonicalizes full names/codes to the
  52 jurisdictions; extracts per pass: has_law (Y/N/M), citation, effective
  date, ERISA scope, carve-outs, source. Pass 1's "Other 25 States" lump is
  expanded to IMPLIED N for unnamed jurisdictions (flagged, weaker than an
  explicit N). Each record also carries the current 010-seed value, so the
  review list shows consensus-vs-seed mismatches.
- Citation compatibility: statute-section/bill-number token matching;
  exact/shared tokens = compatible, subsection-level differences where both
  sides carry parentheticals (e.g. NY § 3216(i)(36) vs (i)(37)) = conflict.
  One false positive caught and fixed during verification (Maine title-level
  "24-A" fragment).

### B2 — Buckets
- **Agree**: all three passes same hard answer; for Y, citations compatible.
- **Partial**: Y-agree with conflicting/missing citations, or a hedged
  answer (M) with no hard conflict.
- **Disagree**: hard Y from ≥1 pass AND hard N from ≥1 pass.

### B3 — Loading rule (executes ONLY after go-ahead)

**Pre-application fix required (found 2026-08-11):** 010's `sources` INSERT
uses columns `retrieval_date` and `notes` — neither exists on `sources`
(schema.sql has `retrieved_at`, no `notes`). The file fails as written.
Fix to `retrieved_at`/drop `notes` (or fold the note text elsewhere) before
any apply.
- Every loaded row keeps `verification_status = 'secondary_aggregated'`,
  all buckets, no exceptions. Three agreeing secondary passes = secondary
  corroboration, not primary verification. Nothing upgrades to
  `verified_current` (that vocabulary belongs to `exploits` per db/012; the
  state table keeps its own 3-value status — see Addendum 2 of the build
  plan).
- New columns on `state_accumulator_ban_laws` (added to the unapplied 010
  file pre-application): `corroboration_count int` (0–3 agreement count),
  `source_pass_ids jsonb` (per-pass claimed answer + citation, for
  traceability).
- Each Disagree state also gets an `evidence_conflicts` row with each
  pass's claimed citation/answer as separate values. Requires db/012's
  polymorphic-subject design (subject_type='state_ban_law'); the
  verified_current hard-rule triggers do not apply to state subjects.
- Update path is an UPSERT against the 52 seed rows (fill
  corroboration/citation notes), never a delete-and-reseed.

### B4 — Output
- `docs/build-plans/state-law-review-priority.md`: **WRITTEN** (script-generated,
  regenerable on any corrected pass). Disagree bucket first (full detail:
  each pass's claim + citation + current seed value), Partial second, Agree
  as count + compact lists. This is the hand-verification worklist.

## Schema decisions already locked (recorded in build-plan Addendum 2)

- State table keeps `primary_source_verified`/`secondary_aggregated`/
  `unknown` status vocabulary (no 4-value enum swap).
- `corroboration_count` + `source_pass_ids` ship inside the 010 file before
  it applies (table still unapplied — no ALTER needed).
- db/012's `evidence_conflicts` gains polymorphic subject columns so state
  rows can carry conflicts without a fake exploit FK.

## STOP line

No writes to `state_accumulator_ban_laws` (or any live table) from this
reconciliation until the Disagree list has been hand-verified against
actual statute text and you give the go-ahead. The immediate next action
is yours: drop the three pass files into `docs/research/`.

## Out of scope (per ticket)

- No prevalence map hunting — three passes confirmed none exists publicly.
  SaveOnSP/PrudentRx get documented as vendor relationships in
  ARCHITECTURE.md's glossary (build-plan step 12), not stored as stats.
