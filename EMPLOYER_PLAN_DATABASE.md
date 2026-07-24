# Arik: Employer Plan Knowledge Base

## Feasibility, honestly

No public, comprehensive database of employer-sponsored plan designs
exists - this is private information between employer and insurer/TPA.
Form 5500 filings (public, searchable via DOL's EFAST2 system) confirm
whether a large employer is self-insured and give coarse financial
summaries, but not plan design details (deductibles, tiers, formulary,
network). Enterprise benefits-benchmarking data (Mercer, Aon-style
surveys) exists but is expensive, licensed, aggregate-only, and not
practically accessible to a lean build. Arik cannot "just know" any
employer's plan on day one.

## What's actually buildable: extraction-cache network effect

The same document extraction pipeline already built for the bill
auditor/denial appeal track (Task 1's cheap extraction model) applies
here directly. The first employee at any given employer who uploads their
Summary Plan Description gets it extracted into structured plan-design
facts. That extracted record gets cached, keyed to
`(employer_name, region, plan_year, plan_tier)`, and reused for every
subsequent patient matching that same key - no new upload needed. This
compounds: the more patients use Arik, the more employer plans are
already known, and the faster/easier onboarding gets for the next patient
at any already-seen employer. This is a real, growing moat that costs
nothing extra to build since it reuses existing extraction logic against
a cache instead of a one-off per-patient process.

```sql
create table employer_plans (
  id uuid primary key default gen_random_uuid(),
  employer_name text not null,
  region text,                      -- state or metro area, plan networks vary by region
  plan_year int,
  plan_tier_name text,              -- 'PPO Base', 'HDHP + HSA', etc - employers usually offer several
  extracted_plan_facts jsonb,       -- deductible, oop_max, copay tiers, formulary reference, network name
  contributing_upload_count int default 1,
  confidence text,                  -- more contributing uploads = higher confidence the extraction is accurate/current
  last_updated_at timestamptz default now(),
  created_at timestamptz default now()
);
```

## Honest limitation: this narrows, it doesn't uniquely resolve

Employers commonly offer multiple plan tiers, and designs change year to
year. "I work at Apple, I live in Austin" narrows the match to a short
list of known tiers for that employer/region/year, but the patient
usually still needs to confirm which specific tier they're enrolled in -
visible on their insurance card. Set this expectation plainly rather than
implying a single magic lookup: "Here's what Apple employees in Austin
typically have this year - which one matches your card?"

## Critical privacy separation

The plan-design facts (deductible, tiers, formulary, network) are
reusable across many employees at the same company - that's the entire
point. **The uploading patient's own identity must never travel with the
cached record.** Before anything gets written to `employer_plans`, the
extraction step must strip name, member ID, DOB, and any other
personally-identifying fields from the source SPD, keeping only the plan
design itself. No other patient at the same employer should ever be able
to infer who the original uploader was, and the original uploader's own
`uploaded_documents` record (with their real identity) stays entirely
separate from the shared `employer_plans` cache.

## Upgrade path: formal employer partnerships

The crowdsourced/extracted version is the bootstrap, not the endpoint.
Once a real employer/union B2B relationship exists (already the
established revenue track), getting authoritative plan data directly from
the employer's own benefits team is strictly better than reverse-
engineered extraction - accurate, current, and doesn't depend on waiting
for an employee to upload anything. Worth treating the crowdsourced cache
as what gets this working before any formal partnership exists, not as a
permanent architecture.

## What this means for the build

- This is a Phase 2+ feature, dependent on the bill-auditor extraction
  pipeline already existing - can't be built before Phase 1.5
- `user_matching_profile` gains optional `employer_name` and `region`
  fields (region likely derivable from zip code, per LOCATION_SERVICES.md)
- The onboarding/task-triggered prompt for this should explain plainly why
  it's being asked ("this can save you from uploading your plan documents
  if we already know your employer's plan") - same transparent framing
  used for every other optional disclosure in this system
- Confidence scoring matters here specifically: a plan record built from
  one upload from a year ago is much less trustworthy than one confirmed
  by several recent uploads - surface that confidence level to the
  patient rather than presenting a stale or thin match as certain
