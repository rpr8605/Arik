# Arik Research Pack — Accumulator Bans, Medicare AKS Distinction, Program Terms Verification

Generated 2026-08-11 from live pulls. Treat legal sections as first-draft research requiring legal review before shipping as medicare_legal flag. Sources cited per HANDOFF requirement that every exploits/accumulator row needs source_id.

## 1. State Copay Accumulator Ban Matrix — Schema Impact

### Current landscape from pulls
- Avalere: Since 2019, 25 states + DC + Puerto Rico enacted laws banning accumulator use for state-regulated plans
- KFF Health News: Twenty-six states, Washington, D.C., and Puerto Rico have adopted laws banning copay accumulators or prohibiting them for drugs without generic equivalent. Colorado also prohibits for drugs without biosimilar
- Older count: 14 states + PR banned — WA, AZ, NE, OK, LA, AR, IL, KY, TN, WV, VA, NC, GA, CT

You need full 2026 current list. Start with this structure:

| state_code | ban_enacted | ban_type | applies_to | effective_date | source_url | notes |
|---|---|---|---|---|---:|---|
| AZ | yes | outright | fully_insured individual + small + large group | 2019 | legislature URL | First wave |
| WV | yes | outright | state-regulated | 2019 | | First two states per STAT |
| VA | yes | outright | | 2019 | | First two states per STAT |
| CO | yes | no_biosimilar | | | | Prohibits when no biosimilar |
| VT | pending/ enacted | outright | 8 V.S.A § 4089j | | legislature.vermont.gov bill | Ban language: shall not attribute thirdparty payment |
| OH | pending | outright | SB 207 | June 1 2026 support letter | search-prod.lis.state.oh.us | CSRO support |

**Action:** Pull Avalere Table 1 and CGA CT report 2024-R-0034 to fill full 26-state table. That report identifies jurisdictions that ban/restrict and describes CT law.

### Schema patch for accumulator_policies

Current schema treats accumulator as binary. Change to:

```sql
-- Add to accumulator_policies or new table accumulator_bans
ALTER TABLE accumulator_policies ADD COLUMN state_code TEXT;
ALTER TABLE accumulator_policies ADD COLUMN ban_type TEXT CHECK (ban_type IN ('outright','no_generic_only','no_generic_no_biosimilar','maximizer_only','none'));
ALTER TABLE accumulator_policies ADD COLUMN applies_to_market TEXT; -- 'fully_insured','self_insured','all_state_regulated'
ALTER TABLE accumulator_policies ADD COLUMN source_statute_id TEXT REFERENCES sources(id);
ALTER TABLE accumulator_policies ADD COLUMN effective_date DATE;
```

Ranking logic:
```
IF patient.state IN ban_states AND plan.is_fully_insured AND (ban_type == 'outright' OR (drug.has_generic == false AND ban_type == 'no_generic_only')):
  accumulator_suppressed = true // allow copay card to count, don't show accumulator warning
ELSE:
  accumulator_suppressed = false // show warning: manufacturer assistance may not apply to deductible per CMS transparency rule
```

CMS final rule note: plans adopting accumulator programs should apply them in uniform, non-discriminatory manner and provide clear and transparent info to enrollees. Use this as source for disclosure.

## 2. Medicare Copay Card — AKS vs Contractual Distinction

### Research
- Anti-kickback statute prohibits offering remuneration to induce Medicare/ChampVA purchase — includes payment of copay obligations.
- OIG SAB: manufacturer failure to take appropriate steps to ensure coupons do not induce purchase of federal health care items may be evidence of intent
- Pharmacies that accept coupons from Medicare beneficiaries may also face sanctions footnote
- Medicare and Medicaid prohibit copay assistance because federal anti-kickback laws forbid financial incentives

### Schema patch for exploits

```sql
ALTER TABLE exploits ADD COLUMN medicare_exclusion_reason TEXT CHECK (medicare_exclusion_reason IN ('aks_statutory','manufacturer_terms','both','none','unknown'));
ALTER TABLE exploits ADD COLUMN aks_citation_source_id TEXT REFERENCES sources(id);
ALTER TABLE exploits ADD COLUMN terms_citation_source_id TEXT REFERENCES sources(id);
```

Example:
- Dupixent MyWay Copay Card: medicare_exclusion_reason='manufacturer_terms' (commercial only by terms, eligible commercially insured may pay as little as $0), max savings $13k/year
- Dupixent MyWay PAP: medicare_exclusion_reason='none' — can provide at no cost to eligible patients including those who are uninsured, underinsured, or have Medicare Part D, uninsured income ≤$100k, must not have confirmed insurance coverage

Same drug, different path — boolean collapses this.

## 3. Tier 1 Program Terms — Verification URLs for Daily Monitor

| Drug | Program | What we pulled | Verification URL / Source to create sources row | Income / Terms to verify live |
|---|---|---|---:|---|
| Dupixent | MyWay Copay Card | $0 copay eligible commercial, terms apply, max $13k/yr | https://www.dupixent.com/support-savings/copay-card | Call 844-387-4936 |
| Dupixent | MyWay PAP | Free to eligible uninsured ≤$100k, no confirmed coverage, Medicare Part D may qualify | dupixenthcp.com copay & financial assistance | Enrollment form |
| Zepbound | LillyDirect Self-Pay Vials | All vial strengths $499/mo via LillyDirect Self Pay Pharmacy Solutions, 2.5mg $349 and 5mg/7.5/10mg $499, later 2.5mg $299 $50 reduction and 5mg $399 $100 reduction, 2.5mg $399/4 weeks and 5mg $549 | Lilly press releases | PharmExec |
| Zepbound | KwikPen Self-Pay | Starts at $299 for 2.5mg one-month (28 days) as of Aug 4 2026 | lillydirect, Kroger announcement Mar 13 2026 | LillyDirect Self Pay |
| Zepbound | Savings Card | Commercial + savings card as low as $25 if covers, ~$499-$650 if excludes | getheally.com guide |  |
| Eliquis | BMSPAF PAP | Reports vary: ≤300% FPL vs ≤400% FPL vs ≤300% FPL generally, US resident, uninsured/underinsured, Extra Help check for Medicare | BMSPAF site, NowPatient | Proof of income, enrollment form signed by prescriber |
| Eliquis | Cost Plus | $345 30-day via Cost Plus Drugs beginning April 27 2026 | businesswire | Eliquis 360 Support |

**Monitor cadence:**
- Foundation funds: daily. PAN TotalAssist launches July 1 2026, will no longer operate wait list, sign up for notifications when fund opens. Funds show Closed when lack of funding. HealthWell: "Your disease fund is currently closed. Sign up for alerts"
- Manufacturer copay terms: weekly
- GoodRx cash: daily, but anti-bot protection requires official API. Github reports: GoodRx live via official API when credentials configured, otherwise open public page; SingleCare direct deep link because anonymous scraping blocked 403; RxSaver 403. Sustained scraping requires sophisticated infrastructure and price volatility daily

## 4. Competitive Gap Analysis

| Competitor | What they do | What they miss vs Arik target |
|---|---|---|
| GoodRx | Compares local pharmacy prices and coupons, Inside Rx brand savings | No accumulator-state aware, no medicare_exclusion_reason, no live foundation fund status. FTC $1.5M fine for sharing health info for ads |
| Blink, RxSaver, SingleCare | Single negotiated price or comparison shop | Same gaps, no income/FPL branching |
| Cost Plus | 15% markup + $5 shipping + $3 pharmacy labor | No manufacturer pathway branching |
| TailorMed + RxSense | Surface manufacturer copay and foundation alongside cash coupons in marketplace | B2B2C inside pharmacies - closest to Arik, but not D2C case-based |

No one does state accumulator-ban suppression logic or aks vs terms distinction.

## 5. 340B / FQHC — Verification Flow Spec

HRSA: FQHC must maintain auditable records that 340B prescriptions only dispensed to qualifying patients. Requirements: outpatient only, maintains healthcare records, seen by provider within four walls of registered address in OPAIS.

Documentation categories: eligibility records, patient definition records (encounter records), duplicate discount prevention.

Patient definition: record may be single form or note page, self-reporting of identity adequate in PHE for recordkeeping. Employees eligible only if meet patient definition — employer relationship alone insufficient.

For Arik: You cannot verify 340B eligibility yourself without FQHC partnership. Flow to spec:
1. Patient asks about 340B
2. Extract location via resolveLocation.ts
3. Query HRSA OPAIS for nearby FQHCs
4. Output document: "To use 340B at FQHC pharmacy, you must be patient of record at that FQHC (outpatient visit at registered address). Bring: ID, proof you are patient of record, Rx from FQHC provider."
5. Do not store 340B eligibility as boolean — store as info path with source_id to HRSA guidance.

## 6. Disclosure Checklist for Platform Surfacing Copay Programs

- FTC: GoodRx deceptively promised never to share PHI with advertisers but did — Arik must disclose data sharing and get consent without dark patterns per FTC order
- Not insurance disclosure
- No pharma/PBM fee - click-out-only per BLUE_BUTTON doc
- Price not guaranteed, pharmacy may change
- Foundation funds open/close - check live

## 7. Build Order for Kimi Agent

1. Apply schema patches above as db/010_accumulator_ban_and_medicare_reason.sql
2. Seed sources rows for each statute and program terms URL in table 3
3. Build 3 complete bundles (Dupixent, Zepbound, Eliquis) with both exclusion reasons
4. Implement monitor job: /api/jobs/check-foundation-funds (daily), /api/jobs/check-copay-terms (weekly) — both write to sources.last_verified_at and exploit.is_active
5. Update lib/deadlines.ts style engine for accumulator: assertLegalAccumulatorState()
6. Add tests: accumulator suppressed when ban applies vs flagged when not

All exploits need source_id enforced at app layer per HANDOFF — do not ship without it.