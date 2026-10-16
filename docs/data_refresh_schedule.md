# Data refresh schedule

When each public data source is refreshed, the command that does it, and how long it takes. Nothing here is deployed yet: these are the job definitions for the AWS scheduler (S4). Every loader writes to a **local** database only and records one `ingest_runs` row per run. The demo database gets the result through `scripts/export_seed.mjs` and the guarded `scripts/apply_remote.mjs`, dry run first.

| Source | Publisher cadence | Job | Command | Last run (local) |
| --- | --- | --- | --- | --- |
| Medicare Coverage Database: LCDs, Articles, NCDs (registry V1) | Weekly, Thursdays | Thursdays 12:00 ET | `npm run ingest -- mcd` | 3,382 documents, about 1 minute with downloads |
| NADAC, latest week plus 12 weeks (registry C1) | Weekly | Thursdays 12:00 ET | `npx tsx scripts/load_drug_data.ts nadac` | 44,456 weekly rows, 47 s |
| FDA NDC Directory (identity for the top 200) | Daily file; monthly is enough | 1st of the month | `npx tsx scripts/load_drug_data.ts ndc` then `rxnorm` | 16,078 NDCs, 36 s |
| CMS Part D Spending by Drug (the top 200 list) | Annually | When CMS posts a new data year | `npx tsx scripts/load_drug_data.ts partd` then `ndc`, `rxnorm`, `nadac` | data year 2024 |
| Transparency in Coverage PUF (registry D1) | Annually (new plan year each fall) | October 1 | `npm run ingest -- tic_puf --year <plan year file>` | PY2026 file, 374 issuer rows |
| Prior authorization metrics (registry D2) | Annually by March 31 | April, by hand from payer sites | `npm run ingest -- prior_auth --file <metrics.csv>` (template: `docs/research/prior_auth_metrics_template.csv`) | none yet |
| Census ZCTA gazetteer (zip centroids) | Annually | January | `npx tsx scripts/load_drug_data.ts zips` | 2025 file, 33,791 zips |
| Medicare unit limits (NCCI MUE, practitioner + outpatient hospital) and Physician Fee Schedule RVU file (bill checks, db/039) | Quarterly (Jan, Apr, Jul, Oct 1) | First week of each quarter; update the file names in `scripts/load_bill_refs.ts` | `npm run ingest -- bill_refs` | 2026 Q4: 15,212 + 15,162 limits, 8,599 fee amounts, 1 s |
| NCCI procedure-to-procedure pairs (bill checks) | Quarterly | Blocked: the CMS files sit behind the AMA license page. After the owner accepts it and saves the unzipped files: | `npm run ingest -- bill_refs --ptp-dir <folder>` | not loaded |

## Rules for every job

- Every network call has a timeout; a job that hasn't finished in 4 minutes is stopped and reported, never retried in a loop.
- A failed run leaves the previous data in place (each load is one transaction) and its `ingest_runs` row says `failed` with a short reason, never a payload or a price.
- MCD loads replace the current set: a document that drops out of the "current" packages is removed.
- NADAC's dataset id changes every January; the loader finds the current year's dataset by title.
