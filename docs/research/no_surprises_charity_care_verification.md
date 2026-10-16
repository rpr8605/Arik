# No Surprises and charity care: rule check (2026-10-16)

Source: eCFR versioner API, up to date as of 2026-10-15:
- https://www.ecfr.gov/api/versioner/v1/full/2026-10-15/title-45.xml?part=149&section=149.410 (and 149.420, 149.610, 149.620)
- https://www.ecfr.gov/api/versioner/v1/full/2026-10-15/title-26.xml?part=1&section=1.501(r)-1 (and 1.501(r)-4, -5, -6)

Owner go-ahead 2026-10-16: verify and quote first, then build. Code:
`lib/rules/bills/rights.ts` (`RIGHTS_VERSION = 'ecfr-2026-10-15'`), tests in
`scripts/test_bill_rights.ts`. What a bill cannot show (network status,
nonprofit status, whether an estimate was given) is never assumed: every
finding is an "ask" and its words say "if".

## Emergency care out of network: 45 CFR 149.410

- **(a):** "In the case of a participant, beneficiary, or enrollee with benefits under a group health plan or group or individual health insurance coverage offered by a health insurance issuer and who is furnished emergency services ... (1) A nonparticipating emergency facility must not bill, and must not hold liable, the participant, beneficiary, or enrollee for a payment amount for such emergency services ... that exceeds the cost-sharing requirement for such services". (a)(2) says the same for a nonparticipating provider.
- **(c):** the notice-and-consent exception never applies to "items or services furnished as a result of unforeseen, urgent medical needs that arise at the time an item or service is furnished".
- **(f):** applies to plan years beginning on or after January 1, 2022.

Built: `nsa_emergency`, on emergency department lines (revenue codes 0450-0459, CPT 99281-99285, HCPCS G0380-G0384), for a plan through work or the marketplace, worded "if" when coverage is unknown. Not for uninsured, Medicare or Medicaid: the section covers group health plans and group or individual coverage only.

## Out-of-network doctor at an in-network facility: 45 CFR 149.420

- **(a):** "A nonparticipating provider ... who provides items or services (other than emergency services) ... at a participating health care facility must not bill, and must not hold liable, a participant, beneficiary, or enrollee ... for a payment amount ... that exceeds the cost-sharing requirement for such item or service ... unless the provider ... satisfies the notice and consent criteria of paragraph (c)".
- **(b):** the notice and consent criteria "do not apply, and a nonparticipating provider ... will always be subject to the prohibitions in paragraph (a) ... with respect to the following services: (1) Ancillary services, meaning (i) Items and services related to emergency medicine, anesthesiology, pathology, radiology, and neonatology, whether provided by a physician or non-physician practitioner; (ii) Items and services provided by assistant surgeons, hospitalists, and intensivists; (iii) Diagnostic services, including radiology and laboratory services; and (iv) Items and services provided by a nonparticipating provider if there is no participating provider who can furnish such item or service at such facility."

Built: `nsa_ancillary`, on a doctor's own bill (not the facility's) with anesthesia (00100-01999), imaging (70010-79999), lab and pathology (80047-89398) or newborn critical care (99468-99480) lines. Assistant surgeons, hospitalists and intensivists can't be told from a code, so they are not flagged.

## Good faith estimate (uninsured or self-pay): 45 CFR 149.610, 149.620

- **149.610(a)(1):** requirements "related to the issuance of good faith estimates of expected charges for uninsured (or self-pay) individuals ... upon request or upon scheduling an item or service."
- **149.620(a)(2)(ii):** "Substantially in excess means, with respect to the total billed charges by a provider or facility, an amount that is at least $400 more than the total amount of expected charges listed on the good faith estimate for the provider or facility."
- **149.620(b)(1):** an item or service "is eligible for the patient-provider dispute resolution process if the total billed charges ... are substantially in excess of the total expected charges for that specific provider or facility listed on the good faith estimate".
- **149.620(c)(1):** the individual "may initiate the patient-provider dispute resolution process by submitting a notification ... postmarked within 120 calendar days of receiving the initial bill containing charges for the item or service that is substantially in excess of the expected charges in the good faith estimate." An administrative fee applies (149.620(g)); its amount is set in HHS guidance and is NOT shown by Arik.

Built: `gfe_over` when the patient enters the estimate and the bill's total charges are at least $400 over it (the estimate, the total and the difference are named in the text and carried as `refsUsd` so the letter may cite them; no `amountUsd`, so nothing is double counted). `gfe_ask` for an uninsured patient with no estimate entered, except on emergency bills (emergency care is not scheduled).

## Hospital financial assistance: 26 CFR 1.501(r)

- **1.501(r)-1(b)(18):** "Hospital organization means an organization recognized (or seeking to be recognized) as described in section 501(c)(3) that operates one or more hospital facilities." So these rules bind nonprofit hospitals only, which a bill doesn't show.
- **1.501(r)-5(a):** the hospital facility "limits the amount charged for care it provides to any individual who is eligible for assistance under its financial assistance policy (FAP) to (1) In the case of emergency or other medically necessary care, not more than the amounts generally billed to individuals who have insurance covering such care (AGB)".
- **1.501(r)-1(b)(3):** the application period "begins on the date the care is provided and ends on the later of the 240th day after the date that the first post-discharge billing statement for the care is provided or" the deadlines in the notices.
- **1.501(r)-6(c)(3)(i):** the facility "refrains from initiating such ECAs ... for at least 120 days from the date the hospital facility provides the first post-discharge billing statement for the care".
- **1.501(r)-6(b)(1):** ECAs include "(i) Selling an individual's debt to another party", "(ii) Reporting adverse information about the individual to consumer credit reporting agencies or credit bureaus", deferring care for nonpayment, and actions that require a legal or judicial process.
- **1.501(r)-6(c)(8):** if "an individual submits a FAP application during the application period, the hospital facility ... does not initiate, or take further action on any previously-initiated, ECAs".

Built: `financial_assistance`, on hospital bills (inpatient or hospital outpatient), worded "If this hospital is a nonprofit". When the statement date is known, it adds the date 240 days later, said as "If this is the first bill since your care". The letter item asks for the policy, the plain language summary and an application, and a hold on collections. Not built: a check that collections started too early (needs the date of the first bill and of the collection action, which a bill doesn't carry).
