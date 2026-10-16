# Cash vs insurance: regulation check (2026-10-16)

Source: eCFR versioner API, Title 42 up to date as of 2026-10-14 (https://www.ecfr.gov/api/versioner/v1/full/2026-10-14/title-42.xml?part=447&section=447.15 and the same for 447.52, 447.53, 447.56, 423.100).

## Medicaid

- **42 CFR 447.15:** "A State plan must provide that the Medicaid agency must limit participation in the Medicaid program to providers who accept, as payment in full, the amounts paid by the agency plus any deductible, coinsurance or copayment required by the plan to be paid by the individual."
- **42 CFR 447.53(b):** drug cost sharing maximums: preferred drugs $4 (any income); non-preferred drugs $8 at or below 150% FPL, "20% of the cost the agency pays" above 150% FPL (amounts indexed yearly from October 1, 2015).
- **42 CFR 447.52(e)(1):** a pharmacy may require the cost sharing as a condition of service only if income is above 100% FPL and the person is not exempt.

**Decision (owner rule: strong line only if the text clearly supports it):** the text supports "at a pharmacy that takes Medicaid, a covered drug costs only your Medicaid copay". It does not support "small" in every case (up to 20% for non-preferred drugs above 150% FPL), and it never tells a patient not to pay cash. So the rule ships the softer line, **marked pending**: "With Medicaid, ask the pharmacy to bill Medicaid first." Proposed accurate stronger line for the owner to approve: "At a pharmacy that takes Medicaid, a drug Medicaid covers should cost you only your Medicaid copay (42 CFR 447.15)."

**Owner decision 2026-10-16:** approved the stronger line, citing 42 CFR 447.15, for a drug Medicaid covers: "At a pharmacy that takes Medicaid, a drug Medicaid covers should cost you only your Medicaid copay (42 CFR 447.15). Ask the pharmacy to bill Medicaid." It is marked for **legal review before launch** (`LEGAL_REVIEW_REASONS` in lib/rules/cashVsInsurance.ts; docs/legal_review_before_launch.md). When coverage of the drug is unknown or denied, the softer lines stay.

## Medicare Part D

- **42 CFR 423.100, "Incurred costs":** costs for covered Part D drugs "not paid for under the Part D plan as a result of application of any annual deductible or other cost-sharing rules ... prior to the Part D enrollee satisfying the out-of-pocket threshold", paid by the enrollee (or certain others) and not reimbursed.
- Reading: a cash purchase outside the plan is not cost sharing under the Part D plan, so it is not an incurred cost toward the out-of-pocket threshold. The caveat "Paying cash outside your plan won't count toward your Part D out-of-pocket limit for the year" is supported. The 2026 cap amount ($2,100) still needs its CMS source before it is shown as a number.
