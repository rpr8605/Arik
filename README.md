# Arik

The anti-GoodRx. GoodRx and OptimizeRx get paid by PBMs and pharma, so they're
structurally incentivized to steer patients toward whoever pays them.
This has one job: find every legal way a specific patient pays less, even when
it costs the drug company or the PBM money. No PBM fee revenue, no pharma
placement revenue, ever. That's the entire moat.

Not a treatment tool. Doesn't touch diagnosis, doesn't touch clinical decisions.
It only touches money: prices, program terms, accumulator policy, formulary tiers.

## Why "light and cloneable"

The database of exploits is the actual asset. The frontend is disposable.
Structure:

- **Brain (Supabase project)**: drugs, price_points, exploits, accumulator_policies,
  sources. One canonical DB, or forked per-vertical (consumer, employer/union,
  state Medicaid population).
- **Frontend (Next.js, Vercel)**: thin. Takes patient inputs (drug, dose, state,
  insurance type, income if relevant), queries the brain, returns ranked savings
  paths with citations. Redeploying for a new brand/vertical = new Vercel project
  pointed at the same or forked Supabase instance. No rebuild.
- **Monitor (scheduled job)**: the "trained AI" part. Watches for formulary
  changes, accumulator/maximizer program term changes, manufacturer copay card
  term changes. Flags stale exploits (closed loopholes) and new ones. This is
  the piece that can't be a static rules engine like MsJaneHH's, because the
  rules here are adversarial and move on purpose, monthly or faster.

## Hard line (non-negotiable, same conversation Hunter needs before real data)

Every recommendation is a **legal savings mechanism** with a citable source
(program terms, PBM policy doc, state statute). Never:
- misrepresent a diagnosis or condition to qualify for a program
- coordinate benefits in a way that constitutes claims manipulation
- suggest anything that touches insurance fraud statutes

If a mechanism can't be cited to a real source, it doesn't ship as a
recommendation. Aggressive tone is fine. Unsupported claims are not.

## Phase 1 (this repo, right now)

This repo is a complete specification, not a runnable app - schema, seed
data, one example API route, and design docs. The authoritative build
sequence (core case-model infrastructure, then Phase 1 drug pricing, then
the Phase 1.5 bill-auditor track) is in `HANDOFF.md`; start there. The
monitor job described above is a later-phase concern, not part of the
Phase 1 pilot.

## The full vision (beyond drug pricing)

Arik's endpoint is a patient-side healthcare financial advocate, not just a
drug savings tool: "before the patient pays anything, is this covered,
correctly billed, medically authorized, competitively priced, and eligible
for assistance." Modules beyond the drug-pricing core, ranked by how the
combination of savings potential and buildability actually shakes out:

**Second MVP candidate (document-in, findings-out, no live monitor needed):**
- Medical bill auditor - compares itemized bill vs. EOB vs. plan rules,
  flags duplicate charges, upcoding, incorrect patient responsibility,
  wrong network processing
- Denial appeal assistant - reads a denial letter, identifies the deadline
  (payer-specific, not just the ERISA floor - UHC commercial runs 65 days,
  Aetna 180, Medicare Advantage 60 under CMS minimums), pulls coverage
  criteria, drafts the appeal
- Charity care / hospital financial assistance screening - nonprofit
  hospitals' financial assistance policies, income-as-%-of-FPL matching,
  covers underinsured patients too, not just uninsured

All three run entirely off documents the patient already has (EOB,
itemized bill, denial letter) plus public rules (hospital FAP policies,
payer-specific appeal deadlines). No scraping pipeline required to start -
this is a strong parallel-track build to the drug-pricing pilot, not
sequential.

**Later modules (real value, harder to build):**
- Hospital/imaging price shopping - CMS's hospital price transparency
  machine-readable files are a real public data source, but need
  significant cleanup/normalization work before they're queryable
- Insurance plan optimizer - models expected annual cost across
  low/medium/high usage scenarios at open enrollment, prevents a
  year-long bad plan choice
- Specialty-drug/site-of-infusion navigator - same site-of-service
  arbitrage as imaging, more complex due to clinical suitability
  constraints requiring physician confirmation
- Full patient advocate - all modules combined, requires secure document
  handling and probably eventual read access to actual claims data

## Monetization: two-track, neither one touches pharma/PBM money

- **Employer/union B2B** (from earlier): flat fee or PEPM, aligned because
  self-insured employers eat their own drug/claims spend directly
- **Consumer success fee**: opt-in, percentage of documented savings only,
  paid by the patient after the fact - never a subscription gate on the
  free savings-finder function. If Arik gets $2,000 back on a bad bill,
  taking a cut of the actual recovery keeps the incentive aligned in a way
  a flat consumer subscription wouldn't. This pairs naturally with the bill
  auditor and denial appeal modules specifically, since those produce a
  clean "amount recovered" number to take a percentage of.

## Frontend: chat, not open-ended LLM

The chat interface is a RAG layer, not a freeform chatbot. Two model calls
per turn, not one:

1. **Extraction** (cheap/fast model) - pulls drug name, dose, question type
   out of the user's message. Pattern matching, not judgment.
2. **Retrieval** - plain Supabase queries against `exploits`, `price_points`,
   `accumulator_policies` using the extracted intent + the user's stored
   profile/medications. No LLM involved in this step.
3. **Response** (real reasoning model) - only allowed to speak from what got
   retrieved. System prompt (`chat_system_prompt.md`) hard-bans inventing
   programs or policies not in context. Every chat message logs which
   `exploits` rows it was grounded in (`retrieved_exploit_ids`), so every
   answer has an audit trail back to a source, same spirit as MsJaneHH.

Files: `schema.sql` (adds the `user_identity`/`user_matching_profile`
split, `user_medications`, the case-model tables, and case-scoped
`chat_sessions`/`chat_messages`), `chat_system_prompt.md`,
`app/api/chat/route.ts` (the 3-step flow - wire `callModel()` to the model
router when scaffolding the app).
Chat is scoped to a case - one thread per case, not one continuous
history (see CASE_MODEL.md).

## Business model constraint

Direct-to-consumer subscription or B2B sold to self-insured employers/unions
who want to cut their own drug spend. Never PBM-fee-funded. Never
pharma-fee-funded. The instant either of those checks clears, this becomes
GoodRx or OptimizeRx again.
