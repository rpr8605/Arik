# Kimi build prompt: Prescription routing (M24)

**Owner:** Ryan Russell
**Date:** 2026-10-13
**Put this file at:** `docs/kimi/rx_routing_build.md`
**Spec:** adds module M24 to ARIK_MASTER_SPEC.md (Part A, step 1)
**Run after:** S2 is committed (`price_sources`, `pharmacies`, `ingest_runs` exist)

Work locally, small commits, do not push. Token rules as before: targeted reads only, batched commands, pass/fail summaries, no pasted logs. Stop and report if any step exceeds 4 minutes.

Do this in **two parts**. STOP after Part A, report, and wait for the go-ahead.

---

## What this is

Brand-name drugs are increasingly cheapest through **manufacturer direct-to-consumer (DTC) cash programs**. Those programs only work if the prescription is sent to the program's own pharmacy. Arik is not a prescriber and never sends prescriptions itself. Instead Arik:

1. knows the DTC programs and their cash prices,
2. decides with the rules engine whether cash beats the patient's insurance,
3. prepares the request that gets the prescription routed to the winning pharmacy, and
4. later plugs into an outside routing partner through a neutral adapter.

## Prerequisites (check first, stop if missing)

- S2 tables exist: `price_sources`, `pharmacies` (with NPI and NCPDP ID), `ingest_runs`.
- The M16 action registry exists. If it does not, build steps 4 and 5 as pure functions with tests, add the two action types to the M16 plan in the spec, and report that the registry wiring is pending.

Tell me which prerequisites are missing before doing anything else.

## Ground rules (non-negotiable)

- **No money for routing, ever.** Arik takes no fee, rev share, referral payment, data fee or favor from any pharmacy, PBM, manufacturer, discount network or routing partner. This is enforced in code (Part B, step 9) and in tests.
- **Partner confidentiality.** Never write a partner's name, terms, prices or API details in this repo, fixtures, commits or logs. Say "routing partner." The real partner adapter lives in a separate private repo.
- **Never invent data.** No made-up programs or prices. Templates and clearly marked fixtures only.
- **Decisions come from the rules engine, never the model.** That covers cash vs insurance, eligibility, and Medicare/Medicaid blocks.
- **Arik never makes a clinical decision.** Same drug, same strength, same quantity, or the patient's prescriber decides.
- **Tests use fixtures. No network in tests.**

---

## PART A: Manufacturer direct prices + routing requests (Stage S3)

1. **Spec update.** Add `### M24. Prescription routing` to ARIK_MASTER_SPEC.md:
   - Purpose, hard rules (the ground rules above), and an acceptance table built from steps 2 to 7 (Part A, stage S3) and steps 8 to 11 (Part B, stage S5).
   - Add M24 Part A and the mock-tested Part B to the S3 gate. Add the live routing partner connection to the S5 gate.
   - Under 7.2 open questions: the routing partner data use agreement, and which DTC programs exclude government-insured patients.
   - Run the validator.

2. **`dtc_programs` table** (next free migration number in `db/`):
   - manufacturer, program name, drug, NDC (11-digit, normalized), strength, form, package size
   - cash price per fill and per 30 days, price effective date
   - `requires_eprescription` (bool)
   - destination pharmacy: name, NPI, NCPDP ID, phone, fax, address, mail-order (bool)
   - `counts_toward_deductible`: enum yes / no / unknown, default **unknown**
   - `federal_program_allowed`: enum yes / no / unknown, default **unknown** (Medicare, Medicaid, TRICARE, VA)
   - eligibility notes, `source_id` (FK to `sources`: URL, retrieved date), `verified_by`, next check date
   - Every row links to a `sources` row.

3. **CSV import + template.**
   - Command: `npm run ingest -- dtc_programs <file.csv>`, writing one `ingest_runs` row per run.
   - Blank template in `docs/research/dtc_programs_template.csv` with one row marked EXAMPLE, which the import skips.
   - No scraping. Ryan fills the template by hand from manufacturer and government program pages.
   - Unmatched NDCs are flagged, never guessed.

4. **Cash vs insurance rule** (rules engine, `lib/rules/cashVsInsurance.ts`). Inputs: DTC cash price, the patient's estimated plan cost, deductible status if known, `counts_toward_deductible`, `federal_program_allowed`, and the patient's coverage type. Outputs: `use_cash`, `use_insurance` or `ask_patient`, plus a plain-language reason code.
   - Government-insured patient and `federal_program_allowed` is not `yes` → never recommend the DTC program. Reuse the existing Medicare hard-block pattern.
   - `counts_toward_deductible = unknown` → the result must include the caveat: "this payment may not count toward your deductible."
   - Plan cost unknown → `ask_patient`, never a guess.
   - DTC programs enter ranking as a normal price source. Same rules as every other source.

5. **Routing request documents** (Agent actions; prepare only in S3, nothing leaves the system):
   - `rx_routing_request`: a one-page request to the prescriber's office asking them to send a new e-prescription to the destination pharmacy. It includes the patient name and DOB, the drug, strength, quantity and directions exactly as on the current prescription, and the destination pharmacy's name, NPI, NCPDP ID, address, phone and fax. Wording: "At the patient's request, please send this prescription to…". Nothing that reads as clinical advice.
   - `rx_transfer_request`: a pharmacy-to-pharmacy transfer request, for when the drug is already on file somewhere.
   - Controlled substances: no transfer requests. Mark the step "talk to your pharmacist or prescriber" and explain why.
   - Pre-fill from confirmed facts only. Patient approval required (M16-AC5). Receipt and audit row for each action (M16-AC6).

6. **Patient explainer.** When a DTC price wins, the response shows:
   - the DTC price and the patient's plan estimate side by side,
   - the deductible caveat when it applies, and
   - the next step: Arik prepares the request for their doctor's office.
   - Add these results to the grounding guard's allowed facts. The trust receipt lists the program source and date.

7. **Tests:**
   - DTC import, with the EXAMPLE row skipped
   - government-insured patient never gets a DTC recommendation
   - unknown deductible status always shows the caveat
   - unknown plan cost returns `ask_patient`
   - routing and transfer documents contain the pharmacy identifiers and no unconfirmed fields
   - controlled substances block transfer requests
   - grounding guard accepts DTC facts and rejects invented prices

Commit, then **STOP** and report.

---

## PART B: Routing partner adapter, neutral by design (run when told)

Build and test all of Part B now against the **mock provider only**. Connecting the real routing partner waits for three things: S4 security is passed, a signed data use agreement, and the partner's API docs. The real adapter is then built in the private repo from those docs and must pass the same contract tests. Until then `enabled = false` for every routing partner.

8. **`RxRoutingProvider` interface** in `lib/routing/`:
   - `listDestinations(ndc, location)`
   - `quote(ndc, qty, destination)`
   - `createRoutingIntent(caseId, destination)`
   - `getStatus(intentId)`
   - Results are validated at the boundary.
   - Reuse the M07 hardened HTTP client and config-driven adapter template.
   - Add a local mock provider covering: valid, 401, 429, 500, timeout, malformed, and unknown NDC.
   - Add a kill switch and a one-command purge.

9. **`routing_partners` table + neutrality enforcement:**
   - Columns: `partner_label` (no real names in this repo), `enabled`, `allow_patient_display`, `allow_ai_processing` (both default false), `compensation_to_arik` with one allowed value: `none`, enforced by a DB check constraint, and the data use agreement date.
   - **Neutrality test:** ranking output must be identical when a destination's partner affiliation is toggled on or off, with prices held equal. Ranking may read only price, source, freshness and patient constraints, never partner identity.
   - **No-payment test:** any attempt to store a non-`none` value for `compensation_to_arik` fails.

10. **Disclosure.** Add a public `/how-we-route` page listing every enabled routing partner by public label, and stating that Arik receives nothing for routing. It must be generated from the `routing_partners` table, not hand-written.

11. **Run the checks:** tests, validator, `tsc`, `npm test`. Commit.

## Not in scope (do not build)

- Arik sending e-prescriptions, becoming a prescriber, or integrating an e-prescribing vendor directly. That would make Arik a clinical company and is a separate decision for Ryan.
- Scraping manufacturer or government sites.
- Any revenue, fee or reporting tied to prescription volume or destination.

## Report (after each part, under 12 lines)

- Tables created
- Rows loaded (counts only, no values)
- Test results
- Anything UNVERIFIED
- Prerequisites that were missing
