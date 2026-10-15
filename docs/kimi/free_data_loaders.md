# Kimi build prompt: Free data loaders (denials + coverage)

**Owner:** Ryan Russell
**Date:** 2026-10-12
**Put this file at:** `docs/kimi/free_data_loaders.md` (not the repo root; the validator flags root docs that reference files in other folders)
**Schedule milestone:** "Free data loaders: denials + coverage" (Stage S3)
**Spec:** ARIK_MASTER_SPEC.md M13-AC1, M13-AC4
**Source details:** `docs/research/arik_free_data_sources.md` (entries D1, D2, V1)
**Run after:** S2 run 1 is committed (the `ingest_runs` table must exist)

Work locally, small commits, do not push. Token rules as before: targeted reads only, batched commands, pass/fail summaries, no pasted logs. Stop and report if any step exceeds 4 minutes.

Do this in **two parts**. STOP after Part A, report, and wait for the go-ahead.

---

## Prerequisites (check first, stop if missing)

- S2 run 1 is committed and `ingest_runs` exists.
- `docs/research/arik_free_data_sources.md` is in the repo.

If either is missing, stop and tell me which.

---

## Ground rules

- **Never invent data.** No seed rows with made-up numbers. Templates and fixtures only, clearly marked as fixtures.
- **Every stored row links to a `sources` row:** publisher, URL, retrieved date, and plan or report year.
- **Code numbers only.** Strip any CPT descriptions from CMS files (`CPT_DISPLAY_ENABLED` stays false).
- **Do NOT ingest California IMR data (registry D3).** Commercial use needs approval first.
- **Tests use small fixture extracts.** No network in tests.

---

## PART A: Insurer denial data + AI lookup tools

1. **Sources rows** for D1, D2 and V1, using the publisher, URL and Arik label from the registry.
2. **D1 Transparency in Coverage PUF loader.**
   - Verify the current PY2026 ZIP URL on https://www.cms.gov/marketplace/resources/data/public-use-files and read its data dictionary.
   - Table `payer_denial_stats`:
     - issuer id and name, state
     - plan year: the year the data covers, not the year of the file
     - claims received and denied, in-network and out-of-network
     - counts for each denial reason
     - internal appeals and how many were upheld, external appeals
     - suppressed values stored as null with a `suppressed` flag
   - Run it with `npm run ingest -- tic_puf`, writing one `ingest_runs` row per run.
3. **D2 prior auth report cards.**
   - Table `prior_auth_metrics`:
     - payer; program (MA / Medicaid / CHIP / QHP); reporting level (contract / state / plan / issuer); state; report year
     - % of standard requests approved, denied, and approved after appeal
     - % of expedited requests approved and denied
     - average and median decision days, with units as reported
     - source URL, retrieved date, `captured_by` (manual | auto)
   - Add a CSV import command and a blank template CSV in `docs/research`. Include one row marked EXAMPLE, and make sure the import skips it.
   - No scraping yet. Ryan fills the template by hand from insurer websites.
4. **AI lookup tools** in `lib/data/`:
   - `getInsurerDenialStats(issuer, state)`
   - `getPriorAuthMetrics(payer, program, state)`
   - Each returns the values plus the source label, URL and data year, or "no data".
   - Add their results to the grounding guard's allowed facts.
5. **Tests:**
   - the loader on a fixture
   - suppressed-value handling
   - template import, with the EXAMPLE row skipped
   - lookups return their source and year
   - the response layer never phrases these numbers as a patient's own chance of denial (for example "X% chance your claim is denied")

Commit, then **STOP** and report.

---

## PART B: Medicare coverage rules (run when told)

6. **V1 Medicare Coverage Database weekly loader.**
   - Download the "Current LCD", "Current Article" and "Current NCD" CSV packages from https://www.cms.gov/medicare-coverage-database/downloads/downloads.aspx
   - Load them into `policy_documents` (create it per M13-AC1 if it's missing) with these fields:
     - document type, id, version, title
     - contractor or jurisdiction
     - effective and retirement dates
     - code lists (numbers only)
     - source URL, retrieved date, next check date
   - Strip embedded HTML. Keep only the passages needed for citations.
7. **`getCoverageRule(code or drug, state)`** lookup tool, returning the matching NCD or LCD with its id, version and date.
8. **Document the weekly schedule** as a job the AWS cron will run later. MCD publishes on Thursdays. Don't deploy anything.
9. **Run the checks:** tests, validator, tsc, `npm test`. Commit.

---

## Report (after each part, under 12 lines)

- Tables created
- Rows loaded (counts only, no values)
- Test results
- Anything UNVERIFIED
