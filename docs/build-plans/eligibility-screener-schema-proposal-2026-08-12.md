# Proposal — Eligibility Screener + Population Pathways Schema Extension (2026-08-12)

Status: **PROPOSAL ONLY — nothing applied.** Review the shape; on approval
this becomes the next migration (number assigned at build time; the
evidence fold and this are both additive and order-independent).

## Step 1 findings this proposal is built on

- `exploits.exploit_type` **already distinguishes** PAP from copay card as
  real values (live DB: 8 `copay_card`, 7 `pap`, 1 `statutory_cap`) — but
  the column has **no CHECK constraint**; the vocabulary is convention,
  not enforcement. Eliquis carries one of each, which is what let the AKS
  hard-block surface the PAP. (Dupixent/Zepbound still don't exist in
  `drugs` — bundle seeding remains on hold.)
- **No eligibility-screener pattern exists.** The nearest analog is
  `mtm_eligibility_checks` + `lib/mtm.ts` (pure compute → stored per-user
  result) — proof the shape works here, but it's MTM-specific. Nothing
  models a benefit that changes cost across a patient's whole regimen.

## Proposed changes

### 1. `exploits` — two small additions, no rework
- `referral_only boolean not null default false` — hard signal to the
  future ranking engine: NEVER show this with a dollar figure; surface as
  "ask your provider about this" only. First intended users: 340B entries,
  per the four passes (institutional mechanism, no patient-level price
  guarantee).
- `CHECK (referral_only = false OR estimated_savings_usd IS NULL)` — the
  no-dollar-figure rule enforced at the DB level, not by convention.
- `exploit_type` vocabulary documented in a schema comment (existing
  values stay); a CHECK constraint on `exploit_type` is offered as an
  OPTION — flag your preference. (Leaning against: METHODOLOGY.md's
  taxonomy is 14 categories and still evolving; a hard CHECK makes every
  new type a migration.)

### 2. New table `eligibility_programs` (reference data)
Benefits that aren't per-drug exploits — they reprice the whole regimen
or reroute the patient to a different coverage system.

| column | notes |
|---|---|
| `id uuid pk` | |
| `program_key text unique not null` | 'extra_help_lis', 'msp_qmb', 'msp_slmb', 'msp_qi', 'medicaid', 'chip', 'va_health', 'tricare', 'champva', 'ihs_tribal' |
| `display_name text not null` | |
| `category text not null` | 'regimen_benefit' (Extra Help, MSPs, Medicaid, CHIP) or 'population_pathway' (VA, TRICARE, CHAMPVA, IHS/tribal) |
| `eligibility_rules jsonb` | income/asset limits, FPL linkage, auto-eligibility triggers; for population pathways: branching factors (VA priority group, service-connected rating, beneficiary class, IHS/tribal relationship) |
| `benefit_summary text not null` | what it changes, in plain language; NO dollar figures on referral_only rows |
| `referral_only boolean not null default false` | same rule as exploits; population pathways default true until their branching is actually modeled |
| `source_id uuid not null references sources(id)` | Ticket-1 standing rule: DB-level NOT NULL on new sourced tables |
| `last_verified_at timestamplike`, `effective_date date` | freshness discipline, same as exploits |
| `created_at` | |

RLS: authenticated read, service-role write (reference-data pattern).

### 3. New table `patient_eligibility_results` (user data)
The per-user screening outcome — deliberately mirrors the proven
`mtm_eligibility_checks` shape:

`id`, `user_id`, `program_key` (FK to the reference table's key),
`result text CHECK IN ('likely_eligible','likely_not','insufficient_info')`
— "likely" language per the locked MTM-threshold decision, never a hard
boolean — `basis jsonb` (which profile facts drove the result),
`computed_at`. RLS: owner-read, service-role write (user-data pattern).
Computation lives in a pure lib function (mtm.ts pattern) fed by
`user_matching_profile` (income_pct_fpl, household_size, insurance_type,
state) — no model calls.

### 4. Explicitly NOT in this migration
HSA/FSA, international importation (Section 804 state programs tracked
separately later), ADAP build-out (second pass), biosimilars/Purple Book
(post-ranking-engine), any VA/TRICARE data seeding beyond proving the
shape holds them (rows land as `referral_only=true` placeholders only if
you want them visible; say which).

### 5. First content row (upon approval): Medicare Extra Help
Verified 2026 figures, primary sources only, scraped 2026-08-12:

- **Income limit:** $23,940 individual / $32,460 married couple
  (medicare.gov "Help with drug costs" page, 2026 table)
- **Resource limit:** $18,090 / $36,100 **including** burial exclusion;
  SSA POMS HI 03030.025 states the statutory countable-resource limits as
  $16,590 / $33,100 with the $1,500/$3,000 burial exclusion added
  automatically by MAPS — the two primary sources reconcile exactly
  ($16,590+$1,500=$18,090; $33,100+$3,000=$36,100)
- **2026 cost sharing:** $0 premium, $0 deductible; up to **$5.10**
  generic / **$12.65** brand per fill; $0 after $2,100 total drug costs;
  ≤$4.90 per covered drug for QMB+full-Medicaid (medicare.gov, "What
  you'll pay under Extra Help in 2026")
- **Auto-eligibility:** full Medicaid, MSP (QMB/SLMB/QI), SSI
- **Not available** in PR/USVI/Guam/NMI/American Samoa

Seeding = 1 `eligibility_programs` row + 2 `sources` rows (medicare.gov
page + SSA POMS section), `last_verified_at` 2026-08-12. NOT wired into
chat/ranking — correctly modeled and sourced only, same discipline as the
drug data.

---

# V2 — 2026-08-12: identity-linked pathway integration (post-research)

Incorporates the identity-linked research pass (five categories) and the
Step-2 verification results below. Still a proposal — nothing applied.

## Verified inputs this version is built on (all primary, scraped 2026-08-12)

- **PAN/TotalAssist sickle cell fund**: diagnosis-gated + income ≤500%
  FPL (COLI-adjusted) + government insurance (Medicare/Medicaid/TRICARE);
  award $2,800 guaranteed / $5,600 max; **status: CLOSED** today
  (totalassist.org fund list + fund page — a live example of the
  "funds close" fixture pattern).
- **ORR PL 16-01 eligible statuses** (read directly): refugees, asylees,
  Cuban/Haitian entrants, Iraqi/Afghan Special Immigrants (rev. 5/20/24),
  Amerasians, trafficking victims, Afghan + Ukrainian Humanitarian
  Parolees (added 11/29/22); URM program for SIJS/U-status minors. RMA
  duration: page says only "time-limited" — **12-month duration NOT
  primary-verified this pass; confirm before modeling.**
- **NBCCEDP**: income ≤250% FPL; ages **40–64 breast / 21–64 cervical**
  (some exceptions); its race/ethnicity categories are program
  *reporting* fields, not eligibility (cdc.gov screenings page).
- **IHS**: eligibility = enrolled member of a federally recognized tribe
  (IHM Part 2 Ch. 1); IHS/tribal/urban pharmacy fills carry no charge to
  eligible patients; external pharmacy = patient pays (IHS patient FAQ).
- **Title X**: income-only gate (free ≤100% FPL, sliding to 250%);
  serves all genders; serves undocumented immigrants (Guttmacher,
  secondary — OPA page extracted too thin to cite, flagged).
- **Immigration-status safeguard**: IMMIGRATION_STATUS_HANDLING.md exists
  and is schema-anchored (schema.sql user_identity comment). Code
  enforcement today = total absence of any collection path (grep-verified:
  no immigration field/logic anywhere). The ephemeral-USE flow is
  spec'd-not-built; the doc gates it behind the first program that
  requires it + human review. RMA screening would be that trigger.

## The shape (builds on V1's two tables, adds four fields)

1. **Diagnosis-gated disease funds → the EXISTING `exploits` table.**
   Confirmed reuse, no new structure: `exploit_type='foundation_grant'`
   (new documented vocabulary value — no CHECK constraint, per V1's
   open option), `eligibility_criteria` carries
   `{diagnosis_required, income_fpl_max, insurance_requirement,
   fund_status, fund_status_checked_at}`. fund_status is live data
   (open/closed/waitlist) — same honesty rule as the fixtures.
2. **Status-gated pathways (IHS, RMA) → `eligibility_programs`** with
   category='population_pathway' plus TWO new fields:
   - `channel_restriction text` — real field, not a note. IHS row gets
     'ihs_tribal_urban_pharmacy_only'; surfacing must say where the
     benefit applies. Null = no channel constraint.
   - `screening_data_policy text not null default 'persist_profile'
     CHECK IN ('persist_profile','ephemeral_only')` — RMA gets
     'ephemeral_only': the screener may use the answer in-memory but
     must persist nothing (codifies IMMIGRATION_STATUS_HANDLING.md at
     the row level; that doc's human-review gate applies before the
     ephemeral flow ships).
3. **Statutory sex-linked (NBCCEDP, Title X) → `eligibility_programs`**,
   category='regimen_benefit'. Gates read income + an opt-in sex/gender
   marker from `demographic_eligibility_flags` (existing opt-in,
   additive-only jsonb — DEMOGRAPHIC_ELIGIBILITY.md). NBCCEDP age bands
   live in `eligibility_rules`. DEPENDENCY FLAG: income gating needs
   `user_matching_profile.income_pct_fpl`, which is in the held evidence
   fold (db/015) — approve that or screeners compute on nothing.
   CHIP age-gating has an open detail for review: DOB sits in the
   encrypted identity vault (form-generation decrypts only) — screener
   would consume a derived over/under-age boolean captured at screening
   time, never the DOB itself. Confirm that pattern.
4. **CHIP → same `eligibility_programs` row shape** (category
   'regimen_benefit', age + income rules). No parallel structure.
5. **Point of Pride / gender-affirming funds → `eligibility_programs`**
   with the third + fourth new fields, making the state-legal caveat
   STRUCTURAL, not a comment:
   - `requires_legal_status_caveat boolean not null default false`
   - `render_caveat text`
   - `CHECK (requires_legal_status_caveat = false OR render_caveat IS NOT NULL)`
   — the row cannot exist without its caveat text; the surfacing layer
   renders `render_caveat` verbatim wherever the row appears. Gender
   identity itself lives only in opt-in `demographic_eligibility_flags`.
6. **Black Lung**: noted, not designed this pass (narrow, occupational).

## Hard rule (self-check on this proposal)

**No field anywhere for self-reported race or ethnicity.** Verified
against this proposal: nothing in it collects race/ethnicity — the
research found zero programs that gate on it, and NBCCEDP's race
categories are federal reporting fields, not eligibility. If any future
addition to these tables requires collecting race/ethnicity directly,
that addition is a red flag to reject, not something to build quietly.

---

# STATUS — APPLIED 2026-08-12

Applied as `db/015_income_pct_fpl.sql` (single approved column pulled
forward; the rest of the evidence fold stays held) and
`db/016_eligibility_screeners.sql` (schema + seeds above, MINUS RMA and
CHIP rows per owner instruction). Verified: both CHECK constraints reject
bad writes; RLS on both tables; seeds idempotent on re-run. The vaulted-
DOB round-trip (CHIP's future age gate) is proven working
(encrypt/decrypt helpers round-trip; age derived in code, value
discarded). Extra Help seed + wiring remains gated on the earlier
ticket's approval flow.

