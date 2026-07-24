# Arik: Data Retention Policy

## The actual design lever: retention window, not "avoid holding data"

Arik cannot audit a bill it never sees, so some amount of data has to exist
somewhere while a case is being worked. The real privacy lever isn't
whether to hold anything - it's **how long, and what happens automatically
when that window closes.** This is a legitimate, common pattern for
services that aren't ready to be full permanent-record custodians:
process what's needed, keep only what the patient needs to keep working
the case, delete on a defined schedule rather than by default forever.

This also isn't just a privacy tradeoff - it's a genuine trust
differentiator worth saying out loud to patients, consistent with the
"we don't profit from your data" positioning already on the marketing
site: "your information stays only as long as you're actively using it,
then it's gone."

## Three different things, three different retention rules

Don't treat "the data" as one blob with one retention rule - it's at
least three genuinely different things with different real requirements:

### 1. Raw uploaded documents (the actual photo/PDF of a bill, EOB, denial letter)

**Shortest retention of the three.** This is the highest-risk artifact -
a photo of a bill often has more identifying detail on it than Arik
actually needs (full account numbers, sometimes SSN fragments, provider
letterhead). Per SECURITY.md's existing principle: extract what's needed,
then delete the raw file. Concretely: **delete within a defined short
window after successful extraction** (hours, not days) - once the
structured findings are confirmed accurate, the original image has done
its job. Keep a short grace period (a day or two) in case extraction
needs to be re-run or a quality issue surfaces, then it's gone regardless
of what happens to the case afterward.

### 2. Extracted structured findings (the case itself: dollar amounts, CPT codes, dates, the drafted appeal, the dispute status)

**Tied to the case's actual lifecycle, not a fixed short window** - this
is the part that has to persist for the product to work at all. A denial
appeal can have a 60-day resolution clock; charity care applications take
weeks; a caregiver tracking a parent's admissions needs the picture to
persist across the whole hospitalization. Retention rule: **kept for the
life of the case, then auto-deleted a defined period after the case is
marked resolved or closed** - a default of 90 days post-resolution is a
reasonable starting point, giving the patient a window to reference the
outcome (a refund confirmation, a won appeal) before it's purged.

### 3. Identity data (name, DOB, address, insurance member ID - the `user_identity` vault from SECURITY.md)

**Tied to the account, not any single case.** Persists as long as the
account is active, deletable on request at any time via the self-service
deletion already required in SECURITY.md, encrypted at the column level
regardless of how long it's retained.

## The real tension worth naming: caregiver mode wants longer retention

CAREGIVER_MODE.md's whole value proposition for a recurring patient (the
father-with-a-year-of-admissions case) depends on Arik remembering
patterns *across* many cases over time - that's directly in tension with
a short default retention window on case data. Two ways to resolve this,
not mutually exclusive:

- **Default retention stays short**, but the patient/caregiver can
  explicitly opt in to extended retention for a specific ongoing
  situation (a recurring-care flag on `managed_patients`), with that
  choice logged in the same consent ledger already required by
  SECURITY.md
- **The aggregate pattern can outlive the individual case's raw
  detail** - once a case closes, keep a much smaller "here's what
  happened" summary (dates, amounts, resolution) rather than the full
  document/finding detail, similar in spirit to how `case_outcomes`
  already separates the outcome record from the working case data

## What this means for the build

- Add a scheduled deletion job (not just a manual "delete on request"
  path) - this needs to actually run on a schedule, not just exist as a
  capability nobody triggers
- `uploaded_documents.storage_path` needs an actual expiration timestamp
  and a job that enforces it, not just the policy statement already in
  SECURITY.md
- Cases need a `resolved_at` timestamp (does `cases.status` transitioning
  to `resolved_won`/`resolved_lost`/`closed_by_patient` already capture
  this moment cleanly enough to calculate the 90-day clock from - worth
  confirming with Kimi rather than assuming)
- Patient-facing transparency: the deletion countdown already required in
  SECURITY.md's consent ledger should show the patient *when* their data
  disappears, not just that it eventually will
- This retention policy, once finalized, is a real answer to "how long do
  we hold this" that can go directly into a Privacy Policy page - worth
  having Hunter review the specific day counts before they're published
  as a binding commitment, not just an internal default
