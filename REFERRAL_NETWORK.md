# Arik: Referral Network (Build-Ready)

## The rule that governs every referral in this doc

Arik supplies cost/access facts. A licensed professional owns the
clinical or legal judgment. Nobody pays for placement. This applies
identically to every category below and to ATTORNEY_REFERRAL.md - it's
the same rule, just applied to a much more common set of situations.

## Medication Therapy Management (MTM) - build this first, fully specified

Real, verified, CMS-required for every Medicare Part D plan. Free to the
patient, no added copay. A pharmacist reviews the patient's full
medication list and can suggest lower-cost alternatives directly to the
patient and their doctor - the pharmacist makes the suggestion, not Arik.

**Eligibility criteria (matchable against data Arik already has):**
- At least 3 of a defined set of chronic conditions (diabetes,
  hypertension/cardiovascular, dyslipidemia, respiratory disease
  including asthma/COPD, bone disease/arthritis, mental health
  conditions including depression/schizophrenia/bipolar disorder), OR
- Taking 8 or more chronic/maintenance Part D-covered medications per
  month, AND
- Likely to incur at least ~$1,276/year in covered Part D drug costs
  (threshold set annually by CMS/plans - verify current-year figure
  before hardcoding)

Enrollment is automatic for qualifying beneficiaries, but many eligible
patients don't know it exists or haven't been proactively contacted -
Arik's value here is entirely in surfacing eligibility and prompting the
patient to request it if their plan hasn't reached out yet.

```sql
create table mtm_eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  chronic_conditions_count int,
  part_d_medication_count int,
  estimated_annual_drug_cost_usd numeric,
  meets_condition_criteria boolean,
  meets_medication_count_criteria boolean,
  meets_cost_threshold boolean,
  eligible boolean,               -- computed: (conditions AND cost) OR (med_count AND cost), per CMS rule structure
  checked_at timestamptz default now()
);
```

This is a pure computation against data already in `user_medications` and
`user_matching_profile` (chronic condition flags need adding to the
matching profile) - no external API, no live lookup, fully buildable now.

## Broader referral network schema

Extends the `escalations` table from CASE_MODEL.md rather than
duplicating it - referrals are a lighter-weight version of the same
concept (connect the patient to a human), without necessarily implying
the case is escalated/uncertain the way an attorney referral does.

```sql
create table referral_resources (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,     -- 'mtm_pharmacist', 'billing_advocate', 'hospital_financial_counselor',
                                    -- 'disease_foundation_advocate', 'attorney', 'dietitian_care_coordinator'
  name text,
  organization text,
  region text,                     -- ties to zip/region from LOCATION_SERVICES.md where relevant
  contact_info jsonb,
  cost_to_patient text,            -- 'free', 'sliding_scale', 'standard_fee' - set explicitly, never assumed
  source_id uuid references sources(id),
  created_at timestamptz default now()
);

create table case_referrals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  referral_resource_id uuid references referral_resources(id),
  reason text,                     -- the specific factual trigger, e.g. 'mtm_eligible', 'financial_counselor_needed'
  status text default 'suggested', -- 'suggested', 'contacted', 'in_progress', 'resolved'
  created_at timestamptz default now()
);
```

## Referral categories and their trigger logic

| Category | Trigger | Cost to patient |
|---|---|---|
| MTM pharmacist | Meets CMS eligibility criteria above | Free (required benefit) |
| Hospital financial counselor | Charity-care case exists (`bill_audit_findings`/charity screening already in scope) | Free |
| Billing/patient advocate | Case complexity/escalation score high (CASE_MODEL.md) | Varies, disclose plainly |
| Disease foundation advocate | Patient matched to a foundation PAP (`exploits` table) | Free |
| Attorney | Factual trigger conditions from ATTORNEY_REFERRAL.md only | Varies, bar-rule reviewed |
| Dietitian/care coordinator | Chronic condition management case where cost ties to disease progression | Varies |

## What this means for the build

- `user_matching_profile` needs a `chronic_conditions` field (array or
  boolean flags) to support MTM matching - this is new, not previously
  scoped
- MTM eligibility check can run automatically the moment a patient's
  medication list crosses the threshold, surfaced proactively rather than
  waiting for the patient to ask - a good example of the "grab it and
  already have it ready" behavior from BEHAVIOR.md applied to a referral
  instead of a form
- `referral_resources` needs real sourcing (which billing advocates,
  which hospital financial counselor programs, which foundation contacts
  are legitimate and current) - same ongoing-sourcing-task pattern as
  everything else fed by METHODOLOGY.md's monitor logic, not a one-time
  import
- This is genuinely Phase 1.5/2 scope, buildable alongside the bill
  auditor track rather than blocked on anything not yet built
