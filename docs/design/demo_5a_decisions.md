# Demo 5a: decided requirements (collected 2026-10-14)

Everything the owner has decided for demo mode 5a, in one place, so the
build session starts from this page. Build order:
persona → program call card (item 4) → 5a. Prompt files: the bills and
denials walkthrough in `docs/kimi/`, plus the plan answers below.

## Sample patients

- **The picker:** "Try a sample patient" on the demo's start screen. There are 4 or 5 fictional patients, each showing a different feature:
  - prescription savings
  - bill review (with a sample itemized bill)
  - a denial plus appeal letter
  - caregiver mode
  - Agent action receipts
- **Labels:**
  - "Sample case" / "Sample patient, fictional" on every sample screen.
  - Outcomes carry an "Illustrative example" tag.
  - Every sample document carries a subtle "SAMPLE" watermark.
- **Real prices only:** patients and bills are made up, but drug prices come from real sourced data. If a price isn't loaded, the case says so; never invent one.
- **Fictional names only:** no real insurer, hospital or PBM names, logos or letterhead anywhere in sample documents.

## Temporary sample accounts (change of 2026-10-14)

- **Lifetime:**
  - The sample session id lives in `sessionStorage` only.
  - Closing the tab or leaving the site ends it; reopening the demo gives a fresh copy of the canned account.
  - Moving between pages and refreshing keep the changes.
- **Server side:** sample cases and every child row (messages, actions, letters, receipts, uploads, findings) are deleted by a pg_cron job after **60 minutes idle**. They're also deleted right away on **Reset** or when the visitor starts a new sample.
- **Never kept:** samples never get the "Save your results" upgrade and are never kept under the patient-home retention rules. Outcomes, savings totals and any employer rollup exclude them (`cases.is_sample`).
- **Tests:**
  - A sample session's rows are gone after the idle purge.
  - A new session never sees another visitor's changes.
- **Design note for the build:** the anonymous auth cookie is shared across tabs, so samples are keyed by the per-tab sample session id, not just the user id. Two tabs means two independent sample copies.

## Canned history (change of 2026-10-14)

- **Past jobs:** each sample patient has 1 to 3, each with a full timeline:
  - documents received (bills, EOBs, denial letters)
  - letters Arik prepared
  - the "sent" receipt (Demo, not sent)
  - a reply from the other side
  - the outcome
- **Letters from Arik are real output:** generated once with the actual letter engine from the fictional facts and stored as fixtures. Never hand-written.
- **Everything else is fictional:** bills, EOBs and insurer and provider replies, with made-up company, hospital and doctor names.
- **Documents open with a working PDF download.**
- **History is part of the canned template,** so it resets with the 60-minute purge and with Reset.

## Bills and denials walkthrough (answers of 2026-10-14)

1. **Two bills from the same visit:** a hospital bill (room-day count, duplicate checks) and a doctor's bill (NCCI bundling and unit limits against the physician tables, plus the "Medicare pays about $X" benchmark from the physician fee schedule).
2. **Extraction:** the stored (canned) extraction by default, with live extraction optional.
3. **"Looks right" confirm:** one tap before any check runs (M09-AC4), written as Arik double-checking with the patient.
4. **Code location:** the checks live in `lib/rules/bills/` (spec Appendix B3). The spec is not changed.
5. **Letters:** on screen and stored now; PDF download later. The canned-history change above needs PDFs for sample documents, so the PDF library decision (patient home plan, open question 5) comes forward into 5a.
6. **Denial plan type:** a non-grandfathered employer plan. Appeal and external-review rules verified on eCFR (29 CFR 2560.503-1, 45 CFR 147.136). KFF figures shown labeled as Marketplace data, with year and source.
7. **Cost:** about $0.10 to $0.20 of live letter drafting per demo run, inside the anonymous daily cap.

## Phone

- **"Snap your bill"** uses `<input type="file" accept="image/*" capture="environment">` so it opens the camera on phones (mobile pass of 2026-10-14).
