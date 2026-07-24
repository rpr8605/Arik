# Arik: Attorney Referral - Why Paid Placement Is Off the Table

## The conflict, stated plainly

Every other part of this build refuses money that would compromise a
recommendation - no PBM fees, no pharma placement fees, no discount
network referral commissions (BLUE_BUTTON_AND_DISCOUNT_GRAPH.md). An
attorney paying for advertising or placement is the same conflict wearing
a different outfit: whoever pays gets recommended, not whoever's actually
the best fit for that patient's specific case. This would directly
contradict the core premise this entire product is built on. Do not build
a pay-to-advertise or pay-per-referral attorney marketplace.

## The real legal constraint on top of the ethical one

Attorney referral arrangements are regulated by state bar ethics rules,
not just ordinary business law:
- Many states prohibit fee-splitting between lawyers and non-lawyer
  entities outright
- Lawyer referral services often require specific state certification to
  operate legally at all
- Rules vary meaningfully by state, meaning a single national referral
  model could be legal in one state and prohibited in another

This needs real legal review (Hunter) before any attorney-referral
feature is built - not a line item in a general review, its own
conversation, similar in kind to how IMMIGRATION_STATUS_HANDLING.md
needed dedicated attention rather than folding into the general
demographic-eligibility framework.

## How rare this should actually be

Most of what Arik handles - price mismatches, first-level denial appeals,
PAP applications, charity care - resolves through administrative
processes specifically designed to be navigable without a lawyer. That's
the entire point of internal appeals, external review, and IMR/DFS-style
independent review. Suggesting an attorney for the ordinary case would
overstate the stakes and could make a patient feel like routine billing
problems require hiring counsel, which isn't true and isn't helpful.

Attorney escalation belongs only to a narrow, factually-triggered set of
situations, not a general "this seems hard" judgment call:
- The patient is being actively sued, threatened with legal action, or
  facing collections/garnishment/a lien over medical debt - a
  categorically different situation from a dispute, and not one Arik's
  administrative tools are built to handle
- Every administrative and external-review avenue is genuinely exhausted
  and the denial still stands - the point where ERISA litigation becomes
  the only remaining path
- A pattern matching bad-faith denial or discrimination (ADA, mental
  health parity) - these are legal claims, not billing disputes
- Bankruptcy considerations arising from medical debt

Arik should never render legal advice or assess the merits of a legal
claim - its role is to recognize these specific, factual trigger
conditions (a deadline exhausted, an active collections threat, a
documented pattern) and hand off at that boundary, not to judge whether a
case is legally strong. That distinction also keeps Arik clearly on the
right side of the line between recognizing when a case needs a lawyer and
practicing law itself.



CASE_MODEL.md's controlled human escalation already scopes this
correctly - attorneys as one category in a small, manually managed review
panel (alongside billing advocates, revenue-cycle specialists,
pharmacists, Medicare specialists), triggered by an escalation score
(dollar amount, evidence confidence, deadline proximity, legal ambiguity).
This is fundamentally different from an advertising marketplace:
- Attorneys are selected for the panel based on specialty fit and track
  record, not payment
- The trust receipt (CASE_MODEL.md) should show the patient *why* an
  attorney is being suggested - which precedent pattern from
  EXCEPTION_INTELLIGENCE_ENGINE.md suggests legal escalation is
  warranted, same evidence-based framing used everywhere else in this
  system
- If a referral fee arrangement exists at all, it needs to be structured
  so it never affects which attorney gets suggested for which case -
  ranking by fit and outcomes, fee arrangement (if any) disclosed
  transparently and legally reviewed, never a ranking input

## If monetized at all - the only models worth considering

- **Not monetized on the attorney side at all** - treat legal escalation
  purely as a value-add that strengthens patient retention/trust, with
  revenue continuing to come from the existing employer/union and
  consumer success-fee tracks. This is the simplest way to avoid the
  conflict entirely and may be the right answer, at least until real
  usage shows whether this matters enough to revisit.
- **A flat, non-contingent listing fee**, if any - not tied to referrals
  or outcomes, disclosed transparently, and still subject to the same bar
  ethics review, since even flat-fee lawyer referral services are
  regulated in most states.
- **Never**: pay-per-referral, pay-per-click placement, or anything where
  the fee scales with how much business Arik sends a specific attorney -
  this is the version most likely to both violate bar ethics rules and
  compromise the actual recommendation.

## What this means for the build

- Attorney referral stays inside the existing escalation-panel structure
  from CASE_MODEL.md, not a new marketplace feature
- Do not build any attorney-facing "advertise with us" flow until Hunter
  has reviewed fee-splitting and referral-service certification rules for
  every state Arik operates in
- The escalation panel itself can start small and manual (a handful of
  known, trusted attorneys per specialty area) rather than needing a
  scaled marketplace from day one - consistent with CASE_MODEL.md's own
  guidance not to build a giant marketplace before learning what
  expertise patients actually need
