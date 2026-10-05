# Arik Health — Discount/Assistance Program Search Master List

**Purpose:** This is the search-targeting reference for any AI agent (Kimi, Sonnet, etc.) researching or updating prescription assistance program data inside Arik Health. It exists so search is aimed at the right sources for the right program type, not run as generic web queries. Every program type below has: what it is, why it's structurally different from the others, the source hierarchy to search in order, concrete search query templates, the data fields to extract, and the re-verification cadence.

**Non-negotiable rule for any agent using this doc:** never write a program's eligibility rule into the database from a Tier 3+ source without a Tier 1 or Tier 2 citation attached. If only a low-tier source was found, save it with `verification_status: unverified` and flag for human review. Do not upgrade confidence because a claim "sounds right."

---

## 0. Source Tier Definitions (apply to every program type below)

- **Tier 1 (primary):** Manufacturer's own program page/PDF, official foundation fund status page, government agency page (CMS, Medicaid.gov, HRSA, SSA, state Medicaid site, state SPAP site).
- **Tier 2 (secondary aggregator):** NeedyMeds, RxAssist, Medicine Assistance Tool (MAT). Use as a discovery/index layer only — treat anything found here as a *lead* to go verify at Tier 1, not as a stored fact.
- **Tier 3 (unverified):** News articles, blogs, Reddit, forums, YouTube. Leads only, never a source for a stored eligibility rule.

Every rule stored in the system needs: `source_url`, `source_tier`, `retrieved_at`, `last_verified_at`, `verification_status` (officially_verified / third_party_summary / unverified).

---

## 1. Program Type Taxonomy + Search Targeting

### 1.1 Manufacturer Patient Assistance Programs (PAPs)
**What it is:** Free or near-free drug shipped directly by the manufacturer to uninsured/underinsured patients meeting income criteria.
**Key trap:** Medicare/Medicaid patients are SOMETIMES eligible here (unlike copay cards) if structured as free product replacement rather than a cash subsidy on a federal claim. Don't assume exclusion — check per-manufacturer.

**Search sequence:**
1. `site:[manufacturer].com patient assistance program [drug name]`
2. `"[drug name]" manufacturer PAP eligibility income`
3. `[manufacturer] Help at Hand OR Connect OR CareASSIST OR patient assistance` (manufacturers each brand these differently — see naming reference below)
4. Cross-check via Tier 2: `needymeds.org [drug name]` or `rxassist.org [drug name]`

**Manufacturer PAP program name reference (expand as encountered):**
- Takeda → Help at Hand
- Bristol Myers Squibb → BMS Access Support / Connect
- Eli Lilly → LillyDirect / Lilly Cares
- Novartis → Novartis Patient Assistance Foundation
- Pfizer → Pfizer RxPathways

**Data to extract:** income ceiling (as %FPL and/or absolute $), household definition used, insurance-status inclusion/exclusion list (explicitly note Medicare/Medicaid stance), citizenship/residency requirement, required docs (tax return, denial letter, hardship affidavit), reapplication cadence, indication restrictions, dispensing channel (mail to home vs. specialty pharmacy).

**Re-verify:** every 30 days, or immediately on any manufacturer page-change signal.

---

### 1.2 Manufacturer Copay/Savings Cards
**What it is:** Point-of-sale reduction of commercial-insurance cost-share, $0–$25/month typical, with annual caps.
**Key trap:** Structurally excludes ALL government insurance (Medicare, Medicaid, TRICARE, VA, CHIP) — federal Anti-Kickback Statute risk for manufacturers. Never merge this eligibility logic with PAP eligibility logic. This is the single most common eligibility-matching error to guard against.

**Search sequence:**
1. `[drug name] copay card OR savings card commercial insurance`
2. `site:[manufacturer].com savings card terms eligibility`
3. Look explicitly for the exclusion clause: `"[drug name]" copay card "Medicare" OR "Medicaid" exclude`

**Data to extract:** annual maximum benefit (dollar cap), monthly cap if separate, commercial-insurance-only confirmation, explicit government-program exclusion language (quote it), maximizer/accumulator interaction clause if stated, expiration/renewal terms.

**Re-verify:** every 30–90 days; caps and maximizer clauses change without much notice.

---

### 1.3 Discount Cards / Aggregators (GoodRx, SingleCare, Optum Perks, Inside Rx)
**What it is:** Pre-negotiated PBM-network cash prices. Not insurance, not assistance. Cannot be stacked with insurance; does not count toward deductible/OOP max.
**Key trap:** A quoted online price ≠ guaranteed pharmacy-counter price. Also: several state AG actions exist over "not insurance" disclosure failures — display that disclosure whenever these are shown.

**Search sequence:**
1. `goodrx.com [drug name]` / `singlecare.com [drug name]` / `optumperks.com [drug name]` — pull live quoted price directly, don't rely on cached/old figures
2. If building a price-tracking table: note pharmacy chain, dose/strength, and date pulled — these are ephemeral quotes, not durable facts

**Data to extract:** quoted price (with pharmacy name, dose, date), whether the platform states "not insurance" disclosure, network breadth (which pharmacy chains honor it).

**Re-verify:** effectively every query — do not cache these prices as durable facts. Treat as a live lookup, not a stored rule.

---

### 1.4 340B / FQHC / Covered-Entity Pricing
**What it is:** Provider-side acquisition discount (HRSA-mandated), NOT a published consumer price. Patient only benefits if they're an established patient of that specific covered entity and fill through that entity's pharmacy.
**Key trap (critical for Arik):** Never quote a specific 340B ceiling price as "the patient's price." Safe framing only: "may qualify for lower pricing if you receive care at [FQHC name] — confirm directly with their pharmacy."

**Search sequence:**
1. HRSA OPAIS lookup for the specific facility: confirm covered-entity and contract-pharmacy registration status (`https://opais.hrsa.gov`)
2. `[FQHC name] pharmacy sliding scale [drug name]` — for the entity's own patient-facing pricing/sliding-fee policy, if published
3. Direct call/contact is often required — flag this program type as "requires direct verification, cannot be fully automated" in the UI

**Data to extract:** entity name, OPAIS registration status, whether entity has an onsite or contract pharmacy, sliding-fee scale if published, whether entity's pharmacy dispenses the specific drug class (especially relevant for Schedule II controlled substances — confirm separately).

**Re-verify:** entity registration status quarterly; sliding-fee scale annually or on entity website change.

---

### 1.5 State Pharmaceutical Assistance Programs (SPAPs)
**What it is:** State-funded wraparound subsidy, often Part D wraparound for seniors. Only ~15 states operate general SPAPs. Not interchangeable templates state to state.
**Key trap:** Program design (age, income, drug list, Part D interaction) varies substantially — do not generalize from one state's program to another.

**Search sequence:**
1. `"[state]" state pharmaceutical assistance program`
2. Known program name lookup if state has one: PA → PACE/PACENET, NY → EPIC, NJ → PAAD (expand this table as other states are researched)
3. `site:[state].gov prescription assistance program eligibility`

**Data to extract:** age/disability requirement, income limit, residency requirement, whether Part D enrollment is required, covered drug list if formulary-limited, premium/copay support structure.

**Re-verify:** quarterly, or on known legislative session / benefit-year boundary (Jan 1, Jul 1, Oct 1 are common effective dates).

---

### 1.6 Nonprofit/Disease-Specific Foundations (PAN, HealthWell, TAF, Patient Advocate Foundation, Good Days)
**What it is:** Direct financial grants for copay/premium support, organized by disease fund not drug brand. HIGHEST VOLATILITY program type in this entire list — funds open/close/waitlist with little or no warning.
**Key trap:** This is the single highest-consequence category for the "false hope" failure mode. A fund can close between when you match a patient to it and when they apply.

**Search sequence:**
1. Direct fund-status page for each major foundation (bookmark and check live, don't cache):
   - `panfoundation.org` — fund status page
   - `healthwellfoundation.org` — fund status page
   - `patientadvocate.org` (Co-Pay Relief)
   - `mygooddays.org`
2. `[disease/condition] foundation grant open 2026` as a discovery query if the disease-specific fund isn't already known

**Data to extract:** fund status (open/closed/waitlisted — this must be a live/near-live field, not stored longer than 24 hours without re-check), disease/diagnosis restriction, income ceiling (%FPL), insurance-type restriction (many serve Medicare/underinsured specifically), grant amount range, application requirements.

**Re-verify:** MAXIMUM 24–48 hours. This is non-negotiable — recommending a closed fund is the single most damaging failure mode in this entire system, per every source reviewed.

---

### 1.7 Medicaid / CHIP
**What it is:** Public insurance, not a discount program — potentially more valuable than any coupon since it creates broad coverage, not just a price reduction on one drug.
**Key trap:** Eligibility methodology, PA rules, and formularies differ by state; Missouri specifically expanded Medicaid in 2021, materially changing adult eligibility versus non-expansion states.

**Search sequence:**
1. `site:mydss.mo.gov MO HealthNet eligibility income` (Missouri-specific; swap state agency domain for other states)
2. `[state] Medicaid income eligibility [year] single adult`
3. For formulary/PA status of a specific drug: `[state] Medicaid preferred drug list [drug name]`

**Data to extract:** income threshold (as %FPL, with household size table), whether the state expanded Medicaid, PDL/formulary status for the specific drug, PA requirement, application channel.

**Re-verify:** annually at minimum, quarterly if possible; PDL/formulary data changes more frequently than eligibility rules.

---

### 1.8 Medicare Part D Extra Help / Low-Income Subsidy (LIS)
**What it is:** Federal subsidy reducing Part D premiums/deductibles/copays for limited-income beneficiaries.
**Key trap:** Distinct from Medicaid and from manufacturer PAPs — don't conflate. Automatic for full-Medicaid/SSI recipients; requires SSA application otherwise.

**Search sequence:**
1. `site:ssa.gov Extra Help eligibility income asset limits [year]`
2. `site:cms.gov Low-Income Subsidy Part D [year] limits`

**Data to extract:** income limit (%FPL), asset limit, automatic-qualification triggers (full Medicaid, SSI, Medicare Savings Program), application path if not automatic.

**Re-verify:** annually (CMS updates limits on a calendar cycle, typically effective January).

---

### 1.9 Hospital Charity Care / 501(r) Financial Assistance
**What it is:** Nonprofit hospital financial assistance that can zero out clinic/infusion drug bills. Separate from 340B.
**Key trap:** Only applies to drugs dispensed/administered AT the nonprofit hospital facility (infusion, outpatient clinic) — not a retail pharmacy fill.

**Search sequence:**
1. `[hospital name] financial assistance policy` — nonprofit hospitals are required to publish this
2. `[hospital name] charity care application income`

**Data to extract:** income ceiling (%FPL), which services/settings it applies to (must confirm pharmacy vs. infusion/clinic-administered only), application process.

**Re-verify:** annually or on hospital policy-page change.

---

### 1.10 Disease-Specific Statutory Programs (ADAP/Ryan White, ESRD programs, hemophilia programs)
**What it is:** Federal/state carve-outs for specific diagnoses. ADAP (Ryan White) is the most common example — payer of last resort, requires proof other assistance is exhausted.

**Search sequence:**
1. `site:hab.hrsa.gov ADAP [state] formulary eligibility`
2. `NASTAD ADAP [state] eligibility` (NASTAD tracks state-by-state ADAP data)

**Data to extract:** diagnosis requirement, state residency, income limit, formulary (drug-specific), proof-of-exhaustion requirement for other coverage.

**Re-verify:** every 6–12 months, plus legislative-session monitoring (state budget cycles affect these programs disproportionately).

---

### 1.11 VA / TRICARE
**What it is:** Government benefit pathway with own formulary and copay structure for eligible veterans/dependents.
**Note:** Treat as a primary coverage pathway to check first, not a generic cash-price comparator.

**Search sequence:**
1. `site:va.gov pharmacy copay [drug name]`
2. `tricare.mil formulary [drug name]`

**Data to extract:** copay tier, formulary status, whether prior authorization applies.

**Re-verify:** annually.

---

### 1.12 Categories to Flag But Not Fully Build Initially
(Lower priority for first build, but the search agent should recognize these exist and not misroute a patient who mentions them)

- IHS / tribal / urban Indian pharmacies
- Manufacturer hub/bridge/free-trial programs (short-term only, not ongoing assistance)
- Biosimilar/interchangeable alternatives (requires clinical context — flag for prescriber conversation, don't auto-recommend)
- Workers' comp / auto / liability-related drug coverage
- Employer retiree / COBRA / union plan carve-outs (not publicly catalogable — capture as "other coverage, ask directly")
- International importation — **do not surface as an option.** FDA treats personal importation as illegal in most circumstances. This should be a hard exclusion in the system, not a ranked-low option.

---

## 2. Cross-Cutting Search Directives (apply regardless of program type)

### 2.1 When researching income/FPL rules
Always search for the CURRENT YEAR's FPL table specifically — search `HHS federal poverty guidelines [year]` — because %FPL thresholds are meaningless without pinning to the correct year's dollar figures, and these update annually (typically published January).

### 2.2 When researching a drug new to the system
Search in this order:
1. Drug-specific manufacturer PAP and copay card (1.1, 1.2)
2. Cross-check NeedyMeds/RxAssist for that drug as a discovery step (Tier 2, verify anything found at Tier 1 before storing)
3. Discount card live pricing (1.3)
4. Only then move to state/foundation/public-program layers, which are patient-circumstance-driven rather than drug-driven

### 2.3 Never search for or store
- International/gray-market pharmacy sources
- Forums/Reddit as anything other than a "there might be something here, go verify" lead
- Any site promising guaranteed approval or "instant eligibility"

### 2.4 Anti-Kickback Statute guardrail for the AI agent itself
When generating search queries or summarizing findings, never produce ranking logic that would favor a program based on anything other than: (a) patient eligibility fit, (b) estimated cost to patient, (c) funding/availability status. If the agent is ever asked to incorporate "sponsored" or "featured" placement, flag it — this is a compliance line, not a product-flexibility question.

---

## 3. Assertion Language Standard (apply to all output, regardless of program type)

Never generate: *"You are eligible for [program]."*

Always generate one of:
- "Based on what you entered, you appear to meet [Program Name]'s published criteria as of [date]. Only the program can confirm approval."
- "This fund is currently [open/closed/waitlisted] as of [last-checked date]."
- "We don't have enough information to determine eligibility for this criterion: [specific gap]."
- "This program's terms explicitly exclude [Medicare/Medicaid/etc.] — it does not appear to apply to your situation as described."

---

## 4. Re-Verification Cadence Summary Table

| Program Type | Max Staleness Before Re-check |
|---|---|
| Foundation fund status | 24–48 hours |
| Discount card live price | Every query (never cache as durable) |
| Copay/savings card terms | 30–90 days |
| Manufacturer PAP terms | 30–90 days |
| 340B entity registration | Quarterly |
| Medicaid/state program rules | 90 days, or on known annual/legislative cycle |
| SPAP rules | Quarterly |
| Extra Help/LIS limits | Annually (Jan effective date) |
| Hospital charity care policy | Annually or on policy-page change |
| ADAP/disease-specific programs | 6–12 months + legislative monitoring |
| VA/TRICARE formulary | Annually |

---

## 5. First-Build Priority Order

Given Arik currently supports 3 drugs and this is a checkpoint expansion, research and build search targeting in this order:

1. **Discount cards (1.3)** — lowest complexity, highest immediate patient value, no eligibility logic needed
2. **Manufacturer PAP + copay card (1.1, 1.2)** — per-drug, moderate complexity, directly relevant to your current test drugs
3. **Medicaid/state program (1.7)** — high value for uninsured/unemployed patients specifically, moderate complexity
4. **340B/FQHC (1.4)** — directly relevant to your Swope Health use case, but must ship with the "cannot promise a price" guardrail from day one
5. **Foundations (1.6)** — highest value-per-match but highest operational burden (24–48hr re-verify requirement) — build last, once the re-verification pipeline actually exists
6. Everything in 1.9–1.12 — defer until the above are solid
