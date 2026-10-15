# Demo day: full demo in one day

**Owner:** Ryan Russell
**Date:** 2026-10-15
**Put this file at:** `docs/kimi/DEMO_DAY.md`
**Use:** "Follow docs/kimi/DEMO_DAY.md, stage N."
**Runs after:** FIRST_RUN_AND_BRAND.md is committed.

## Goal

By tonight, the live demo shows **every feature** with sample patients: Rx savings, calling for you, caregiver mode, bill review, denial appeal, letters and job history.

This is a **demo-day cut** of the plans already approved (call card, demo 5a, DEMO_BILLS_DENIALS.md). Same rules, smaller scope. Anything cut is listed at the bottom and comes back later.

## How to work today

- **Five stages, in order.** Each one must leave the demo working and showable on its own.
- After each stage: tests pass, commit, report in under 8 lines, and **ask Ryan "push?"** Push only on his yes. Then start the next stage.
- If usage runs low, stop at the end of a stage, never mid-stage.
- Keep test output to pass/fail counts. Don't re-read files you just wrote.
- All existing rules hold: grounding guard on every number, no invented prices, made-up names only for sample people and companies, no real insurer or hospital names, nothing actually sent, no em dashes, no partner names.

---

## Stage 1: Sample patients, picker and temporary sessions

- DEMO_MODE switch (Vercel demo only).
- A "Try a sample patient" picker on the welcome screen (the starter button from FIRST_RUN_AND_BRAND).
- Temporary sessions: sessionStorage id, 60-minute idle purge with pg_cron, and a Reset button. `is_sample` is excluded from all totals.
- Five fictional patients, each labeled "Sample patient, fictional":
  1. **Maria, uninsured, on Eliquis**: Rx savings.
  2. **James, caring for his Medicare mom**: caregiver mode. The Medicare copay-card block must show.
  3. **Dana, employer plan, on Zepbound**: the pricing conflict plus a manufacturer direct price (if the data is loaded; otherwise the honest "not loaded" path).
  4. **Luis, ER visit bill**: bill review (stage 3).
  5. **Tasha, denied MRI**: denial appeal (stage 4).
- A simple **"Past jobs" list** on each sample patient (just a list, not the full patient home): job name, status chip, date, outcome with an "Illustrative example" tag.

### Added to stage 1 (owner, 2026-10-15)

- **Home copy:** settings move behind a gear in the header (44px) next to EN | ES, including "How Arik talks to me". Case cards in plain words (bold drug or topic, one line on what's happening, one on what to tap), every internal status mapped in one place (`lib/caseCard.ts`) with a test that no raw status reaches the screen. Chat box placeholder: "Ask about a prescription, a bill, or a denial." Jargon audit of home, case and chat screens.
- **Chat polish:** bubbles (patient right, Arik left with the A mark); a "+" next to the reply box replaces the "Add a document" card; case header shows the drug in title case and the plain status line.
- **Demo document picker (DEMO_MODE only):** "+" opens a "Sample documents" sheet styled like a phone photo library. Only our fictional documents, with a SAMPLE tag: Luis hospital bill, Luis doctor bill, Tasha denial letter, Tasha EOB, plus a sample pharmacy receipt and insurance card if they exist. Missing ones stay hidden. "Take a photo" is a fake camera view (frame, shutter, the sample bill in view). Picking plays the scan animation and routes into bill review or denial. No upload, no storage write; the server refuses real uploads in DEMO_MODE (tested). Outside DEMO_MODE, real upload is unchanged. The picker shell ships in stage 1; the documents and their flows are filled in during stages 3 and 4 (`lib/demo/sampleDocs.ts`).

## Stage 2: Call card (lite)

- Replace the bare phone number with the program call card:
  - Call now (tel: link)
  - "Before you call": a fixed script (English and Spanish) in the persona voice; the details they'll ask for, from stored facts labeled "From what you told Arik. Check before you call"; and the program's hours or "Hours not on file"
  - "Have Arik connect me": one-tap confirm, then a receipt marked "Coming soon, not sent"
- `agent_actions` plus events with the coming-soon / demo-not-sent executor. Skip the full registry; the minimum shape that a real calling service can plug into later is enough.
- Receipts show up in that patient's Past jobs.

## Stage 3: Bill review walkthrough (Luis)

- Two fictional documents from one ER visit: the hospital bill and the doctor's bill. Show them as images, with "SAMPLE" watermarks.
- "Snap your bill" opens the camera on phones. In the demo it uses the stored sample image and the stored (canned) extraction, after a short scanning animation.
- "Here's what I read", then a one-tap **"Looks right"** confirm.
- Checks are **pure functions in code** under `lib/rules/bills/`:
  - duplicate charge
  - day count (hospital bill)
  - bundling and unit limits (doctor's bill)
  - price vs Medicare amount (doctor's bill)
- **Data, cut for today:** no importers. Hand-enter **only the rows for the codes on the sample bills** into a small seed table, each copied from the official CMS file or page, with the URL, file version and retrieved date in `sources`. Code numbers only, no CPT descriptor text. If a row can't be verified today, drop that check from the sample instead of guessing.
- Findings in plain words, then the found total, which equals the sum of the findings.
- **Live letter:** the model drafts the billing dispute and the itemized-bill request from the findings. The grounding guard checks it, the required footer is added, and the code-built template is the fallback.
- Send screen (fax, mail, email): receipt "Demo, not sent", plus the one-time authorization step shown.

## Stage 4: Denial appeal walkthrough (Tasha)

- A fictional denial letter (EOB image) with a real reason code, employer plan.
- Plain explanation of the code (our own words, plus a link to x12.org) and the deadline from the letter date. Verify the appeal timeframe on eCFR today, or show the date without the rule if it can't be verified.
- The KFF Marketplace figures **only if verified on the KFF page today**, quoted exactly with year and link. Otherwise leave that screen out.
- **Live letters:** the appeal to the insurer, plus a request to the provider for the medical-necessity letter and records.
- Send screen, receipt and a deadline tracker entry.

## Stage 5: Canned history and polish

- Generate past letters for each sample patient's history **once with the letter engine** and store them as fixtures. Add fictional replies from the other side (made-up companies) and outcomes tagged "Illustrative example."
- **PDF download** for letters with pdf-lib (approved), if it fits. If not, letters stay on screen and the PDF comes later.
- Full click-through of all five patients on the mobile emulators (WebKit and Chromium, iPhone 15 and Pixel 7). Screenshots and console errors.
- Fix anything broken, then the final report and a **2-minute demo script** for Ryan: which patient to open first and what to tap, in order.

---

## Cut today, back later

- NCCI, MUE and fee-schedule importers (the seed rows replace them for the demo)
- The full agent action registry and Amazon Connect
- Patient home P1 to P3 (Past jobs list only)
- Live photo extraction (canned for the demo)
- Brand-drug price research and the top-200 drug load

## Cost

Letter drafting uses paid model calls, about $0.10 to $0.20 per full run, inside the anonymous cap. Tests use mocks.
