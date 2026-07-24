# Arik: Real Claims Data Access and the Discount Network Graph

## Blue Button 2.0 - verified, real, directly relevant to caregiver mode

CMS's Blue Button 2.0 is a production FHIR R4 API, not a proposal or a
maybe-someday integration. Confirmed:

- Delivers Medicare Part A, B, and D claims history for over 60 million
  beneficiaries, four years of history, refreshed weekly
- Patient-authorized via standard OAuth 2.0 - the beneficiary grants a
  registered application access through MyMedicare.gov, the same
  authorization model used everywhere else in this system
- Free developer registration, sandbox available with synthetic data for
  testing before going live
- Over 1,300 fields mapped from the CMS claims warehouse into FHIR
  Patient, Coverage, and ExplanationOfBenefit resources

Source: developer.cms.gov / bluebutton.cms.gov (official CMS
documentation - Grade A).

**Why this matters specifically for caregiver mode:** for Medicare
beneficiaries specifically (like the father scenario in CAREGIVER_MODE.md),
this is a real path to pulling actual adjudicated claims data directly,
rather than relying entirely on manually uploaded EOBs and itemized bills.
Once a Blue Button authorization is granted (same authorized-representative
concept already in the schema, just via CMS's own OAuth flow instead of a
paper form), Arik could audit against the real claims history automatically
rather than waiting for each document to be uploaded one at a time.

This is a later-phase integration, not part of the document-upload MVP -
but worth building the `authorizations_on_file` schema with this in mind
now, since a Blue Button OAuth grant is functionally another row in that
table (`authorization_type: 'blue_button_oauth'`), not a separate concept.

## The clearinghouse layer (TriZetto/Cognizant) - correctly out of reach directly

Direct clearinghouse access requires a provider/payer/trading-partner
relationship, BAAs, EDI credentials, and usually enterprise contracts -
not accessible to a consumer-facing app. The right read: TriZetto's value
is a taxonomy of *what kinds of processing errors exist* (wrong contracted
rate, missing contractual adjustment, COB error, bundling error,
place-of-service error, accumulator error) - useful as a checklist for
what `bill_audit_findings.finding_type` should cover, even without direct
clearinghouse access. The same errors are detectable from patient-supplied
EOBs and bills; the clearinghouse just sees them at higher volume and with
more raw data. Blue Button 2.0 partially closes that gap for Medicare
patients specifically, without needing clearinghouse access at all.

## Discount network graph - consolidating what's actually different

AARP's prescription discount program is run by OptumRx - UnitedHealth owns
OptumRx, AARP supplies the membership brand, the pharmacy processes the
card using OptumRx's BIN/PCN routing. It is not an independent alternative
to the PBM ecosystem, it's another door into the same one. Credit union
and union-branded cards are commonly white-labeled through a small number
of underlying discount-card administrators the same way.

This directly validates the existing `exploits` category #10 (discount
card network arbitrage) and sharpens what the data actually needs to
capture: not just "here are 20 cards," but **which underlying
processor/BIN each one actually routes through**, so the system can
collapse duplicates before presenting options. Showing a patient five
cards that are secretly the same network isn't help, it's noise.

Add to the discount-card exploit schema: an `underlying_processor` field
distinct from the public-facing brand name, so AARP/OptumRx, a
credit-union card, and a raw OptumRx discount card can be recognized as
the same route and only the genuinely distinct networks get compared.

## Pricing data philosophy: independent analysis first, click-out last

No revenue relationship with any discount card network, ever - not a flat
fee, not a referral commission, not preferential API access in exchange
for anything. That would recreate the exact conflict of interest this
whole product exists to avoid, the same reasoning as the no-PBM/no-pharma
rule.

**The actual architecture:** Arik's own analysis runs entirely on public,
free, unencumbered data before a discount network ever enters the
picture:
- NADAC (National Average Drug Acquisition Cost) - free public government
  data, gives an honest reference price with zero contractual strings,
  already the FTC's own benchmark for "what a drug should actually cost"
- CMS negotiated prices (already in the seed data) - free, public,
  authoritative
- Manufacturer copay card and PAP terms - public on manufacturers' own
  sites
- Accumulator/maximizer policy data - sourced independently, not from any
  card network
- Deductible/total-annual-cost math - Arik's own calculation, not
  dependent on any external pricing source

This analysis alone answers almost everything that matters: is cash
better than insurance, is a PAP better than any discount card, does this
particular route hurt the deductible math for the year, which manufacturer
program actually applies here. **A discount card network's live price is
the one number Arik genuinely cannot produce independently** - today's
actual cash price at a specific pharmacy, which only the networks
themselves have in real time.

**So the click-out exists for exactly that one gap, never as the primary
mechanism.** By the time a patient reaches a click-out link, Arik has
already told them which category of savings applies, roughly what to
expect, and why - the network's page is just confirming the live number,
not doing the actual thinking. This keeps the promise from
BLUE_BUTTON_AND_DISCOUNT_GRAPH.md (no financial relationship with any
network) fully intact, since Arik never needs to display a network's
proprietary price data inline or depend on their API terms at all - it
only ever links out, generically, to whichever network's own page the
patient would need to visit to confirm the number Arik already computed
independently.

This also means the "discount identity graph" work (collapsing duplicate
cards down to their real underlying processor) still matters even without
API access - it's still worth knowing that AARP/OptumRx/a given
credit-union card are the same network, so Arik can tell a patient which
*one* link is worth clicking instead of sending them to check five
redundant options.



From most to least buildable given current access constraints:
1. Compare insurance against every cash route (already core to Phase 1)
2. Manufacturer/foundation assistance matching (already core to Phase 1)
3. Audit claims for incorrect patient responsibility (Phase 1.5, bill
   auditor)
4. FQHC/340B/sliding-fee matching (already speced, uninsured access)
5. Blue Button 2.0 integration for Medicare beneficiaries (new, this doc)
6. Deductible/accumulator error detection (harder - needs plan document
   parsing, already flagged as hard in accumulator_policies)
7. Direct clearinghouse integration (very hard, likely never - not
   necessary given Blue Button 2.0 covers the Medicare population where
   this matters most)
