# Drug data depth: top 200 drugs

**Owner:** Ryan Russell
**Date:** 2026-10-15
**Put this file at:** `docs/kimi/DRUG_DATA_TOP200.md`
**Use:** "Follow docs/kimi/DRUG_DATA_TOP200.md. Plan first, then STOP."
**Covers:** RUN_ORDER items 1 (finish S2) and 2 (drug data depth). After this, run `docs/kimi/free_data_loaders.md` Part A, then Part B.

## Why

Arik only knows 17 hand-entered drugs. To answer real questions it needs four layers for each drug:

1. **Identity:** what the drug is (names, strengths, forms, NDCs, brand vs generic).
2. **Benchmark:** what pharmacies pay for it (NADAC). Never shown as the patient's price.
3. **Patient paths:** the ways a patient can actually pay less (copay cards, assistance programs, manufacturer direct prices, Medicare negotiated prices, generics).
4. **Honest gaps:** when Arik has no patient-price path, it says so clearly and gives a useful next step.

## Ground rules

- Never invent data. Every row links to a `sources` row: publisher, URL, file version, retrieved date.
- NADAC is always labeled a benchmark ("what pharmacies pay"), never "your price," and is never ranked as a patient price.
- Unmatched NDCs and names are flagged for review, never guessed.
- Code numbers only, no CPT text. No scraping of commercial sites.
- Local loaders never write to the demo database. Remote data goes through the export/apply flow from the data-loading plan (`scripts/export_seed.mjs` and the guarded `apply_remote.mjs`).
- **Storage budget:** the demo database is on the Supabase free plan (500MB). Load only what the 200 drugs need, keep the latest NADAC plus about 12 weeks of history, and report the database size after each load.
- Tests use small fixture extracts. No network in tests.

## Step 0: Finish S2 (M05, M06, M07)

- Pick up where S2 stopped after db/025. The loader framework (price_sources, ingest_runs, adapters, the hardened HTTP client) is what every step below uses.
- Done when the S2 acceptance criteria pass, except M07-AC8 (the real partner adapter, which lives in the private repo).

## Step 1: The drug list

- Source: CMS **Medicare Part D Spending by Drug** (data.cms.gov), latest year, ranked by total spending. Take the top 200 by brand name and generic name.
- Add any drugs from the 25-drug brand list (the research CSV) that aren't already included.
- Store the rank, the year, and a link to the source row.

## Step 2: Identity

- **FDA NDC Directory** (product and package files): NDCs, strength, dosage form, package size, labeler, and marketing status. Normalize to 11-digit NDCs.
- **RxNorm** from the National Library of Medicine, to link brand and generic names, ingredients and strengths. Use a release that requires no UMLS license (verify which download that is) and record the release date.
- Flag anything that doesn't match cleanly in a review list.
- Done when: every drug has at least one confirmed NDC or is on the review list, and a spot check of 10 random drugs matches the FDA directory.

## Step 3: NADAC benchmark

- Weekly NADAC file from data.medicaid.gov. Load only the NDCs of the 200 drugs.
- Store the per-unit price, the pricing unit, the effective date and the as-of date.
- `npm run ingest -- nadac`, one `ingest_runs` row per run. Document the weekly schedule for the AWS cron later; don't deploy it.

## Step 4: Patient paths

- Keep the existing 23 programs and 22 price points.
- The brand-drug research CSV (25 drugs, already planned) feeds manufacturer programs and direct prices, marked unverified until Ryan or a reviewer checks them.
- Medicare negotiated prices: extend the existing ones to every drug on the CMS list that's in the 200.
- Generics with no program: no patient path yet (see Step 5).

## Step 5: What Arik says for benchmark-only drugs (needs Ryan's decision; recommendation below)

Recommended answer shape for a drug with only a NADAC benchmark:
- "I don't have a verified price you'd pay for this yet."
- "For reference, pharmacies pay about $X for a 30-day supply (NADAC, week of DATE). Cash prices are usually higher than that."
- One next step: for a generic, a short script to ask the pharmacy for its cash price and compare it with the copay; for a brand, "I'll check for manufacturer programs."
- The grounding guard treats the NADAC figure as a benchmark fact. It must never be phrased as the patient's cost.

## Step 6: Get it onto the demo

- Export the verified local data with `export_seed.mjs`, review the diff, then apply it with `apply_remote.mjs` (dry run first, then `--confirm`).
- Afterward: read-only row counts on the demo, `/api/health`, and three chat questions (a brand with programs, a generic, a benchmark-only drug).

## Tests

- Loaders on fixtures: Part D ranking, NDC directory, RxNorm links, NADAC
- Unmatched names and NDCs go to review and are never guessed
- NADAC is never ranked or worded as a patient price (ranking test plus a response-wording test)
- eval_ranking still 12/12
- Benchmark-only answers include the "no verified price" line and one next step

## Report (under 12 lines)

Plan first: sources and URLs to verify, tables and migrations, sizes, the expected database size, and Ryan's decision on Step 5. Then STOP for "go."
