# Arik: The Case Model (Core Architecture Correction)

## The single biggest change

Every prior doc in this repo implicitly treated the chat conversation as
the product. It isn't. **The case is the product - chat is just how the
patient talks to it.** A case is created the moment a bill, denial, or
prescription question comes in, and it persists through evidence
gathering, eligibility determination, action (letter/application drafted),
submission, follow-up, resolution, and verified outcome - closed only when
the patient saves money, loses the appeal, or deliberately closes it.
This is core infrastructure, built before the pilot, not retrofitted after
real documents and cases already exist in an unstructured form.

## The case object

```sql
create table cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id), -- nullable
  case_type text not null,          -- 'bill_dispute', 'denial_appeal', 'prescription_savings', 'charity_care'
  amount_at_risk_usd numeric,
  estimated_recoverable_usd numeric,
  status text default 'gathering_evidence',
    -- 'gathering_evidence', 'action_ready', 'submitted', 'awaiting_response',
    -- 'resolved_won', 'resolved_lost', 'closed_by_patient', 'escalated'
  organizations_involved text[],     -- payer, hospital, manufacturer, etc
  next_action text,
  next_action_due date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Every `uploaded_documents`, `bill_audit_findings`, `denial_appeals`, and
`output_documents` row gains a `case_id` foreign key. A case aggregates
everything related to one problem instead of scattering it across
disconnected tables the patient has to mentally reassemble.

## Deadline and rights engine

Deadlines differ by jurisdiction, plan type, and appeal stage - this
needs to be a real, queryable engine, not a fact buried in a chat
response.

```sql
create table deadlines (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  rule_jurisdiction text,           -- 'federal', state code, or payer-specific
  plan_type text,
  notice_date date,
  presumed_receipt_date date,
  filing_deadline date not null,
  extension_available boolean default false,
  extension_conditions text,
  escalation_path text,
  required_attachments text[],
  source_id uuid references sources(id),
  last_verified_at timestamptz,
  created_at timestamptz default now()
);
```

Arik surfaces this as a visible countdown, not a one-time mention: "Your
appeal is due in 23 days. The letter's ready - you still need the
physician's supporting note." The countdown persists across the whole
life of the case, not just the turn where the deadline was first
mentioned.

## The Money Map - a ranked strategy, not a list of options

For prescription cases specifically, replace "here are seven programs
that might help" with one ranked, computed answer:

```
Best path today
Estimated savings: $418/month
Confidence: High
Reason: Verified manufacturer eligibility plus current plan terms
Tradeoff: Payment may not count toward your deductible
```

Every route considered (insurance, alternate pharmacy, cash, PAP, copay
card, foundation, FQHC/340B, formulary exception) gets: estimated
out-of-pocket cost, confidence level, eligibility requirements, time to
obtain, deductible/OOP-max effect, accumulator risk, and whether the
number is confirmed or estimated. This is the existing exploit-matching
logic, just required to output one ranked recommendation with tradeoffs
shown, not a menu.

## Document reconciliation - the "holy crap" feature

Most real billing errors only surface when documents are compared against
each other, not read individually. Build a normalized claim model that
ingests provider bill, EOB, itemized statement, denial letter,
prior-authorization record, good-faith estimate, payment receipt, and
plan summary together, then diffs them for mismatches: patient billed
more than EOB responsibility, duplicate services, payment not credited,
wrong network status, incorrect denial reason, missing prior auth despite
documented approval, charge differing from a good-faith estimate (the
federal $400-over-estimate dispute threshold applies here), charity-care
eligibility not considered, resubmission under a different code,
facility/professional component inconsistency.

This is a real extension of `bill_audit_findings` - the extraction layer
needs to hold multiple documents in context simultaneously and diff them,
not process each upload independently.

## Communication layer - "send it correctly," then track it

Every generated letter/form needs to travel with: correct department,
mailing address, fax number, portal instructions, phone number,
submission deadline, cover sheet, certified-mail recommendation where
appropriate, a place to upload proof of submission, a follow-up date, and
phone/voicemail scripts. After generation, Arik asks "did you submit
this?" - once confirmed, the case's `next_action_due` updates and the
response-timer/follow-up starts. This is what turns a document generator
into something that actually carries the fight, matching `case.status`
transitions (`action_ready` → `submitted` → `awaiting_response`).

## Controlled human escalation

Some cases are too uncertain or too high-stakes for Arik to carry alone.

```sql
create table escalations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  escalation_score int,             -- computed from factors below
  reason text,
  reviewer_type text,               -- 'billing_advocate', 'revcycle_specialist', 'pharmacist', 'medicare_specialist', 'attorney'
  status text default 'queued',     -- 'queued', 'in_review', 'reviewed', 'declined'
  created_at timestamptz default now()
);
```

Score factors: dollar amount, evidence confidence, deadline proximity,
clinical complexity, legal ambiguity, conflicting documents, collections/
litigation risk, repeated unsuccessful appeals, vulnerable-patient
indicators. Don't build a marketplace yet - a small, manually managed
review panel that reviews a pre-assembled packet (not starting from
scratch) is the right scope until real usage shows which expertise
patients actually need.

## Evidence freshness - citations aren't enough on their own

Every `sources` row needs more than a URL:

```sql
alter table sources add column effective_date date;
alter table sources add column expiration_date date;
alter table sources add column last_verified_at timestamptz;
alter table sources add column superseded_by uuid references sources(id);
alter table sources add column content_hash text;
alter table sources add column next_review_due date;
```

When a source's content changes (detectable via `content_hash` on
scheduled re-checks), the old record gets flagged stale, the diff gets
surfaced, and anything built on the stale version is blocked from
high-confidence use until reviewed. CMS's own hospital price transparency
rules changing enforcement dates in 2026 is exactly the kind of source
where "we cited it once" isn't enough.

## Trust receipt - on every single answer

A collapsible "why Arik believes this" block on every recommendation:
facts extracted from the patient's documents, facts the patient supplied,
external evidence used, calculations performed, assumptions made,
information still missing, confidence score, what could change the
conclusion, and when each source was last verified. This is the
single biggest differentiator for making an aggressive-sounding system
stay trustworthy - it makes the evidence chain visible without forcing
the patient to read the full record themselves. Belongs in
`chat_system_prompt.md` as a required output section, not an optional
flourish.

## Outcome verification before any success fee

Never bill against "did this save you money?" as a yes/no. Require:
original amount owed, revised amount owed, refund received, future
monthly savings and duration, proof document, whether Arik's action
caused the outcome, whether savings are recurring or one-time, and
patient confirmation. Fee rules: no fee on unverified savings, no
percentage against hypothetical savings, a clear cap, no fee on benefits
the patient already had before Arik touched the case, a dispute/refund
process, and a hardship waiver. This is what keeps the success-fee model
from feeling predatory and is a direct, necessary extension of the
outcome-tracking gap already flagged in the earlier product synopsis.

## Build sequencing (supersedes the phase order in HANDOFF.md)

**Before the pilot (core infrastructure, not optional):**
- Case object and status workflow
- Deadline engine
- Outcome and savings ledger
- Evidence freshness fields
- Document reconciliation
- Patient/helper permission model (caregiver mode moves up from Phase 2 -
  retrofitting permissions after real documents exist is much harder than
  building them in from the start)
- Trust receipt
- Privacy and deletion controls (see SECURITY.md revision)

**During the first pilot:**
- Charity-care workflow as a first-class feature, not buried under
  generic bill negotiation
- Prescription Money Map
- Submission and follow-up tracking
- Human escalation queue
- Outcome verification

**After real cases exist:**
- Blue Button integration
- Employer population reporting
- Payer prior-authorization API integrations (CMS compliance dates
  generally arriving 2027)
- Hospital transparency ingestion at scale
- Ownership/money-flow graph

This resequencing matters more than any individual feature on the list -
proving Arik can close individual cases comes before any of the
strategically valuable but non-essential integrations.
