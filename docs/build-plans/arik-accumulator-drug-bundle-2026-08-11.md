# Build Plan — Accumulator Ban + Drug Bundle (audit of 2026-08-11)

Sources audited: `Arik_Accumulator_Ban_and_Program_Terms_Research.md`,
`Arik_Health_Drug_Bundle_Build_Ticket.md`, `010_state_accumulator_ban_laws.sql`
(duplicate `(1)` copy deleted per instruction; was byte-identical).
DB state verified read-only via direct Postgres against `iwayoxmpbueneagdkpzj`
(MCP confirmed still bound to MsJaneHH — no Arik SQL run through it).

## What's already built

- `schema.sql:235` `exploits` — eligibility_criteria jsonb, source_id, last_verified_at, processor/BIN/PCN cols; live, 16 rows, all sourced.
- `schema.sql:257` `accumulator_policies` — live, base columns only, **0 rows**.
- `schema.sql:223` `price_points` — live, 18 rows (list/negotiated only; no GoodRx-low rows).
- `schema.sql:78` `sources` — evidence_grade, effective/expiration dates, last_verified_at, next_review_due; live, 18 rows.
- `schema.sql:41` `user_matching_profile` — state, zip, insurance_type, plan name, income_bracket, household_size (ranking inputs).
- `app/api/chat/route.ts:173-301` — 3-step pipeline already retrieves exploits+prices+accumulator_policies; empty-retrieval short-circuit; `retrieved_exploit_ids` logged every assistant message.
- `chat_system_prompt.md:56` — trust-receipt block required on priced answers.
- `lib/resolveLocation.ts` — raw location → state/zip (feeds state-ban lookup).
- `lib/outcomes.ts` + `app/api/outcomes/route.ts` — patient-confirmed outcome recording.
- `lib/cases.ts` `assertLegalTransition()` + `scripts/test_transitions.ts` — pure-guard + test pattern to copy.
- `lib/deadlines.ts` — basis-text/unverified-source pattern the research pack wants mirrored for accumulator.
- `scripts/seed_exploits.mjs` — transactional source-per-exploit insert pattern (source_id always set).
- `scripts/check_exploits.mjs` — read-back skeleton to extend into KPI test.
- `010_state_accumulator_ban_laws.sql` — complete idempotent migration (table + RLS + 51-row seed + `state_has_accumulator_ban()` + `get_state_ban_type()`); **not yet applied, sits at repo root not `db/`**.
- `state_accumulator_bans_seed.csv` — same 51-row seed in CSV form.
- `db/004_grants.sql:33-37` — default-privileges already cover future tables; 010's RLS gives authenticated read-only (matches existing reference-table posture).
- `app/api/jobs/purge-expired-uploads/route.ts` — job-route pattern to copy; cron has only `purge-expired-cases`.

## What's partially built / needs modification

- `app/api/chat/route.ts` — accumulator rows retrieved unfiltered (all rows, all PBMs); no patient-profile filtering or ranking anywhere; the response model implicitly ranks from raw JSON. Needs deterministic filter/rank layer (ticket 1.3).
- `scripts/check_exploits.mjs` — report only; none of the ticket-1.7 KPI assertions exist.
- `scripts/validate_repo.py` — no source_id enforcement checks (ticket 1.2).
- `lib/cases.ts` / outcomes flow — outcome confirmation not wired into status transitions; `case_outcomes` has no `pharmacy_used` column (ticket 1.5 asks for pharmacy + amount + timestamp).
- `scripts/seed_exploits.mjs` — refuses to run when `exploits` is non-empty (line 229-234); bundle seeding needs a new idempotent script.
- `schema.sql` — must absorb the 010 table + any new columns (single source of truth).
- `SECURITY.md` — zero mention of the consent ledger (grep-verified); ticket 1.8 doc gap confirmed open.
- Edge Function deploy for purge job — still blocked (MCP → MsJaneHH reconfirmed today); `/api/jobs/purge-expired-uploads` runs it manually (ticket 1.1).
- `exploits` — no `medicare_legal` / `medicare_exclusion_reason` columns (live DB verified); both specs require them.
- `price_points` — no pharmacy/processor tag columns; ticket 2.1 requires per-pharmacy + BIN/PCN rows.

## What's not built at all

**Schema/migration**
- Apply 010 (move to `db/` first).
- Migration for `exploits.medicare_exclusion_reason` + `aks_citation_source_id` + `terms_citation_source_id` (research pack §2).
- Migration for `accumulator_policies` ban columns (state_code, ban_type, applies_to_market, source_statute_id, effective_date) (research pack §1).
- Migration for `price_points` pharmacy/processor tags (ticket 2.1).
- `case_outcomes.pharmacy_used` (if ticket 1.5 wired as written).
- **`db/011` and `db/012` referenced in 010's header do not exist** — no file, no DB function; `should_show_accumulator_warning()` is missing entirely (verified in `pg_proc`).

**Backend/API**
- Eligibility/ranking engine (`lib/`, pure function + tests, deadlines.ts style) — ticket 1.3.
- Accumulator suppression/warning logic consuming `state_has_accumulator_ban()` + `accumulator_policies`.
- App-layer source_id enforcement on inserts to `exploits`/`accumulator_policies`/`exception_precedents`.
- 30-day staleness flagging (manual version per ticket 1.4).
- Retrieval must add patient-state ban lookup to context.

**Frontend/UI**
- Accumulator warning surfacing in Thread/case UI (currently only prompt-level).
- Outcome-confirmation prompt at case resolution (one-tap pattern exists for corrections, not outcomes).

**Tests**
- KPI assertions in `check_exploits.mjs` (ticket 1.7).
- Accumulator suppressed-vs-flagged tests (research pack item 6).
- Ranking engine unit tests (test_transitions.ts style).
- Smoke for source_id enforcement rejection.

## Build plan

0. **Edge Function / MCP project retarget** — infra, owner action; MCP reconfirmed bound to MsJaneHH today. Blocked on account access, not code. *(Ticket says do first; flagging as blocked-on-you.)*
1. **Housekeeping** — move 010 → `db/010_state_accumulator_ban_laws.sql`; decide CSV duplicate. Files: the .sql, AGENTS.md file list. *Small. No deps.*
2. **Apply 010 + reflect in schema.sql** — apply via `scripts/run_sql.mjs`; add table to `schema.sql`; re-run validator. *Small. Dep: 1.* Assumption: sequence continues 009 → 010.
3. **db/011 bundle-schema migration** — exploits medicare columns, accumulator_policies ban columns, price_points pharmacy/processor tags, case_outcomes.pharmacy_used; mirror all in schema.sql. *Medium. Dep: open questions 1–2 (numbering collision risk if your missing 011/012 exist elsewhere).*
4. **source_id enforcement** — shared insert validator in `lib/` for exploits/accumulator_policies/exception_precedents + extend `validate_repo.py`. *Small. No deps.*
5. **Ranking/eligibility engine** — `lib/ranking.ts` pure `rankSavingsPaths()` (insurance type, %FPL income, state-ban suppression, accumulator warning flag) + `scripts/test_ranking.ts`; integrate into chat route between retrieval and response, preserving 3-step pipeline and `retrieved_exploit_ids` = post-filter ids. *Large. Deps: 2, 3.*
6. **Accumulator warning surfacing** — deterministic warning string into response context when ban doesn't protect the patient + accumulator row matches plan; Thread warning chip. *Medium. Dep: 5.*
7. **Bundle seed script + 3 bundles** — idempotent `scripts/seed_bundles.mjs` (source-per-row pattern); Dupixent, Zepbound, Eliquis rows per research pack §3 terms. *Large (research-gated). Deps: 3. Open question 5 on verification.*
8. **KPI test** — extend `check_exploits.mjs` with ticket-1.7 assertions (verified net < GoodRx low, source_id, medicare legality match, ≤30-day freshness). *Small. Dep: 7.*
9. **Outcome wiring** — prompt outcome confirmation on terminal case transitions; write amount/pharmacy/timestamp. *Small. Dep: 3.*
10. **SECURITY.md consent-ledger addition** — *Small. No deps.*
11. **Gates + docs** — `validate_repo.py`, `npm run build`, relevant smokes green; update AGENTS.md + HANDOFF.md status lines. *Small. Dep: all above.*

## Open questions

1. **Missing db/011 + db/012.** 010's header says db/012's `should_show_accumulator_warning()` exists and takes `p_state_has_ban` — nothing exists in repo or live DB. Do these files exist in another session/machine? If not, plan puts warning logic in TS (`lib/ranking.ts`) and keeps 010's SQL functions as data lookup only — confirm.
2. **Migration numbering/content.** Research pack says apply its patches "as db/010_accumulator_ban_and_medicare_reason.sql", but the provided 010 contains only the state table. Plan assumes the exploits/accumulator_policies ALTERs become a new db/011 — OK?
3. **medicare_legal boolean vs medicare_exclusion_reason enum.** Ticket KPI test wants a boolean match; research pack wants the 5-value enum. Plan assumes enum columns + derived boolean in code — OK?
4. **Monitor jobs conflict.** AGENTS.md scope discipline lists "the monitor job" as do-NOT-build; research pack item 4 asks for `/api/jobs/check-foundation-funds` (daily) + `/api/jobs/check-copay-terms` (weekly). Plan excludes them and relies on the KPI test's 30-day freshness assertion (ticket 1.4's "manual version"). Override?
5. **Bundle data verification.** Ticket 2.2 forbids agent-inferred medicare_legal/income values. Do you paste verified program terms for me to structure, or do I draft rows marked unverified pending Hunter/legal review?
6. **Income representation.** Profile has `income_bracket` (text); ranking needs %FPL math against exploit income_min/max. Store numeric %FPL on the profile, or fuzzy-map brackets? (Mapping is imprecise; PAP tiers are exact.)
7. **Zepbound program name.** Ticket says "LillyCompass copay card"; research pack says "Zepbound Savings Card". Which is correct for the seed?
8. **Eliquis second exploit.** Ticket says FDA Orange Book authorized-generic apixaban; research pack says Cost Plus $345/30-day. Both, or one?
9. **CSV duplicate.** `state_accumulator_bans_seed(1).csv` is byte-identical to `state_accumulator_bans_seed.csv` — delete it too? (You only authorized the SQL one.)
10. **accumulator_policies ALTER vs standalone state table.** Research pack proposes ban columns on `accumulator_policies` AND the new state table carries the same ban taxonomy — redundant. Plan assumes state-ban data lives only in `state_accumulator_ban_laws`, and `accumulator_policies` stays payer-policy-only (no ALTER) unless you say otherwise.
11. **price_points widening.** Adding pharmacy_name/underlying_processor/BIN/PCN to `price_points` (ticket 2.1 requirement) — any objection?

---

# ADDENDUM 2026-08-11 — decisions locked + evidence layer + docs steps

All 11 questions answered by owner; Parts B/C/D below incorporate them. CSV
duplicate `state_accumulator_bans_seed(1).csv` deleted (was byte-identical).

## Decisions locked (Part A answers)

1. Warning logic in `lib/ranking.ts` (TS); 010's SQL functions = data lookup only.
2. exploits ALTERs → `db/011` (no accumulator_policies ALTER per #10).
3. `medicare_exclusion_reason` enum is source of truth; derive `medicare_legal` boolean in code.
4. No monitor/cron jobs; 30-day freshness via KPI test only.
5. Real research exists for the 3 drugs → load via evidence-conflict pattern (Part B).
6. Add numeric `income_pct_fpl` to profile; ranking reads it only; keep `income_bracket` for UI.
7. Seed name: "Zepbound Savings Card" ("LillyCompass" = likely ticket error; I have no contradicting source).
8. Eliquis exploit #2 = Direct-to-Patient Program ($345/30-day, tier-2); Orange Book AG angle deferred.
9. CSV duplicate deleted.
10. No ALTER on `accumulator_policies`; ban data only in `state_accumulator_ban_laws`.
11. Widen `price_points` with pharmacy/processor tags.

## Part B pre-flight re-verification (against live schema)

- `state_accumulator_ban_laws` still unapplied → its status-field enum swap is a **file edit to 010 before applying**, not a migration. Small change: confirmed.
- `verification_status` appears nowhere in app code (grep-verified) → no code churn from the enum.
- `sources` already has `superseded_by`, `content_hash`, `evidence_grade` ('A'–'D'/'unverified' per METHODOLOGY.md — a **reliability** axis, different from the 7-tier **origin** hierarchy). Plan: add `sources.source_tier smallint` (1–7) in db/011 + document the grade↔tier mapping in ARCHITECTURE.md; no rename of `evidence_grade`.
- `evidence_conflicts` does not exist anywhere → genuinely new in db/011.
- `drugs` has `generic_available` but no biosimilar flag; `state_has_accumulator_ban()` takes `p_drug_has_biosimilar` → db/011 adds `drugs.has_biosimilar boolean` (nullable, never inferred).
- Found the untrimmed source ticket: `evidence-verification-layer-ticket.md`. Part B is its deliberate trim. **Parked, not built**: `evidence_sources`, `program_records`, `program_terms`, `program_eligibility` tables; computed `review_priority`; tier-8/community-signal rows (Grok X-posts get zero rows); review UI. If the flat `exploits` model strains under real data later, that ticket is the upgrade path.

## db/011 — single folded migration (replaces old step 3)

- `evidence_conflicts` — id, `exploit_id` FK, `field_name`, `value_a`/`value_b` (text), `source_a_id`/`source_b_id` FK→sources, `reason`, `resolved_at`, `resolved_value`, `resolution_note`, `created_at`. RLS: authenticated read, service_role write (reference-data pattern).
- `exploits` += `verification_status` (4-value enum, default `'unresolved'`), `patient_price_type` ('as_low_as'/'flat'/'range'), `patient_price_floor` numeric *(added — needed for "as low as $0" display + KPI math; cut if you disagree)*, `annual_max_savings`, `monthly_max_savings`, `field_confidence` jsonb, `superseded_by` self-FK, `medicare_exclusion_reason` (5-value enum, existing 16 rows backfill `'unknown'` — never inferred), `aks_citation_source_id`, `terms_citation_source_id`.
- `price_points` += `pharmacy_name`, `underlying_processor`, `bin_number`, `pcn_number`.
- `case_outcomes` += `pharmacy_used`.
- `user_matching_profile` += `income_pct_fpl numeric` (ranking reads this only).
- `sources` += `source_tier smallint` (1–7).
- `drugs` += `has_biosimilar boolean` (nullable).
- **Hard-rule trigger A** (BEFORE INSERT/UPDATE on exploits): reject any write where `verification_status != 'conflicted'` while an open conflict (`resolved_at IS NULL`) exists for that row. Human path = set `resolved_value`+`resolved_at` on the conflict first, then flip status. No code path can bypass — it's DB-level.
- **Trigger B** (AFTER INSERT/UPDATE on evidence_conflicts when a conflict is open/re-opened): force the parent exploit to `'conflicted'`. Invariant both directions: open conflict ⇔ conflicted.
- Mirror everything in `schema.sql`.
- 010 file edits before apply: swap its status CHECK to the same 4-value enum; map all 51 seed rows `'secondary_aggregated'`→`'unresolved'`; update header comment.

## Revised build order (supersedes steps 1–11 above where they conflict)

0. MCP/Edge Function retarget — owner action, blocked on account access.
1. Housekeeping: move 010 → `db/`; update AGENTS.md file list. *(CSV dup already deleted.)*
2. Edit 010 (enum swap) → apply via `run_sql.mjs` → reflect in schema.sql → validator green.
3. Apply db/011 (full folded contents above) → schema.sql mirror → validator green.
4. source_id app-layer enforcement (`lib/` insert validator + `validate_repo.py`).
5. `lib/ranking.ts` pure `rankSavingsPaths()` + `scripts/test_ranking.ts`; chat-route integration between retrieval and response; `retrieved_exploit_ids` = post-filter ids; trust receipt preserved.
6. Accumulator warning surfacing (context string + Thread chip), honoring open question A below.
7. `scripts/seed_bundles.mjs` (idempotent, source-per-row): 2 new drugs + 7 exploits + sources (tier-tagged) + price_points incl. GoodRx-low benchmarks + the 3 evidence_conflicts fixtures. Statuses exactly per Part B: Dupixent ×2 `verified_current`; Zepbound not-covered `conflicted` w/ NULL `annual_max_savings`; Zepbound covered `conflicted` w/ $150 provisionally trusted; Eliquis copay `conflicted` w/ $2,000 provisionally trusted; Eliquis trial + DTP `verified_current`. Seed script never sets `resolved_value`.
8. `check_exploits.mjs` KPI assertions (verified net < GoodRx low, source_id, enum-derived medicare legality, ≤30-day `last_verified_at`) + **permanent Zepbound not-covered fixture**: assert `conflicted` + NULL trusted value forever.
9. `scripts/test_evidence_integrity` — hard-rule regression: flip-to-`verified_current` on a conflicted row is rejected; resolve-then-flip succeeds; self-cleaning fixtures.
10. Outcome wiring on terminal transitions (+ `pharmacy_used`).
11. SECURITY.md consent-ledger addition; gates green (`validate_repo.py`, `npm run build`, relevant smokes); AGENTS.md/HANDOFF.md status lines.
12. **Part C — `docs/ARCHITECTURE.md`**: 1-paragraph summary; ASCII data-flow (request → retrieval → ranking → response, trust-receipt point marked); table-purpose glossary (exploits, price_points, accumulator_policies, sources, state_accumulator_ban_laws, evidence_conflicts, user_matching_profile); concept glossary (accumulator, maximizer, %FPL, verification_status states, source tiers, medicare_exclusion_reason values); "where do I find X" index. <10-minute read; link out, don't duplicate.
13. **Part D — commenting standard** (short `docs/CODE_COMMENTS.md` or ARCHITECTURE.md section; header comments = what/calls/called-by, function comments = why-not-what, skip boilerplate) applied to the prioritized list only: `lib/ranking.ts`, `assertLegalTransition()`, chat route, seed scripts, `check_exploits.mjs`, evidence_conflicts logic. Report files touched as a short list.

## New open questions (from Part B integration)

A. **Suppression on unverified state rows.** After the enum swap, ALL 51 state rows are `'unresolved'` (secondary-sourced). `state_has_accumulator_ban()` returns TRUE for enacted rows regardless. Recommend: ranking never *silently suppresses* the accumulator warning on `'unresolved'` data — it softens it ("your state may ban this — unverified") until `verified_current`. Confirm.
B. **Backfill status of existing 16 exploits.** They were seeded from real manufacturer pages 2026-07-24 but are now >30 days old. Recommend `'verified_historical'` (literally what they are) rather than `'unresolved'`. Confirm.
C. **`patient_price_floor` addition** beyond Part B's explicit column list (rationale in db/011 section above). Cut?
D. **Eliquis DTP price range.** Full ticket notes DTP pricing is a range across day-supply tiers; your trim says ship $345/30-day. Plan: `patient_price_type='flat'`, floor $345 now; additional day-supply price rows later if needed. OK?

---

# ADDENDUM 2 — 2026-08-11 (reconciliation-ticket deltas)

Part A of the state-law reconciliation ticket shipped today:

- **db/011 is now TAKEN and APPLIED**: `db/011_reduced_if_maximizer_detected.sql` adds `exploits.reduced_if_maximizer_detected` (boolean, nullable; null = not yet checked). Live-verified; schema.sql mirrored; validator + `npm run build` green. **The folded evidence migration renumbers db/011 → db/012** everywhere above.
- **A2 shipped**: `scripts/eval_fixtures.mjs` — the four complaint-pattern fixtures (card rejected at counter, quoted≠charged price, accumulator deductible cliff, fund closes), generalized, no PHI, shape self-check green. Consumed by the Phase 5 harness; the Zepbound DB-backed fixture joins this file at steps 7–8.

Plan changes forced by the reconciliation ticket (these WIN over Addendum 1 where they conflict):

- **Enum reversal**: `state_accumulator_ban_laws` KEEPS its original 3-value status (`primary_source_verified`/`secondary_aggregated`/`unknown`). Reconciliation ticket B3 explicitly loads rows as `'secondary_aggregated'` — the 4-value-enum swap proposed in Addendum 1 is **withdrawn** for this table. `exploits.verification_status` (4-value) still ships in db/012; the two tables use different status vocabularies deliberately (state rows are legal-facing and need primary-statute verification; exploit rows use the evidence-layer states).
- **010 gains two columns pre-application** (file edit, table still unapplied): `corroboration_count int`, `source_pass_ids jsonb` — per reconciliation B3.
- **db/012 design change**: `evidence_conflicts` needs a polymorphic subject (`subject_type` + `subject_ref`, not a bare `exploit_id` FK) so "Disagree"-bucket state rows can carry conflict records per B3. Hard-rule triggers fire only for exploit subjects; state rows never auto-flip (their status stays human/primary-source-gated).
- **Step 12 (ARCHITECTURE.md) glossary note**: document SaveOnSP and PrudentRx as known vendor relationships (which programs exist, affiliations), explicitly NOT prevalence statistics — three passes confirmed no public state-by-state prevalence map exists; stop searching for one.
- **db/012 is now TAKEN and APPLIED**: `db/012_counter_override_guidance.sql` (Ticket 1 — pharmacy counter-reality checklist, NCPDP 308-C8 values, 9 rows, source_id NOT NULL at the DB level). **The folded evidence migration renumbers db/012 → db/013** everywhere above.
- Validator now warns that the three ticket .md files aren't referenced in HANDOFF.md (0 failures) — clear at step 11 status updates.

---

# ADDENDUM 3 — 2026-08-11 (open questions A–D RESOLVED by owner; reviewer: Ryan)

- **A — confirmed with an enforcement addition.** Soften, never suppress, on unresolved state rows. Since the enum swap was withdrawn, ALL 52 state rows are secondary/unverified — the soft-warning path is the DEFAULT for every patient, not an edge case: hedge copy is primary UI and gets real review. **Call-site rule for the ranking engine (step 5):** every caller of `state_has_accumulator_ban()` must also read `verification_status` before rendering — the SQL function has no confidence awareness, so the pairing is required at every call site, not assumed.
- **B — NOT confirmed; revised.** The 16 exploits keep `verified_current` with `last_verified_at` 2026-07-24 (a freshness gap, not a supersession — `verified_historical` is reserved for known-changed values). The real gap was the missing staleness mechanism: **built as `scripts/check_staleness.mjs`** (30-day window, null = never-verified, exit 1 on any stale row). First run already fired: the two seed_drugs sources rows (CMS negotiation + list-price compilation) have NEVER been verified — they're what back the 18 price_points. The 16 exploits are inside the window today and cross it 2026-08-23. **Correction of record:** my Addendum-1 claim that the rows were ">30 days old" was my arithmetic error — 2026-07-24 → 2026-08-11 is 18 days. Nothing in the docs relied on the wrong number beyond that question's wording.
- **C — confirmed.** `patient_price_floor` stays (the "as low as $25 ≠ a $25 price" distinction).
- **D — changed and SHIPPED.** All four Eliquis DTP tiers seeded via `db/013_eliquis_dtp_tiers.sql`: $345 (30-day/60 tabs), $426 (30-day/74 tabs), $690 (60-day), $1,035 (90-day) — `price_points.unit_count` added to split the two 30-day tiers; new `price_type='direct_to_patient'`. Sources row = BMS/Pfizer announcement (establishes the program; tier numbers from owner's verified pull — stated in the migration header). Applied + verified idempotent; schema.sql mirrored. **The folded evidence migration renumbers db/013 → db/014.**
- **010 fixed pre-application** (owner-required): sources INSERT now uses `retrieved_at` (was nonexistent `retrieval_date`), drops the nonexistent `notes` column (text moved to a comment), and is URL-guarded for true idempotency. B3's `corroboration_count` + `source_pass_ids` columns added to the CREATE TABLE in the same pass.
- **Ticket 1 approved as built**; `source_id NOT NULL` on new sourced tables is now the standing standard (already applied in db/012; db/014 will follow it).
