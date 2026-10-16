# Plan: Phases 2, 3 and 4 together (intake, bill engine, letter engine)

**Status:** plan only, waiting for "go". Written 2026-10-16 from docs/kimi/PRODUCTION_PLAN.md.
**Goal:** the bill flow becomes real end to end on **synthetic documents**: a photo or PDF of a bill goes in, Arik reads it, the patient confirms, real rules find the problems, and a real letter comes out. Same screens as the demo walkthrough; DEMO_MODE keeps the scripted pieces. No real patient data, nothing sent.

## 1. Interfaces first (`lib/production/`), demo and real side by side

| Interface | Demo implementation (exists) | Real implementation (to build) | Contract tests |
|---|---|---|---|
| `DocumentSource` (get the file) | sample picker + fake camera (`lib/demo/sampleDocs.ts`) | upload/photo via the existing `/api/cases/[id]/documents` path | returns bytes + type + page count; refuses over 25 MB and unknown types |
| `Extractor` (read it) | stored extraction for each sample SVG | `lib/documentIntake.ts` text layer first, raster + model fallback, upgraded to return line items with page positions | same output schema for both; every field has a confidence and a page box |
| `BillChecks` (find problems) | fixture findings (`lib/walkthrough/flows.ts`) | `lib/rules/bills/*` pure checks | findings total = sum; every finding cites rule + data version |
| `LetterDrafter` (write it) | fixture letters (`lib/walkthrough/letters.ts`) | template + model draft + grounding guard + code fallback | footer present, names/dates/numbers grounded, no legal-advice wording |

The walkthrough Player keeps its screens; a `mode` switch picks the implementation per step. Contract tests run both implementations through the same assertions, so the demo can't drift from production.

## 2. Phase 2: real document intake

- **Output schema (`ExtractedDocument`):** `docType` (itemized bill, summary bill, EOB, denial letter, insurance card, pharmacy receipt, unknown), header fields (patient name as printed, provider, account number, dates of service, totals), `lines[]` (date, code as printed, description, units, charge, page, box `{x,y,w,h}` in page percent), and a per-field `confidence`.
- **Readers, cheapest first:** PDF text layer with positions (pdfjs text items carry coordinates); images and scans: OCR. **Decision for Ryan:** OCR engine. Recommendation: Tesseract (local, free, no data leaves the server) for now, with the model step only to structure the text; a BAA-covered vision model later (Phase 1 decides the provider). The model never sees real patient documents until that BAA exists; synthetic only until then.
- **"Here's what I read":** the existing summary step becomes editable fields and line items; "Looks right" stores a confirmed copy; nothing downstream runs on unconfirmed data (M09-AC4).
- **Highlights:** boxes come from the line positions, so the demo's highlighted-bill view works on real documents.

## 3. Synthetic document library (`scripts/synth_docs/`)

- A generator that writes realistic made-up bills, EOBs and denial letters as PDF (pdf-lib, already a dependency) and as photo-like PNGs (skew, blur, low contrast, shadows) with a ground-truth JSON beside each.
- Fictional names, providers and insurers only (the validator's real-name list applies); obvious SAMPLE marks; codes are real code numbers, no CPT descriptions.
- Planted problems with known answers: duplicate lines, room days vs dates, unbundled panels, unit limits over MUE, an unlisted "supplies" line, a facility fee.
- Size: about 60 documents to start (20 per type, 3 scan qualities). Extraction scored per field (exact match for numbers and dates); target and report the score, never tune on the test half.

## 4. Phase 3: bill review engine (`lib/rules/bills/`, pure)

Each check returns findings `{ lines[], tone: wrong | ask, amountUsd | null, plainText, ruleId, dataVersion }`:
- `duplicates`: same code, date and amount (exact); near-duplicates go to "ask".
- `roomDays`: room/board units vs admit and discharge dates (nights).
- `ncciBundling`: procedure-to-procedure edits; `mueUnits`: units over the MUE limit. **Data:** CMS NCCI PTP and MUE files, quarterly. **Size warning:** the full PTP tables are several million rows (likely 200 MB+), too big for the free demo database. Recommendation: load them into the local/AWS database only, and for the demo load only the edits for codes in the synthetic library. Ryan decides with Phase 1's database choice.
- `priceBenchmark`: line charge vs the Medicare Physician Fee Schedule / OPPS rate, worded only as a benchmark ("Medicare pays about $X for this"), never "you were overcharged by".
- `askAbout`: lines with no code, vague "supplies", facility fees.
- `noSurprises` and `charityCare`: build only after verifying the rules and thresholds against the federal text (No Surprises Act regulations; IRS 501(r) for nonprofit hospital financial assistance), quotes in code comments; until then they are listed as pending in the plan report.
- Total = sum of findings; every number passes the grounding guard; findings text is plain words (the existing walkthrough test that bans rule names in patient text carries over).

## 5. Phase 4: letter engine (`lib/letters/`)

- **Templates** per type: itemized bill request, billing dispute, hold-from-collections request, insurer appeal, records / medical-necessity request, financial assistance cover letter. Fixed structure in code; the model fills only the bounded paragraphs.
- **Guard:** names, dates, account numbers and dollar amounts must match the confirmed extraction and the findings; one regeneration, then the code-built fallback paragraph. Required footer ("Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice."); a banned-wording list (no legal-advice phrasing, no threats).
- **Versioning:** drafts editable; on send (still "Demo, not sent" here) the letter freezes: text hash stored, PDF rendered with pdf-lib, downloads exactly as frozen.
- Spanish: letters to institutions stay in English; the patient-facing explanation of the letter is EN/ES.

## 6. Database files this will need (flagged before use)

- `extracted_documents` + `extracted_lines` (confirmed copies, positions, confidence), `bill_findings`, `letters` (versions, frozen hash). One migration, next free number (db/037 or db/038 depending on the cash-vs-insurance plan).
- NCCI/MUE/PFS reference tables in a separate migration, local first; demo load only after the size check.

## 7. Order of work after "go"

1. Interfaces + contract tests with the demo implementations (no behavior change).
2. Synthetic document generator + ground truth.
3. Extractor (text layer with positions, then OCR) scored on the library.
4. Bill checks one by one (duplicates, room days, ask-about, then NCCI/MUE once the data decision is made, then price benchmark).
5. Letter engine + freeze/PDF.
6. Wire the real path behind the Player for non-demo mode; e2e on synthetic documents.
Each step: tests, gates, local commit, short report; stop for db files and decisions.

## Decisions for Ryan

- OCR engine for now (recommend local Tesseract; BAA vision model later).
- Where the full NCCI/MUE tables live (recommend local/AWS only; demo gets a trimmed set).
- OK to build No Surprises and charity-care checks only after the rule text is verified and quoted (recommended), not before.
