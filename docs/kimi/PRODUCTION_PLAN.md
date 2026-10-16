# Arik production build plan

**Owner:** Ryan Russell
**Date:** 2026-10-16
**Put this file at:** `docs/kimi/PRODUCTION_PLAN.md`
**Use:** "Follow docs/kimi/PRODUCTION_PLAN.md, phase N. Plan first, then STOP."
**Runs after:** the current queue (phone numbers, DRUG_DATA_TOP200, routing Part B, free data loaders).

## The core idea

The demo already shows how Arik should work. Production keeps **the same screens and the same flow** and swaps each scripted piece for a real one behind an interface. DEMO_MODE picks the scripted version; production picks the real one. Nothing is rebuilt twice.

| Step in the demo | Demo version (today) | Production version |
|---|---|---|
| Get the document | Sample picker, fake camera | Real photo or file upload, encrypted storage |
| "Reading..." | Stored extraction | OCR plus model extraction into structured line items |
| "Here's what I read" + "Looks right" | Scripted | Same screen, real extracted fields, patient edits and confirms |
| Findings and highlights | Fixture boxes and text | Rules engine output, with highlight boxes from the extraction coordinates |
| Letter | Fixture letter | Letter engine: template plus model draft plus grounding guard plus footer |
| Sign | Scripted finger signature | Real e-signature plus a signed authorization on file |
| Send | "Demo, not sent" receipt | Fax, mail or email through BAA-covered vendors, with real confirmations |
| Past jobs and replies | Canned history | Real job timeline; replies uploaded by the patient or received on a per-case fax number |
| Prices | Real (database) | Same, deeper data (top 200 and beyond) |
| Call card | Coming soon receipt | Level 1 now (call script); Level 2 bridged calling later |

**Build rule:** every production piece gets an interface first (`DocumentSource`, `Extractor`, `BillChecks`, `LetterDrafter`, `Signer`, `Sender`, `CallProvider`), with the demo implementation and the real one side by side, and the same contract tests for both.

## Two kinds of work

- **Build now (no real patient data needed):** engines, interfaces, screens, tests, all against synthetic documents and fixtures. Most of the product can be built this way.
- **Gated (needs real patient data or real sending):** turning it on for real people waits for the **launch gate**: the S4 security review passed, BAAs signed with every vendor that touches patient data, legal review (terms, privacy policy, patient authorization forms), and production hosting on AWS.

---

## Phase 1: Production platform (gated pieces prepared now)

- **AWS staging, then production** (M20): infrastructure as code, encrypted storage, secrets in SSM, logs, alarms, backups and budgets. Prepare in staging; deploy production when Ryan approves.
- **Database:** move off the Supabase free plan (pauses, no backups). Plan options: self-hosted Supabase on AWS, or RDS Postgres with the same schema and row security. Recommend in the plan; Ryan decides.
- **Accounts:** real sign-in (email magic link to start), the "Save your results" upgrade from anonymous, session security, MFA option.
- **Document storage:** S3 with KMS encryption, per-user access, short-lived links, virus scanning on upload, retention rules applied.
- **AI provider with a BAA:** before any real patient data, AI calls must go to a provider covered by a BAA. Plan the switch (Amazon Bedrock or another BAA-covered option) behind the existing model interface. OpenRouter stays for the demo and dev only.
- **Audit log:** every read of patient data, every action, every send, append-only.
- **Monitoring:** error tracking without patient data in logs, uptime checks, cost alarms.

## Phase 2: Real document intake

- Upload or photo, then encrypted storage, then extraction (OCR plus a model) into a structured document: type (itemized bill, EOB, denial letter, insurance card, pharmacy receipt), header fields and line items with their positions on the page.
- "Here's what I read" with editable fields and a "Looks right" confirm. Nothing downstream runs on unconfirmed data (M09-AC4).
- Positions feed the highlight boxes, so the real highlighted-bill view works like the demo's.
- Test on a library of synthetic documents (made up, realistic, varied scan quality).

## Phase 3: Bill review engine (real checks)

Pure functions in `lib/rules/bills/`, each finding citing its rule and data version:
- duplicate charges; room-day count vs admit and discharge dates
- NCCI procedure-to-procedure bundling and MUE unit limits (full importers, quarterly refresh)
- price vs the Medicare fee schedule (benchmark wording only)
- items to ask about: charges with no code, vague "supplies", facility fees
- No Surprises Act checks where they apply (verify the rules and thresholds before building)
- charity care and financial assistance: nonprofit hospitals must have financial assistance policies; flag when the patient may qualify (verify the rules first)
- found total = sum of findings; every number through the grounding guard

## Phase 4: Letter engine

- Templates per letter type: itemized bill request, billing dispute, insurer appeal, records or medical-necessity request, financial assistance application cover letter, hold-from-collections request.
- Model drafts inside the template, grounding guard checks names, dates and numbers, required footer, no legal-advice wording, code-built fallback.
- Versioning: drafts are editable; a sent letter is frozen (hash stored) and downloads exactly as sent (pdf-lib).

## Phase 5: Denial engine (spec Appendix B4)

- Parse the EOB or denial letter: reason codes (CARC/RARC), dates, plan type.
- Plain explanations (our own words), deadline engine with verified timeframes per plan type (employer, Marketplace, Medicare, Medicaid differ).
- Argument builder: the plan's stated reason, what's missing, coverage rules (Medicare Coverage Database for Medicare), and the plan's own documents if the patient uploads them.
- Two-sided output: the appeal to the insurer, and the records or medical-necessity request to the provider.
- External review path when the internal appeal fails.

## Phase 6: Agent actions and real sending (M16)

- **Action registry:** every action has a tier, consent and approval steps, an executor, a receipt and audit events. The demo executor and real executors live side by side.
- **Authorization:** a patient-signed authorization so Arik can act and receive replies for them. Counsel provides the form language.
- **E-signature:** a real signing flow with a stored signed copy.
- **Send channels:** fax and print-and-mail through vendors that will sign a BAA, plus email where appropriate. Real confirmations become the receipt.
- **Replies:** a per-case inbound fax number and patient upload; replies attach to the job timeline and can trigger the next step.
- **Calling:** Level 1 (script and "Before you call") now. Level 2 (Arik dials and bridges the patient in, Amazon Connect) after the launch gate plus a call-recording consent decision. Level 3 (AI voice) much later.

## Phase 7: Patient home (P1 to P3, design already in docs/design/)

- Home: Needs you, Saved so far (confirmed savings only), Active jobs, Coming up.
- Jobs with full timelines; Documents vault with frozen PDFs; Profile; Privacy center (what Arik keeps, permissions with revoke, activity log, download all data, delete account).
- Notifications with no health details in the message.

## Phase 8: Prescription routing live (M24, M25)

- Manufacturer direct prices table, the cash-vs-insurance rule, and routing and transfer request documents (Part A).
- Live partner adapter in the private repo, only after: written OK from the partner to use their materials with our tools, a signed data use agreement, and S4.
- True cost and reach (M25): distance gating, mail order and shipping, total cost of getting the drug. Prompt to be written.

## Phase 9: Employer channel and billing

- Employer admin: enrollment (eligibility file or invite codes), aggregate de-identified reporting with a minimum group size of 11, the ROI report, and fees-at-risk tracking.
- Billing: employer PEPM invoicing; the consumer subscription ($50 a month, or the per-bill percentage capped at $50 a month). Use a payment processor; no card data stored by Arik.

## Phase 10: Compliance and operations (runs alongside everything)

- SOC 2 readiness (Justin), HIPAA policies, BAAs with every vendor, an incident response plan, access reviews.
- Terms of service, privacy policy, patient authorization forms, and any state rules for patient advocacy or billing disputes: counsel reviews.
- Support tooling for the ops manager: a case queue, escalations, reply handling.

---

## Recommended order

1. Current queue (in progress)
2. Phases 2, 3 and 4 together: intake, bill engine, letters (the bill flow becomes real end to end on synthetic documents)
3. Phase 5: denials
4. Phase 1: platform, in parallel once Ryan has done his AWS setup
5. Phase 6: actions and sending (build now with demo executors; real vendors at the launch gate)
6. Phase 7: patient home
7. Phase 8 and Phase 9
8. **Launch gate**, then turn on real patients

## Decisions Ryan needs to make (recommend options in each phase plan)

- Database home (self-hosted Supabase on AWS vs RDS)
- BAA-covered AI provider
- Fax, mail and e-signature vendors (each must sign a BAA)
- Sign-in approach
- Payment processor

## Rules that apply to every phase

Grounding guard on every number, never invent data, no money from any routing or pricing source, no partner names in this repo, secrets only in env or SSM, infrastructure as code, no em dashes, mobile-first, plan first and STOP for "go", commits local until Ryan says push, and flag any new db file before it's needed on a remote database.
