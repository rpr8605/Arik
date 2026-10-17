# Denial engine: rule check (2026-10-17)

Source: eCFR versioner API, Titles 29, 42 and 45 up to date as of 2026-10-15:
`https://www.ecfr.gov/api/versioner/v1/full/2026-10-15/title-<N>.xml?part=<P>&section=<S>`
for 29 CFR 2560.503-1; 45 CFR 147.136; 42 CFR 423.568, 423.572, 423.578,
423.582, 423.590, 423.600; 42 CFR 422.101, 422.568, 422.572, 422.582,
422.590; 42 CFR 438.210, 438.402, 438.404, 438.408; 42 CFR 431.221.

Owner go-ahead 2026-10-17 (Phase 5): verified deadlines per plan type. Code:
`lib/rules/denials/rules.ts` (`DENIAL_RULES_VERSION = 'ecfr-2026-10-15'`),
tests in `scripts/test_denial_rules.ts`. The spec (Appendix B4) values
match the regulation text below. The spec listed Medicare Advantage and
Medicaid as "not implemented"; the regulation text for both is quoted here,
so they are built from it.

**Two safety rules in the code.** (1) Where a window runs from the day the
patient *received* the notice, Arik counts from the date *on* the notice
(the earliest the window can start), so the date shown is never later than
the real one, unless the rule itself sets a presumed receipt date (Medicare:
5 days). (2) If the letter states a shorter deadline than the rule, the
earlier date is the one shown.

## Employer, marketplace and individual plans

### Internal appeal: 29 CFR 2560.503-1(h)(4)(i), via 45 CFR 147.136(b)

- 2560.503-1(h)(4)(i): a group health plan must "Provide claimants at least 180 days following receipt of a notification of an adverse benefit determination within which to appeal the determination".
- 147.136(b)(2)(i): "A group health plan and a health insurance issuer offering group health insurance coverage must comply with all the requirements applicable to group health plans under 29 CFR 2560.503-1".
- 147.136(b)(3)(i): "A health insurance issuer offering individual health insurance coverage must comply with all the requirements of the ERISA internal claims and appeals procedures applicable to group health plans under 29 CFR 2560.503-1".
- 147.136(b)(3)(ii)(G): an individual-market issuer "must provide for only one level of internal appeal before issuing a final determination."

Built: 180 days from the date on the notice, for `fully_insured`,
`self_funded` and `marketplace`.

### First decisions: 29 CFR 2560.503-1(f)(2)

- (f)(2)(i) urgent care: "not later than 72 hours after receipt of the claim by the plan".
- (f)(2)(iii)(A) pre-service: "not later than 15 days after receipt of the claim by the plan. This period may be extended one time by the plan for up to 15 days".
- (f)(2)(iii)(B) post-service: "not later than 30 days after receipt of the claim. This period may be extended one time by the plan for up to 15 days".

### Decisions on appeal: 29 CFR 2560.503-1(i)(2)

- (i)(2)(i) urgent: "not later than 72 hours after receipt of the claimant's request for review".
- (i)(2)(ii) pre-service, one appeal level: "not later than 30 days after receipt by the plan of the claimant's request for review".
- (i)(2)(iii)(A) post-service, one appeal level: "not later than 60 days after receipt by the plan of the claimant's request for review".

Built: `insurer_late` compares the date on the notice with the date the
patient says the claim or appeal was sent. Receipt by the plan is unknown
and extensions exist, so it is always an "ask" worded "if".

### Notice content: 29 CFR 2560.503-1(g), 45 CFR 147.136(b)(2)(ii)(E)

- 2560.503-1(g)(1)(i): the notice must set forth "The specific reason or reasons for the adverse determination".
- (g)(1)(v)(B): for a medical necessity denial, "either an explanation of the scientific or clinical judgment for the determination ... or a statement that such explanation will be provided free of charge upon request."
- (h)(2)(iii): a claimant "shall be provided, upon request and free of charge, reasonable access to, and copies of, all documents, records, and other information relevant to the claimant's claim for benefits".
- 147.136(b)(2)(ii)(E)(3): the reason "includes the denial code and its corresponding meaning, as well as a description of the plan's or issuer's standard, if any, that was used in denying the claim."
- 147.136(b)(2)(ii)(E)(2): the diagnosis and treatment codes and their meanings on request, and such a request is not "in itself, to be a request for an internal appeal".

Built: `missing_specific_reason`, the claim file request letter
(`claim_file_request`, recommended first for self-funded plans) and the
specific reason request letter.

### External review: 45 CFR 147.136(c) and (d)

- (d)(2)(i) federal process: "a request for an external review ... filed within four months after the date of receipt of a notice of an adverse benefit determination or final internal adverse benefit determination. If there is no corresponding date four months after the date of receipt of such a notice, then the request must be filed by the first day of the fifth month following the receipt of the notice. For example, if the date of receipt of the notice is October 30, because there is no February 30, the request must be filed by March 1. If the last filing date would fall on a Saturday, Sunday, or Federal holiday, the last filing date is extended to the next day that is not a Saturday, Sunday, or Federal holiday."
- (c)(2)(vi) state process: "must allow at least four months after the receipt of a notice".
- (d)(2) decision: "within 45 days after the IRO receives the request"; expedited: "in no event more than 72 hours after the IRO receives the request for an expedited external review."

Built: four calendar months by the rule above (October 30 to March 1).
The weekend and holiday extension is NOT applied: the date shown can only
be earlier than the real one, never later.

## Medicare Part D

- 423.582(b) redetermination: "within 60 calendar days after receipt of the written coverage determination notice"; (b)(1): receipt "is presumed to be 5 calendar days after the date of the written coverage determination".
- 423.600(a) IRE: "within 60 calendar days after receipt of the written redetermination"; (a)(1) the same 5-day presumption.
- 423.590(a) standard redetermination, drug benefit: "no later than 7 calendar days from the date it receives the request"; (b) payment: "no later than 14 calendar days"; (d)(1) expedited: "no later than 72 hours after receiving the request."
- 423.568(b) coverage determination, drug benefit: "no later than 72 hours after receipt of the request"; (c) payment: "no later than 14 calendar days after receipt of the request." 423.572(a) expedited: "no later than 24 hours after receiving the request."
- 423.568(g)(2) and 423.590(g)(2): the notice must "State the specific reasons for the denial".
- 423.568(h) late coverage decision: "the failure constitutes an adverse coverage determination, and the plan sponsor must forward the enrollee's request to the IRE within 24 hours of the expiration of the adjudication timeframe." 423.590(c) says the same for a late redetermination.
- 423.578(a)(4) exceptions: "A prescribing physician or other prescriber must provide an oral or written supporting statement".
- Levels 3 to 5 (ALJ, Council, court): not built. Their dollar thresholds change every year and are UNVERIFIED here.

Built: 5 days + 60 days = 65 days from the date on the notice, for both
levels (this matches the spec's "65 days from the denial notice").

## Medicare Advantage

- 422.582(b) reconsideration: "within 60 calendar days after receipt of the written organization determination notice"; (b)(1) receipt "is presumed to be 5 calendar days after the date of the written organization determination".
- 422.590(a) service: "no later than 30 calendar days"; (b) payment: "no later than 60 calendar days"; (c) Part B drug: "no later than 7 calendar days"; (e)(1) expedited: "no later than 72 hours". (f): the plan "may extend the standard or expedited reconsideration deadline for services by up to 14 calendar days".
- 422.590(a)(2): if the plan upholds its denial it "must ... send the case file to the independent entity". The patient files nothing for level 2.
- 422.568(b)(1)(ii) prior authorization: "Beginning on or after January 1, 2026, for a service or item subject to the prior authorization rules in § 422.122, 7 calendar days after receiving the request". 422.572(a)(1) expedited: "no later than 72 hours".
- 422.568(e)(2): the notice must "State the specific reasons for the denial".
- 422.101(b): an MA organization must comply with "(1) CMS's national coverage determinations" and "(3) Written coverage decisions of local Medicare contractors". This is why the argument builder cites Medicare coverage rules (db/036) for Medicare Advantage.

## Medicaid

- 438.402(c)(2)(ii) managed care plan appeal: "an enrollee has 60 calendar days from the date on the adverse benefit determination notice in which to file a request for an appeal to the managed care plan."
- 438.408(b)(2) decision: "no longer than 30 calendar days from the day the MCO, PIHP, or PAHP receives the appeal"; (b)(3) expedited: "no longer than 72 hours"; (c) "may extend the timeframes ... by up to 14 calendar days".
- 438.408(f)(2) fair hearing after the plan upholds: "no less than 90 calendar days and no more than 120 calendar days from the date of the MCO's, PIHP's, or PAHP's notice of resolution".
- 438.402(c)(1)(i)(A): a plan that misses the notice and timing rules: "the enrollee is deemed to have exhausted" the plan's appeals and "may initiate a State fair hearing."
- 431.221(d) state Medicaid (no managed care plan): "a reasonable time, not to exceed 90 days from the date that notice of action is mailed". The state sets it, so Arik shows no date and tells the patient to use the date on the notice.
- 438.210(d)(1)(i)(B) prior authorization: "For rating periods that start on or after January 1, 2026, within state established time frames that may not exceed 7 calendar days"; (d)(2) expedited "no later than 72 hours".
- 438.404(b)(2): the notice must explain "The reasons for the adverse benefit determination".

Built: plan appeal 60 days from the date on the notice; fair hearing the
earliest the rule allows (90 days), with "your state may allow up to 120";
state Medicaid with no plan: no date.

## Not built (listed, not invented)

- State insurance rules (state external review details, state timelines).
- Part D and Medicare levels 3 to 5.
- The prior authorization rule for federal marketplace plans (45 CFR 156.223 was not checked).
- Federal holidays.
- Grandfathered plans: 147.136(a)(2)(ii) says most of the section does not apply to them; Arik cannot tell a grandfathered plan from the notice, so the patient is told to check the plan's appeal rules when the letter says the plan is grandfathered.

## Denial codes (CARC and RARC)

Numbers only. No X12 descriptions are copied anywhere. Arik's own short
explanations for common codes are in db/041 with `explanation_status =
'needs_review'` and are shown to patients only after the owner approves them
(`update denial_codes set explanation_status = 'approved' ...`). Until then
the screen shows the code number, a link to https://x12.org/codes, and
the plain explanation of the denial category, which the patient confirms.
