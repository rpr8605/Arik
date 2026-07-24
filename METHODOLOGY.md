# Arik Methodology: Where to Look, What to Look For, How to Think

This is the brain's operating manual - what the extraction AI (Task 1) and
extrapolation AI (Task 2) are actually instructed to hunt for and how they
decide where to look next. Build this alongside the schema, before code,
because retrofitting "how to think" after the pipeline exists is much harder
than encoding it up front.

## 1. Evidence grading (applies to every single fact in the system)

Every row in every table - `exploits`, `accumulator_policies`, atlas edges,
everything - carries a grade. This is what lets Arik be aggressive in tone
while staying defensible in fact.

- **A** - court ruling, government data, final regulatory finding (FTC staff
  reports, CMS negotiated price releases, congressional oversight reports)
- **B** - SEC filing, government investigation, formal settlement
- **C** - peer-reviewed analysis or reliable investigative journalism
- **D** - allegation, complaint, whistleblower account
- **Unverified** - plausible lead, not yet checked against a primary source

A D-grade lead is allowed to exist in the system and even surface to a user,
but always labeled honestly ("under investigation," not "proven"). Nothing
above D-grade gets stated as settled fact in the chat response model.

## 2. Source taxonomy - where to look, by category

### Drug pricing / manufacturer sources
- Manufacturer patient-assistance and copay-card program pages (primary,
  check terms directly on the manufacturer's own site - these change
  quarterly without notice)
- CMS Medicare Drug Price Negotiation Program releases (cms.gov) - highest
  quality source that exists for brand-name pricing, Grade A by definition
- 3 Axis Advisors / 46brooklyn - independent drug pricing trackers that
  compile list price change data across the industry
- NeedyMeds and RxAssist - existing nonprofit PAP/free-clinic directories,
  ingest and structure rather than rebuild from scratch

### PBM / insurer / accumulator sources
- PBM plan documents / Summary Plan Descriptions (SPDs) - where accumulator
  and maximizer program terms actually live, usually buried in plan-specific
  paperwork rather than a public page
- FTC PBM investigation reports (ftc.gov) - the single richest Grade A
  source for PBM self-dealing, spread pricing, and steering data that
  currently exists
- State insurance department filings - accumulator/maximizer bans vary by
  state and change via legislation, worth a state-by-state watch
- 340B Report (340breport.com) and HRSA's own 340B database - for contract
  pharmacy arrangements and ceiling price data

### Insurer / vertical integration sources
- SEC 10-K/10-Q filings for the six major conglomerates (UnitedHealth, CVS
  Health, Cigna, Elevance, Humana, Centene) - segment-level revenue reveals
  where enterprise extraction is concentrated
- CMS Medicare Advantage risk-adjustment audit findings and DOJ/HHS-OIG
  settlements - Grade A/B evidence for risk-score harvesting patterns
- State attorney general settlements and class-action filings - Grade B,
  often the fastest-moving source since litigation surfaces internal
  documents (like the Revlimid case did)
- Congressional oversight committee reports (House Oversight, Senate
  Finance) - same category as the Revlimid report, tends to release
  primary-source internal company documents

### Legal/regulatory rulebook (context, not evidence, but required to
interpret everything else correctly)
- Medical loss ratio rules (CMS)
- ERISA text and exemptions
- Anti-kickback statute safe harbors
- Stark Law exceptions
- State pharmacy and PBM regulation (varies significantly by state - MO
  specifically worth having on hand given home base)

## 3. Savings/exploit category taxonomy - what to look for

This is the full list assembled across this build so far. Every entry in
`exploits` should map to one of these:

1. Cash price vs. insurance price arbitrage
2. Manufacturer copay cards / assistance programs
3. Patient assistance programs (PAPs) for uninsured/underinsured, income-matched
4. Pill-splitting arbitrage (dose-cost curve, needs prescriber sign-off)
5. 90-day vs. 30-day fill cost deltas
6. Therapeutic-equivalent substitution flags
7. Formulary tier appeal triggers
8. Site-of-service cost differences (infusions/procedures)
9. State/local assistance program eligibility matching
10. Discount card network multi-comparison (SingleCare/GoodRx/BuzzRx/RxSaver/
    ScriptSave WellRx - none agree with each other, the gap itself is the
    exploit)
11. 340B contract pharmacy eligibility (patient of a qualifying safety-net
    clinic)
12. Accumulator/maximizer workaround identification (does this specific
    plan let a copay card count toward deductible/OOP max or not)
13. FQHC / sliding-scale clinic lookup by zip for uninsured access
14. Low-cost telehealth path to an initial prescription for uninsured
    patients with no existing doctor

## 4. Patterns to specifically test (insurer/PBM atlas layer, Phase 3)

Carried over directly from the insurer research pass - these are the
hypotheses the graph traversal should be built to surface, each requiring
its own evidence chain before being stated as more than a hypothesis:

- **Affiliate laundering** - insurer satisfies medical-spend requirement by
  paying an affiliated provider/pharmacy that records its own profit
- **Denial as friction** - claims denied at a rate that assumes a predictable
  percentage of patients won't appeal, even where appealed denials are
  often overturned
- **Rebate inversion** - PBM prefers an expensive drug with a large rebate
  over a cheaper drug with a smaller rebate
- **Specialty-pharmacy steering** - patient funneled to the PBM's own
  affiliated pharmacy at a materially higher reimbursement than an
  independent pharmacy would get
- **Risk-score harvesting** - home assessments/chart reviews generate
  Medicare Advantage payment increases without corresponding treatment
- **Acquisition feedback loops** - after buying physician groups, insurer
  directs members toward those groups while restricting outside providers
- **Administrative exhaustion** - prior authorization costs providers close
  to or more than it saves the plan
- **Broker conflicts** - employer told a plan is inexpensive while
  undisclosed commissions/overrides/PBM payments shape the recommendation
- **Patent-to-PBM loop** - manufacturer keeps exclusivity while PBM
  preserves formulary placement because both benefit from a high list price
- **Regulatory arbitrage** - revenue/operations moved between subsidiaries
  to land under a more favorable regulatory framework

## 5. How the AI decides where to look next (the actual "training")

Not a fine-tune. A standing instruction set for the extraction/monitor layer:

1. **Anchor list first.** Start from the six vertically-integrated
   conglomerates and the Big 3 PBMs - known, named, already Grade-A
   documented via FTC. Don't go hunting for exotic targets before the
   well-documented ones are fully mapped.
2. **Follow citations outward.** Every government report (FTC, CMS,
   congressional) cites specific drugs, specific companies, specific NDCs.
   Those become new nodes/rows automatically - the extraction layer's job
   includes pulling the citation graph out of each primary source, not just
   the headline numbers.
3. **Prioritize by dollar concentration, not novelty.** A pattern affecting
   $15B in Medicare spend (semaglutide) matters more right now than an
   exotic one-off affecting a few thousand patients. Rank the queue by
   spend, not by how interesting the mechanism is.
4. **Re-check anything with a "pending" status on a fixed cadence.** CMS
   negotiation rounds, FTC follow-up reports, and settlement dockets all
   update on public schedules - the monitor job's job is knowing those
   schedules and re-pulling exactly when new data is expected, not
   constantly re-scraping everything.
5. **Escalate ambiguity, don't guess.** If extraction can't confidently
   grade a source A/B/C/D, it queues for human (Ryan) review rather than
   defaulting to a grade.

## 6. What this means for the build (Kimi/OpenCode handoff, later)

This methodology doc sits alongside `HANDOFF.md`, `schema.sql`, and
`seed_drugs.json` as required reading before Phase 3 (the insurer/PBM atlas)
gets built. Phase 1 (patient pilot) doesn't need the full atlas - it needs
the savings taxonomy in section 3 and the evidence grading in section 1.
Section 4 and the ownership graph are Phase 3 and later.
