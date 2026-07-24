# Arik: Exception Intelligence Engine

## The core idea

Insurance denials aren't random - plans grant exceptions to their own
rules in predictable, documentable patterns. Two U.S. state agencies
already publish thousands of real, anonymized decisions showing exactly
what evidence persuaded a reviewer to overturn a denial. Matching a new
patient's denial against this precedent library and generating a targeted
evidence checklist may be the single most defensible, hardest-to-replicate
feature in the entire build - it requires a real dataset most competitors
never think to structure this way.

## Verified public sources

- **California DMHC Independent Medical Review database** - every IMR
  decision since January 1, 2001, publicly downloadable, covers denials
  based on medical necessity, experimental/investigational status, and
  urgent/non-emergent classification. Free, government-run, no
  restrictions on non-commercial reproduction.
- **New York DFS External Appeals Searchable Database** - searchable by
  diagnosis, treatment, health plan, appeal type, decision year, and
  outcome, with case summaries including the medical literature the
  reviewer relied on. Free, government-run.
- **Missouri specifically does not have a California/New York-style
  searchable case library.** Missouri's Department of Commerce and
  Insurance administers external review, but individual anonymized
  decisions aren't published the same way. Real options for Missouri
  data: published complaint/market-conduct reports, a direct ask to the
  department about anonymized external-review data, or a Missouri
  Sunshine Law request for de-identified aggregate records (insurer,
  year, treatment category, denial reason, internal reversal rate, IRO
  outcome, standard vs. expedited, time to resolution - patient-identifying
  detail would likely be withheld or redacted).
- Other states (Pennsylvania, Texas, Illinois, Massachusetts, Virginia,
  Washington) have external-review systems of varying publication
  quality - worth cataloging per-state as a real sourcing task, not
  assumed uniform.
- **Medicare Advantage**: denials upheld internally get forwarded to an
  independent review entity (CMS transitioned this contractor to C2C
  Innovative Solutions effective May 1, 2026). CMS publishes aggregate
  appeal statistics but not a single friendly searchable database of
  individual clinical decisions - ALJ decisions, Medicare Appeals Council
  decisions, and FOIA requests are the realistic paths here.
- **Court cases and regulatory settlements** - especially valuable for
  self-funded employer plans, since ERISA limits state insurance
  regulators' jurisdiction over those plans, meaning self-funded plan
  denials are often missing from state databases entirely and only
  surface through litigation.

## The critical framing rule

**Arik must never say** "someone else won, so your insurer has to cover
this." Past external-review decisions are not binding precedent for
another patient - a prior win usually means that patient satisfied
criteria that happened to be missing from a new patient's submission, not
that the plan's policy changed. The correct framing:

> "We found 14 similar external-review decisions. Nine were overturned.
> The successful cases most often documented failure of two formulary
> alternatives, a contraindication to the third, and support from this
> clinical guideline. Your current records appear to include the first
> two items but not the contraindication statement."

That's enormously useful without overstating what the law actually
guarantees - it tells the patient exactly what evidence gap to close,
not a false promise of entitlement.

## Exception type taxonomy

Different "exceptions" mean structurally different things, and Arik needs
to distinguish them rather than treating every overturned denial the same:

| Type | What changed |
|---|---|
| Medical-necessity reversal | Reviewer found the patient met existing criteria |
| Experimental-treatment reversal | Evidence supported treatment despite "investigational" label |
| Formulary exception | Non-formulary drug covered after alternatives failed/were unsafe |
| Step-therapy exception | Patient allowed to skip required preferred treatments |
| Quantity-limit exception | Larger dose/supply approved on clinical need |
| Network-gap exception | Out-of-network provider covered, no adequate in-network option |
| Single-case agreement | Plan negotiated a one-patient contract with an outside provider |
| Continuity-of-care exception | Patient kept an existing provider during a transition |
| Site-of-care exception | Different care setting approved because the normal one was unsuitable |
| Administrative reversal | Authorization/coding/documentation error corrected |
| Plan-discretion exception | Plan voluntarily covered something beyond the ordinary rule |
| Legal/regulatory reversal | Denial conflicted with law, parity rules, or the plan contract |

## Why plans actually grant exceptions (the recurring pattern)

Patient tried and failed every covered alternative; alternatives caused
documented adverse effects; a contraindication made the preferred
treatment unsafe; the patient already responded successfully to the
requested treatment; interrupting treatment risked deterioration; no
qualified in-network provider was reasonably available; peer-reviewed
evidence contradicted an outdated medical policy; professional clinical
guidelines supported the treatment; the denial misapplied the plan's own
criteria; required documentation existed but wasn't originally submitted;
the reviewer had the wrong diagnosis/code/history; state or federal law
required coverage; cost of defending the denial exceeded the cost of
approving it; reputational or litigation risk. This list is itself useful
- it's the checklist Arik should be scanning a patient's own denial
against before ever pulling precedent data.

## Schema

```sql
create table exception_precedents (
  id uuid primary key default gen_random_uuid(),
  requested_item text not null,      -- drug, procedure, device, provider
  diagnosis_description text,
  insurer_name text,                 -- when publicly identified
  plan_type text,                    -- 'commercial', 'marketplace', 'medicare_advantage', 'self_funded'
  jurisdiction text,                 -- state or federal
  original_denial_reason text,       -- 'experimental', 'not_necessary', 'out_of_network', etc
  policy_referenced text,
  evidence_submitted text,
  outcome text,                      -- 'upheld', 'overturned', 'plan_reversed'
  decisive_reasoning text,           -- the specific fact/document that changed the result - this is the actually valuable field
  review_level text,                 -- 'internal', 'external', 'alj', 'court'
  decision_date date,
  source_id uuid references sources(id),
  reliability text,                  -- maps to the evidence grade in CASE_MODEL.md/METHODOLOGY.md
  created_at timestamptz default now()
);
```

The valuable dataset isn't "who won" - it's `decisive_reasoning`: the
specific fact, document, or rule that changed the outcome. That field is
what lets Arik generate a targeted evidence checklist for a new patient's
denial instead of a generic "here's how appeals work" explainer.

## How this connects to the rest of the build

- Feeds directly into `denial_appeals` (CASE_MODEL.md) - when a new
  denial comes in, Arik matches it against `exception_precedents` by
  diagnosis/treatment/denial reason, surfaces the pattern, and flags
  which evidence the patient's current documentation is missing
- The trust receipt (CASE_MODEL.md) should show exactly how many
  precedents were matched and what fraction were overturned, with the
  decisive-reasoning pattern spelled out - this is naturally suited to
  the "why Arik believes this" format already required on every answer
- Evidence-freshness tracking (CASE_MODEL.md) applies directly - a 2015
  IMR decision may reflect medical guidelines that have since changed;
  `decision_date` and the evidence-freshness fields on `sources` need to
  work together so stale precedent doesn't get presented with the same
  confidence as recent precedent
- This is a real, ongoing data-sourcing task, not a one-time import - both
  CA and NY databases update continuously, and per METHODOLOGY.md's
  monitor-job logic this should be re-pulled on a regular cadence, not
  scraped once and left static
