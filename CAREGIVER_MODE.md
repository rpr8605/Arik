# Arik: Caregiver Mode

## Why this matters

A large share of the highest-value bill-auditor cases won't be the patient
using Arik for themselves - it'll be an adult child managing a parent's
billing across a long hospitalization history, exactly the kind of
situation that surfaces the most value (recurring errors across many
admissions, coordination-of-benefits mistakes between Medicare and a
secondary/retiree plan) and the most real paperwork friction.

## The authorization problem

Payers, hospitals, and PBMs generally will not discuss or process a
dispute or appeal with anyone but the patient unless a specific
**Authorized Representative** designation is on file - a signed form, not
just a family relationship. This is true across Medicare, most commercial
payers, and most hospital billing departments. Skipping this step means a
perfectly drafted dispute letter goes nowhere because whoever receives it
can't legally discuss the account with the sender.

This has to be a real, tracked part of the product, not an assumption:

- Caregiver account setup includes generating or collecting the specific
  authorization form each payer/hospital requires (these differ - Medicare
  has its own, most commercial payers have their own, hospitals often
  accept a simpler HIPAA release for billing-only conversations)
- Arik should flag, before drafting anything on the patient's behalf,
  whether an authorization is already on file with the specific recipient
  - if not, generating and getting that signed is the actual first step,
  not an afterthought
- This is a Tier 2 action in BEHAVIOR.md's autonomy tiers - the signature
  on an authorization form has to come from the patient (or their legal
  representative, if the patient lacks capacity), same as everywhere else
  a real signature is required

## What changes structurally

- One login can manage multiple patient profiles (self, plus one or more
  family members), each with their own `user_matching_profile`,
  medications, uploaded documents, and findings - not merged into the
  caregiver's own profile
- Each managed patient profile tracks authorization status per
  payer/hospital relationship, not just a single blanket "I'm authorized"
  flag - a dispute with Hospital A doesn't imply authorization is on file
  with Medicare or the secondary payer
- The "running ledger across many admissions" idea is a caregiver-mode
  specific value: aggregate view across a full year of billing activity
  for one managed patient, surfacing recurring errors (the same facility
  making the same coding mistake three admissions in a row) that a
  single-bill-at-a-time view would never catch

## Auto-drafting the authorization paperwork itself

Since Arik already knows the patient's name, DOB, address, and insurance
details from onboarding, and already tracks which entity-specific
authorization form is required per `authorizations_on_file`, drafting the
actual Authorized Representative or HIPAA release form is the same
pattern as everything else in BEHAVIOR.md - pre-fill everything Arik
already knows, leave only what genuinely requires the patient's own
decision.

Important distinction from every other pre-filled form in this system:
**this one grants real legal authority over the patient's own healthcare
communications.** Auto-drafting it is fine and genuinely useful - it's a
Tier 0 action, no different from drafting an appeal. But the decision to
sign it, and the signature itself, has to be an unambiguous, explicit act
by the patient (or whoever legally holds decision-making authority for
them) - Arik should present the form with a plain-language summary of
exactly what authority is being granted before it's ever presented for
signature, not just hand over a filled PDF and assume the caregiver will
explain it. This is the same Tier 2 boundary as submitting anything else
that leaves the system, just with higher stakes than a typical appeal.

## Reviewer sharing - a distinct, lighter-weight mode

Separate from full caregiver management: any user should be able to share
a specific bill, finding, or draft with another person for a second set
of eyes, without granting that person any authority to act. This covers
the much more common case where someone doesn't have (or doesn't need)
formal caregiver authorization - a spouse, an adult child, a friend, just
wanting help understanding something confusing or scary.

Key design rules that keep this from becoming a quiet backdoor around the
authorization requirement:
- **View-only by default**, optionally commenting - never able to trigger
  a Tier 2 action (submit, sign, send) on the patient's behalf
- **The patient owns the share, not the reviewer** - a shareable, revocable
  link, expiring by default rather than open-ended, no separate Arik
  account required for the reviewer to just look and comment
- **Revocation is immediate and one-tap** - if the patient wants to pull
  access, it's instant, not a support ticket
- **Never conflate "someone I shared this with" with "my authorized
  representative"** - a reviewer looking at a bill has no more standing
  with the hospital or payer than before the share existed. This should
  be stated plainly in the UI when a share is created, not left implicit.

## Schema addition for reviewer sharing

```sql
create table shared_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id), -- nullable, if sharing on own behalf
  source_type text not null,       -- 'bill_audit_finding', 'denial_appeal', 'uploaded_document'
  source_id uuid not null,
  permission text default 'view',  -- 'view', 'comment'
  share_token text unique not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);
```



```sql
create table managed_patients (
  id uuid primary key default gen_random_uuid(),
  caregiver_user_id uuid references auth.users(id),
  patient_name text not null,
  relationship text,               -- 'parent', 'spouse', 'child', etc
  created_at timestamptz default now()
);

create table authorizations_on_file (
  id uuid primary key default gen_random_uuid(),
  managed_patient_id uuid references managed_patients(id),
  entity_name text not null,        -- 'Medicare', specific hospital, specific payer
  authorization_type text,          -- 'authorized_representative', 'hipaa_release'
  status text default 'not_started', -- 'not_started', 'form_generated', 'submitted', 'on_file'
  document_id uuid references uploaded_documents(id),
  created_at timestamptz default now()
);
```

`uploaded_documents`, `bill_audit_findings`, and `denial_appeals` all gain
an optional `managed_patient_id` so caregiver-mode records point at the
right patient rather than the caregiver's own profile.

## What this means for the build

This is a real scope addition, not a small toggle - worth treating as its
own phase alongside the bill auditor/denial appeal track rather than
squeezing into the original single-user assumption. Good news: your
father's actual situation is a strong real pilot case for exactly this
mode once the bill auditor MVP exists - a full year of real admissions,
real coordination-of-benefits complexity, real stakes. Worth keeping his
documents ready for whenever this is buildable.
