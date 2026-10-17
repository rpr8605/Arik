# Legal review before launch

Wording and choices the owner approved that counsel must review before real
patients see them (the launch gate, docs/kimi/PRODUCTION_PLAN.md). Code marks
each one so it can be found; nothing here blocks the demo.

| Item | Where in code | Basis | Approved | Status |
|---|---|---|---|---|
| Medicaid line: "At a pharmacy that takes Medicaid, a drug Medicaid covers should cost you only your Medicaid copay (42 CFR 447.15). Ask the pharmacy to bill Medicaid." (and the Spanish) | `LEGAL_REVIEW_REASONS` in lib/rules/cashVsInsurance.ts (`medicaid_bill_medicaid_first`; results carry `legalReview: true`) | 42 CFR 447.15, quoted in docs/research/cash_vs_insurance_verification.md | Owner, 2026-10-16 | Awaiting counsel |
| AMA CPT license for the NCCI pair files and the OPPS/CLFS fee files | Not accepted; the pair check finds nothing on real data (AGENTS.md, real bill path) | cms.gov license page in front of the downloads | Owner declined 2026-10-16, asking counsel | Awaiting counsel |
| Patient authorization for Arik to send letters and receive replies (version `placeholder-2026-10-17`). The text is a placeholder; counsel writes the real form | `AUTHORIZATION_TEXT`, `AUTHORIZATION_NEEDS_COUNSEL` in lib/actions/authorization.ts; every signature stores the version and a hash of the exact words | PRODUCTION_PLAN.md Phase 6 ("Counsel provides the form language") | Owner asked for a placeholder, 2026-10-17 | Awaiting counsel |
| Electronic signature on letters (in-app finger signature, signed copy and hash stored, no IP address kept) | lib/actions/authorization.ts, `letter_signatures` (db/042) | E-SIGN Act and state UETA questions for counsel | Owner, 2026-10-17 | Awaiting counsel |
