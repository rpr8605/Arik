# HANDOFF: Arik Build (Master Index)

Read this file first, then CASE_MODEL.md, then the rest as referenced
below. This document was rewritten after a full consistency pass across
every spec doc in this repo - the schema.sql that used to accompany the
original version of this file had real bugs (forward-reference errors,
several tables described in later docs but never actually added). Those
are fixed. schema.sql is now the single source of truth for the database;
if any doc's prose description of a table conflicts with schema.sql,
schema.sql wins.

## Before anything else: run the validator, then the checklist

```
python3 scripts/validate_repo.py   # (or `python` on Windows)
```

This must pass with 0 failures before any application code is written.
Then complete **PRE_BUILD_CHECKLIST.md** in full - it covers the
constraint-enforcement and cross-doc consistency checks the script can't
automate. Report findings back before starting Phase 1 implementation.

## Not a runnable app

Nothing in this repo executes. There is no package.json, no installed
dependencies, no live database. This is a complete specification - schema,
seed data, one example API route, and design docs - ready for a coding
agent to build from. Do not go looking for app scaffolding that doesn't
exist yet; building it is the task.

## Read order

1. **This file** - index and Phase 1 scope
2. **CASE_MODEL.md** - the core architectural correction: the case, not
   the conversation, is the unit of the product. Defines cases, deadlines,
   evidence freshness, trust receipts, escalation, and outcome
   verification. Build this infrastructure before anything else.
3. **SECURITY.md** - identity/matching-profile split, why "may not be
   HIPAA-covered" is not an architecture decision, the concrete privacy
   requirements list
4. **BEHAVIOR.md** - onboarding depth, the four autonomy tiers (what Arik
   does automatically vs. what needs a one-tap confirm vs. what it never
   does), tone
5. **CRISIS_AWARE_DESIGN.md** - why onboarding is chat-first, not a form
   wall, and the standing instruction (in chat_system_prompt.md) to
   recognize real crisis language and drop task mode
6. Everything else, referenced by feature area below

## Reference docs (not schema-defining, but worth reading)

SCENARIOS.md walks through example chat exchanges matching BEHAVIOR.md's
rules, including the clinical-boundary case. METHODOLOGY.md is the source
taxonomy and evidence-grading system referenced by every data table.
ACCESSIBILITY.md covers the WCAG/voice-input approach for the frontend.
UI_UX.md is the surface-level spec (case list home, trust receipt
placement, Tier 2 confirm pattern). AGENTS.md holds OpenCode-specific
working instructions. None of these define database tables, but read them
before building the corresponding feature.

## What's actually in schema.sql (27 tables)

Grouped by the doc that specs them:

- **Identity/matching split** (SECURITY.md): `user_identity`,
  `user_matching_profile` - note the deliberate absence of an immigration
  status column (IMMIGRATION_STATUS_HANDLING.md) and SSN column
  (SECURITY.md)
- **Caregiver mode** (CAREGIVER_MODE.md): `managed_patients`,
  `authorizations_on_file`
- **Case model** (CASE_MODEL.md): `cases`, `deadlines`, `escalations`,
  `case_outcomes`, plus evidence-freshness columns on `sources`
- **Drug pricing** (Phase 1 core, README.md/seed_drugs.json):
  `drugs`, `user_medications`, `price_points`, `exploits` (now includes
  `underlying_processor`/BIN/PCN fields per
  BLUE_BUTTON_AND_DISCOUNT_GRAPH.md and
  PHARMACIST_AND_REVCYCLE_FORMATS.md), `accumulator_policies`
- **Bill auditor / denial appeals / charity care** (Phase 1.5 parallel
  track, README.md): `uploaded_documents`, `bill_audit_findings` (now
  includes `cpt_hcpcs_code`), `denial_appeals`,
  `hospital_financial_assistance_policies`
- **Exception intelligence** (EXCEPTION_INTELLIGENCE_ENGINE.md):
  `exception_precedents`
- **Employer plan knowledge base** (EMPLOYER_PLAN_DATABASE.md):
  `employer_plans`
- **Referral network** (REFERRAL_NETWORK.md, ATTORNEY_REFERRAL.md):
  `mtm_eligibility_checks`, `referral_resources`, `case_referrals`
- **Export/translation/sharing** (EXPORT_AND_TRANSLATION.md,
  CAREGIVER_MODE.md): `output_documents`, `shared_reviews`
- **Chat** (BEHAVIOR.md, CASE_MODEL.md): `chat_sessions` (now case-scoped
  - one thread per case, not one long history), `chat_messages`

## Build sequence (per CASE_MODEL.md, supersedes any older phase list)

**Before the pilot - core infrastructure:**
- Case object and status workflow
- Deadline engine
- Evidence-freshness fields on `sources`
- `user_identity`/`user_matching_profile` split, with encryption at the
  application layer on identity columns (SECURITY.md - pgcrypto, decided
  2026-07-24)
- Patient/caregiver permission model (`managed_patients`,
  `authorizations_on_file`)
- Trust receipt as a required chat output section (in
  chat_system_prompt.md)
- Privacy/deletion controls per SECURITY.md's concrete list

**Phase 1 - drug pricing (this is what route.ts and seed_drugs.json
support today):**
- Auth (Supabase email/magic-link)
- Chat-first onboarding per CRISIS_AWARE_DESIGN.md/UI_UX.md - case list as
  home screen, not a profile wall
- Wire `app/api/chat/route.ts`: `callModel()` routes via OpenRouter
  direct (decided 2026-07-24, superseding the MIST dependency - see
  Decisions locked), point `loadSystemPrompt()` at
  `chat_system_prompt.md`
- Seed `drugs`/`price_points` from `seed_drugs.json` (figures from 2026
  reporting - create the `sources` rows for them during the load; verify
  against current sources before production use)
- Manually source 10-15 real `exploits` rows (manufacturer copay cards for
  the IRA-negotiated drugs are fastest - check each manufacturer's own
  site, cite the URL + retrieval date)
- MTM eligibility check (REFERRAL_NETWORK.md) - fully computable from data
  already in `user_matching_profile`/`user_medications`, no external API,
  buildable alongside the rest of Phase 1

**Phase 1.5 - parallel track, not sequential after Phase 1:**
- Bill auditor, denial appeals, charity care screening - document-in,
  findings-out, no live monitor job needed
- Document reconciliation (CASE_MODEL.md) - cross-referencing multiple
  uploaded documents per case, not processing each independently
- Guided document capture (GUIDED_DOCUMENT_SCANNING.md) - camera-first
  guided flow with client-side quality checks; captured photos go
  straight to the extraction tier (it accepts images), no OCR service

**Phase 2:**
- Export/print/translation (EXPORT_AND_TRANSLATION.md)
- Pharmacist card and revenue-cycle dispute formats
  (PHARMACIST_AND_REVCYCLE_FORMATS.md)
- Reviewer sharing (`shared_reviews`)
- Location services (LOCATION_SERVICES.md) - zip code, not GPS, as the
  default
- Employer plan knowledge base (EMPLOYER_PLAN_DATABASE.md)

**Phase 3 and later:**
- Insurer/PBM ownership graph, Blue Button 2.0 integration
  (BLUE_BUTTON_AND_DISCOUNT_GRAPH.md)
- Exception intelligence engine full build-out
  (EXCEPTION_INTELLIGENCE_ENGINE.md) - schema exists now, data-sourcing
  from CA/NY public databases is the actual work
- Attorney/broader referral network at scale (ATTORNEY_REFERRAL.md,
  REFERRAL_NETWORK.md) - MTM ships in Phase 1, the rest waits
- Hospital/imaging price shopping, insurance plan optimizer

## Non-negotiable constraints (unchanged, still the whole reason this exists)

- Chat response model speaks only from retrieved context - see
  chat_system_prompt.md's hard rules and crisis-awareness section. When
  retrieval is empty, the route short-circuits to a deterministic
  "no data on that" response in code - the model is never asked to
  answer from nothing.
- Every `exploits`/`accumulator_policies`/`exception_precedents` row needs
  a non-null `source_id`, enforced at the application layer (schema.sql
  does not constrain this at the DB level yet)
- No PBM/pharma/discount-network revenue of any kind, including affiliate
  links - see BLUE_BUTTON_AND_DISCOUNT_GRAPH.md's click-out-only model
- No attorney pay-for-placement, ever - see ATTORNEY_REFERRAL.md
- No clinical recommendations, ever - cost/coverage information only (see
  SCENARIOS.md Scenario 5 for the exact boundary behavior)
- No immigration status persistence, ever - ephemeral check only, see
  IMMIGRATION_STATUS_HANDLING.md
- Demographic eligibility fields (race, sexual orientation/gender
  identity, etc.) are opt-in, additive-only, never affect core pricing -
  see DEMOGRAPHIC_ELIGIBILITY.md

## Decisions locked (2026-07-24)

- **Model router**: OpenRouter direct, two tiers (lib/modelConfig.ts):
  `anthropic/claude-haiku-4.5:floor` for extraction,
  `anthropic/claude-sonnet-4.6:floor` for response. `:floor` = cheapest
  provider; `max_price` caps are sent with every call and failures throw -
  no silent fallback to a premium provider. This supersedes the earlier
  "share the MIST project's OpenRouter setup" decision (never landed in
  the repo; replaced same-day).
- **Identity encryption**: pgcrypto at the application layer, per
  SECURITY.md. No external vault for the pilot; revisit if volume
  justifies it.
- **MTM cost threshold**: $1,276 for 2026, verified against CMS's CY2026
  MTM Program memo (v.05.06.2025: "Based on analysis of 2024 PDE data,
  the MTM cost threshold will be $1,276 for 2026," per 42 CFR
  423.153(d)(2)(i)(C)). Plans may set *lower* thresholds, so present
  matches as "likely eligible," not a hard boolean. Re-verify annually
  against the current-year CMS memo.

## Known open items

- `output_documents.source_id` is intentionally polymorphic (not a real
  FK) since it can point at several different tables - enforce the
  relationship at the application layer
- `employer_plans.extracted_plan_facts` must be scrubbed of any
  contributing uploader's identity before being cached - this is an
  extraction-pipeline requirement, not just a schema comment
- EXCEPTION_INTELLIGENCE_ENGINE.md is referenced for Phase 3 work but is
  still not in the repo - restore or draft it before that phase starts
  (schema already reflects its decisions; PHARMACIST_AND_REVCYCLE_FORMATS.md
  arrived 2026-07-24)
