# Legal review before launch

Wording and choices the owner approved that counsel must review before real
patients see them (the launch gate, docs/kimi/PRODUCTION_PLAN.md). Code marks
each one so it can be found; nothing here blocks the demo.

| Item | Where in code | Basis | Approved | Status |
|---|---|---|---|---|
| Medicaid line: "At a pharmacy that takes Medicaid, a drug Medicaid covers should cost you only your Medicaid copay (42 CFR 447.15). Ask the pharmacy to bill Medicaid." (and the Spanish) | `LEGAL_REVIEW_REASONS` in lib/rules/cashVsInsurance.ts (`medicaid_bill_medicaid_first`; results carry `legalReview: true`) | 42 CFR 447.15, quoted in docs/research/cash_vs_insurance_verification.md | Owner, 2026-10-16 | Awaiting counsel |
| AMA CPT license for the NCCI pair files and the OPPS/CLFS fee files | Not accepted; the pair check finds nothing on real data (AGENTS.md, real bill path) | cms.gov license page in front of the downloads | Owner declined 2026-10-16, asking counsel | Awaiting counsel |
