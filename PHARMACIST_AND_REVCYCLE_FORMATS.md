# Arik: Pharmacist Card and Revenue Cycle Formats

Two specific audience formats, worth their own spec since they have real
structural requirements beyond "different tone" - these are formats those
professionals already know how to process, which is exactly what makes
them fast to act on instead of one more thing in someone's queue.

## Pharmacist instruction card

A discount card or manufacturer coupon isn't optional-format information -
pharmacists key specific fields into their point-of-sale system, in a
specific order, and if any field is missing or wrong the transaction
fails. This format needs to match that reality exactly:

- **BIN** (Bank Identification Number - routes the claim to the right
  processor)
- **PCN** (Processor Control Number)
- **Group ID**
- **Member/Cardholder ID**
- **Drug name and NDC** (National Drug Code - the specific package/dose
  being dispensed, since the same drug name can have multiple NDCs at
  different doses)
- **Processor/plan name** as it should appear in their system

Format as a literal card, not a paragraph - visually similar to an
insurance card, since that's the object pharmacists are used to processing
at the counter. Printable and save-as-image both matter here specifically,
since the realistic use case is showing it on a phone screen at the
pharmacy counter or having it already printed before the trip.

Pair it with a one-line script for the patient who doesn't want to explain
anything: "Hand them this card and say: 'can you run this discount
instead of my insurance for this fill.'" That sentence is doing the work
of walking a nervous patient through an interaction they've never had to
have before.

## Revenue cycle optimized dispute format

The instinct to make this adversarial toward billing staff would actually
work against the patient - the person processing a dispute at a hospital's
revenue cycle department is not the one who set the price, and a
poorly-formatted complaint just sits in their queue longer. A dispute
that's fast and easy for them to act on gets resolved faster, which is the
actual goal. Structure it the way their own systems expect to intake a
dispute:

- **Patient account number and date of service** up front, not buried
- **Specific claim/line-item reference** (the exact CPT/HCPCS code being
  disputed, not "this charge seems wrong")
- **The specific regulatory or contractual citation** backing the dispute
  (No Surprises Act provision, the specific duplicate line comparison,
  the network status discrepancy) - give them the reason in language
  their own compliance process already recognizes, not a general
  complaint
- **A single, concrete ask** ("please reprocess claim #X removing the
  duplicate charge on line Y") rather than a vague request to "look into
  this"
- **Contact info and preferred resolution channel**

This format is closer to a well-filed support ticket than a complaint
letter - the more it looks like something their system is built to
process quickly, the faster the patient actually gets money back. Aim
here, tone-wise, is "make their job easy so mine gets done fast," not "put
them on the defensive."

## Why this matters for adoption

Both formats share a property: they walk a nervous or unfamiliar patient
through an interaction step by step, removing the part where they have to
figure out what to say or which fields matter. That's the actual adoption
lever - not a slicker UI, but genuinely taking the "I don't know how to
have this conversation" problem off the patient's plate entirely. Worth
building a short first-use walkthrough into the app itself (a one-time
"here's what happens when you hand this to your pharmacist" explainer)
so the first real-world use of a generated card or letter doesn't feel
like an experiment.

## What this means for the build

- `output_documents.audience_format` (from EXPORT_AND_TRANSLATION.md)
  gains two more concrete values: `pharmacist_card` and
  `revcycle_dispute`
- The `exploits` schema for discount-card-network entries needs to
  actually store BIN/PCN/Group ID data, not just "a card exists" -
  this is a real data requirement, not just a rendering choice
- `bill_audit_findings` needs a `cpt_hcpcs_code` field (may already be
  implied by `finding_type` but worth making explicit) since the
  revcycle format depends on citing the exact line item, not a
  description of it
