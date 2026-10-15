# Demo walkthrough: bill review and denial fighter

**Owner:** Ryan Russell
**Date:** 2026-10-14
**Put this file at:** `docs/kimi/DEMO_BILLS_DENIALS.md`
**Use:** "Follow docs/kimi/DEMO_BILLS_DENIALS.md. Plan first, then STOP."
**Replaces:** the bill and denial "labeled preview" samples in demo 5a. Runs after the persona work, as part of 5a.

## The story this demo tells

Hospitals and insurers are using software and AI to bill and to deny claims at scale. Patients face that alone. **Arik is the patient's AI on the other side.** The demo has to make that visible in about 90 seconds per flow.

The patient, the bill and the denial are fictional and scripted. **The checks, the public data and the letter drafting are real.** That's what keeps this honest while it sells: the inputs are canned, but what Arik does with them is the actual product.

## Labeling (honest, but not ugly)

- A small, always-visible "Sample case" tag in the header of every demo screen, styled like the rest of the app.
- One line on the final screen of each flow: "Bill review is in active development. This walkthrough uses a fictional bill checked against real public data."
- Nothing is ever sent. The "Send" step ends in a demo receipt marked "Demo, not sent."

---

## Flow 1: "Snap your bill"

1. **Photo capture.** The patient taps "Snap your bill." The demo uses a bundled image of a realistic fictional itemized hospital bill (made-up hospital, made-up patient, real CPT/HCPCS and revenue codes). A short scanning animation runs.
2. **"Here's what I read."** Arik shows the extracted line items in a clean list: date, code, description, units, charge. If cheap enough, run the real extraction model on the bundled image; otherwise use the stored extraction and mark it in code as canned.
3. **"I checked every line."** Arik runs **real checks in code** against **real public data**, then explains each finding in plain words:
   - **Duplicate charge:** the same code billed twice on the same date.
   - **Unbundling:** two codes billed separately that CMS's NCCI procedure-to-procedure edits say belong together.
   - **Impossible units:** units above the CMS Medically Unlikely Edit (MUE) limit for that code.
   - **Days don't match:** room charges for 3 days on a 2-day stay, from the bill's own admit and discharge dates.
   - **Price check:** the charge vs the Medicare fee schedule amount for the same code, shown as "Medicare pays about $X for this." It's a benchmark, never "what you owe."
4. **The total.** "I found $X in charges worth questioning." Only from the findings above, with the grounding guard on.
5. **"Want me to handle it?"** One tap and Arik drafts:
   - a request for the fully itemized bill with codes, if it wasn't itemized, and
   - a billing dispute letter to the provider's billing office listing each finding, its public-rule source, and a request to hold the account from collections while it's reviewed.
   The letter is **drafted live by the model** from the findings, then checked by the grounding guard.
6. **Send options screen.** Fax, mail, or email to the billing office, with a "Demo, not sent" receipt. Also show the authorization step real sends will need: "Arik prepared a form letting it act for you. You sign once."

## Flow 2: "Fight a denial"

1. **The denial.** The sample case has a fictional denial (EOB) with a real claim adjustment reason code, for example CO-50 (not medically necessary) or CO-197 (no prior authorization).
2. **"Here's what this means."** Arik explains the code in plain words, and gives the appeal deadline from the date on the sample letter.
3. **"You're not alone, and most people never appeal."** Show real public numbers with their sources, for example the KFF analysis of ACA marketplace data: about 19% of in-network claims denied, under 1% appealed. Use only the figures in the cited sources, with the source and year shown under them.
4. **"Here's my argument."** Arik builds the appeal from:
   - the plan's own denial reason
   - the patient's rights: internal appeal, then independent external review under the ACA rules
   - what's missing (for example, a letter of medical necessity from the doctor)
   The appeal letter is **drafted live by the model**, grounded in those facts.
5. **Two letters, two directions:**
   - the **appeal to the insurer**, and
   - a **request to the provider's office** for the medical-necessity letter and records.
   This shows Arik working both sides of the problem.
6. **Send and track:** the same send options, a demo receipt, and a deadline tracker showing the appeal due date and the external review step if the appeal fails.

---

## Public data to load (real, cited, no invented numbers)

Verify each source, URL and current release before loading. Record each one in `sources`.
- **CMS NCCI** procedure-to-procedure edits and Medically Unlikely Edits (free, quarterly). Load only the rows for codes on the sample bill plus a small buffer.
- **CMS Medicare Physician Fee Schedule** amounts for the sample codes (national amounts, labeled as a benchmark).
- **Claim adjustment reason codes** (X12 CARC list) for the sample denial codes, with plain-language explanations written by us.
- **KFF ACA marketplace denial analysis** figures, quoted exactly with year and link.
- **Federal appeal rights**: internal appeal and external review, cited to the regulation.
- If a figure can't be verified, leave it out. Never fill a gap with a plausible number.

## Rules

- **Checks are code, not the model.** Duplicate, NCCI, MUE, day-count and price checks are deterministic functions with tests. The model only explains findings and drafts letters.
- **The grounding guard covers every number** in explanations and letters.
- **No legal advice language.** Letters say "I am requesting," "please review," "I dispute"; never "you are legally required."
- **Nothing leaves the system.** Send buttons create demo receipts only, marked "Demo, not sent."
- **The bill checks are built to be reused.** Write them as the real bill-review module (`lib/bills/`) so the real feature later swaps the canned bill for a real upload, with no rewrite.
- No partner names anywhere. No em dashes.

## Tests

- Each check catches its planted error on the sample bill and doesn't flag the clean lines.
- The found-charges total equals the sum of the findings.
- Letters contain only grounded numbers; an invented amount is rejected.
- The "Sample case" tag and the development line appear on every demo screen.
- Send creates a demo receipt and makes no network call.

## Report

Plan first: files, data sources with URLs to verify, size, and any public figure you couldn't confirm. Then STOP for "go."
