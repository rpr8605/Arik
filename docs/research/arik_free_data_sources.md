# Arik free data source registry

**Owner:** Ryan Russell
**Researched:** 2026-10-12
**Put this file at:** `docs/research/arik_free_data_sources.md`
**Used by:** Arik's AI (where to look and what it may say), Kimi (which loaders to build), and the `sources` / `price_sources` tables (one row per source here).

Each entry says what the source has, how Arik captures it, how often it changes, what Arik may use it for, and any license limits. **Status** tells you how well it was checked on 2026-10-12:

- **Verified:** the source page itself was opened and read.
- **Search-confirmed:** the source showed up in search results from its official publisher, but the page wasn't opened. Kimi checks the URL before building a loader.

---

## 1. Rules for the AI (read first)

1. **Use only sources listed here, or rows in the database that came from them.** If a source isn't here, Arik doesn't cite it. To add one, add an entry to this file first.
2. **Label every number with its source and date.** Use the source's display label (column "Arik label") word for word.
3. **Benchmarks are not patient prices.** NADAC, ASP, the fee schedules and Part D spending figures show what the system pays. Arik never presents them as what the patient will pay.
4. **Aggregate denial data is context, not a prediction.** "This insurer denied 19% of in-network claims in 2024" is fine. "Your claim has a 19% chance of denial" is never fine.
5. **Respect the capture mode.**
   - **Bulk:** Arik downloads the source on a schedule and stores the rows.
   - **On demand:** Arik queries the source live, or caches results briefly.
   - **Link-out only:** Arik shows the link and never copies or scrapes the content.
   - **Research only:** Ryan or the team uses it, and it never reaches patients.
6. **Licensing flags win.** If an entry says "commercial use needs approval," Arik doesn't ingest it until that approval is on file.
7. **No source here contains patient data.** Patient-specific records come only through the record-connection module (M15) with consent.

---

## 2. Capture schedule (what runs automatically)

| Cadence | Sources |
| --- | --- |
| Weekly | NADAC (C1); Medicare Coverage Database (V1, published Thursdays) |
| Quarterly | Part D formulary and pricing files (V2); ASP Part B drug pricing (C3); NCCI edits (C6); payer in-network rate files (C9, quarterly under the new rule) |
| Annually | Exchange PUFs incl. plan benefits and Transparency in Coverage denials (V3, D1; new plan year each fall); prior authorization metrics on payer websites (D2, due March 31); Physician Fee Schedule (C5; plus mid-year revisions); Part D spending by drug (C2) |
| As published | California IMR decisions (D3); Medicare Part C/D appeals decision search (D5); CMS fact sheets on appeals (D6) |
| On demand | NPPES NPI registry (R3); RxNorm (R1); openFDA (R2); NY DFS external appeal search (D4); CourtListener (L1); ProPublica Nonprofit Explorer (A3) |

Every scheduled load writes one `ingest_runs` row and respects `price_sources.enabled`, `max_staleness_hours` and `retention_days`.

---

## 3. Costs: drugs

| ID | Source | Publisher | URL | What it has | Capture | Cadence | Arik use | Arik label | License / limits | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | NADAC (National Average Drug Acquisition Cost) | CMS / Medicaid | https://data.medicaid.gov (dataset "NADAC (National Average Drug Acquisition Cost) 2026"); overview https://www.medicaid.gov/medicaid/nadac | Average pharmacy acquisition cost per NDC unit | Bulk (adapter already built) | Weekly | Benchmark under every drug result; spot inflated cash prices | "What pharmacies pay on average (NADAC, CMS, week of …)" | US government data | Search-confirmed |
| C2 | Medicare Part D Spending by Drug (annual and quarterly) | CMS | https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug | Total and per-unit Medicare spending by drug, manufacturer | Bulk | Annual / quarterly | Context: how expensive a drug is to Medicare; which drugs to add next | "Medicare Part D spending (CMS, year …)" | US government data | Search-confirmed |
| C3 | Medicare Part B Average Sales Price (ASP) files | CMS | https://www.cms.gov/medicare/payment/part-b-drugs/asp-reporting | Payment limits for drugs given in a clinic (infusions, injections) by HCPCS | Bulk | Quarterly | Bill review: check drug charges on hospital and clinic bills | "Medicare payment limit for this drug (ASP, quarter …)" | US government data | Search-confirmed |
| C4 | Medicaid Spending by Drug; State Drug Utilization Data | CMS | https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicaid-spending-by-drug ; data.medicaid.gov (theme "State Drug Utilization") | Medicaid units and spending by drug and state | Bulk (later) | Annual / quarterly | Research and prioritizing drugs; not shown to patients | n/a | US government data | Search-confirmed |

**Not free, or not allowed to capture:**
- **Cost Plus Drugs:** no public API found; only third-party scrapers exist. Link out only, unless they agree to share data.
- **GoodRx, SingleCare and other discount cards:** link out only, per BLUE_BUTTON_AND_DISCOUNT_GRAPH.md. A partner feed is the separate partner adapter (M07), not this registry.
- **AWP and WAC list prices:** proprietary compendia (paid).

---

## 4. Costs: medical services (bills)

| ID | Source | Publisher | URL | What it has | Capture | Cadence | Arik use | Arik label | License / limits | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C5 | Medicare Physician Fee Schedule (PFS) | CMS | https://pfs.data.cms.gov/ ; relative value files https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files | Medicare allowed amounts by code and locality | Bulk | Annual + revisions (e.g., RVU26A, RVU26B) | Bill review context: "what Medicare would pay" | "What Medicare pays for this service in your area (PFS, year …)" | Contains CPT codes: show code numbers only; descriptions need an AMA license (`CPT_DISPLAY_ENABLED=false`) | Search-confirmed |
| C6 | NCCI procedure-to-procedure edits and Medically Unlikely Edits (MUEs) | CMS | https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits | Code pairs that shouldn't be billed together; max units per code per day | Bulk | Quarterly | Bill review error checks (M10-AC2); record edit version on every flag | "Medicare coding rule (NCCI, quarter …)" | Code numbers only (CPT license as above) | Search-confirmed |
| C7 | Hospital price transparency files (each hospital's machine-readable file, MRF) | Each hospital, under CMS rules | Find each file through the hospital's `https://<hospital-domain>/cms-hpt.txt` (required since 2024-01-01; lists `mrf-url`, `source-page-url` and a contact). CMS resources: https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency/resources ; CMS GitHub templates https://github.com/CMSgov/hospital-price-transparency | Gross charges, cash prices, payer-negotiated rates per hospital | Bulk, per hospital (start with Kansas City) | Hospitals must keep current; re-pull quarterly | Bill review: compare the bill to the hospital's own posted prices (M10-AC5) | "This hospital's posted price (its price file, dated …)" | Public by law. Files are huge and inconsistent; store only the codes Arik needs | Verified (cms-hpt.txt FAQ) |
| C8 | DoltHub hospital price databases | DoltHub (open data) | https://www.dolthub.com/blog/2025-01-28-state-of-hospital-price-transparency-data/ | Past collection of 1,000+ hospital files (V4 = Q3 2023), plus a list of hospital price file URLs | Research only | Not updated (no new collection for over a year as of Jan 2025) | Find hospital file URLs; historical comparison only | n/a | Free | Verified |
| C9 | Payer in-network rate files (Transparency in Coverage MRFs) | Each health plan/insurer | Each payer's posted files. Rule: https://www.federalregister.gov/documents/2025/12/23/2025-23693/transparency-in-coverage | Negotiated rates by network, provider and code; allowed amounts | Research first; targeted pulls later | Quarterly under the 2025 final rule; prescription drug file enforced December 2027 | Later: show what a patient's own plan negotiated with a hospital | "Your plan's negotiated rate (plan's price file, quarter …)" | Public by law. Files can be extremely large; pull only targeted networks | Verified (rule summary via Turquoise Health) |

**Not free, or not allowed to capture:**
- **FAIR Health consumer cost estimates, Healthcare Bluebook, Turquoise Health:** link out only, or license their data.
- **CPT descriptions:** AMA license.

---

## 5. Denials and appeals

| ID | Source | Publisher | URL | What it has | Capture | Cadence | Arik use | Arik label | License / limits | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Transparency in Coverage PUF (Marketplace claims and denials) | CMS (Exchange PUFs) | https://www.cms.gov/marketplace/resources/data/public-use-files (PY2026 file holds plan-year 2024 data) | Per issuer and plan: claims received and denied (in and out of network), denial reasons (prior authorization, medical necessity, excluded service, administrative, other), internal and external appeal counts (under-10 values suppressed) | Bulk | Annual (PY2026 file published 2025-09-26) | Denial engine context: an insurer's denial rate and its most common denial reasons | "This insurer's denial rate for HealthCare.gov plans (CMS, plan year …)" | US government data. Only HealthCare.gov individual plans; no state-exchange, employer or prior-auth data | Verified (via KFF analysis of the file) |
| D2 | Prior authorization metrics (CMS-0057-F) | Each payer, on its own public website | Rule: https://www.cms.gov/initiatives/burden-reduction/overview/interoperability/frequently-asked-questions/prior-authorization-api/improving-prior-authorization-processes | Per payer: % approved, denied, approved after appeal; decision times; list of services needing prior auth. Medical items and services only, **not drugs** | Bulk (per-payer collector, since formats vary) | Annually by March 31 (first: 2026, covering 2025) | Denial engine: plan-specific prior-auth denial and overturn rates; tells patients appeals often win | "This plan's prior authorization report (posted by the plan, year …)" | Public by rule. Applies to Medicare Advantage, Medicaid and CHIP (FFS and managed care), and FFE QHP issuers. Not self-funded employer plans | Verified |
| D3 | California Independent Medical Review (IMR) determinations | CA Department of Managed Health Care, on CHHS Open Data | https://data.chhs.ca.gov/dataset/independent-medical-review-imr-determinations-trend | Every DMHC IMR decision since 2001: condition, treatment type, determination (overturned or upheld) | Bulk (once approved) | Irregular (last updated 2026-06-01) | Denial engine: how often external review overturns denials for a given treatment and condition | "California independent review outcomes (DMHC, through …)" | **Commercial use needs approval** under the CHHS Terms of Use. Noncommercial use is OK without changes. Get approval before ingesting | Verified |
| D4 | New York DFS external appeal decisions | NY Department of Financial Services | https://www.dfs.ny.gov/public-appeal/search | Searchable past external appeal decisions by year, diagnosis, treatment, keyword; case pages include health plan | On demand (research-assist) | Ongoing | Find similar past appeals to strengthen arguments (precedent library M11) | "Similar New York external appeal (NY DFS case …)" | Check site terms before any automated collection; start with manual lookups | Verified |
| D5 | Medicare Part C and D appeals decision search | CMS | https://www.cms.gov/medicare/appeals-grievances/appeals-decision-search-part-c-d (also https://www.cms.gov/qic-decision-search) | Independent review entity (IRE) decisions for Medicare Advantage and Part D | On demand | Ongoing | Medicare appeals precedent | "Medicare independent review decision (CMS …)" | Fields and export not confirmed; Kimi opens and documents it before building | Search-confirmed (page contents not readable) |
| D6 | Part C reconsideration and Part D appeals fact sheets | CMS / IRE contractor | https://www.cms.gov/medicare/appeals-grievances/managed-care/review-part-c-independent-entitiy ; https://www.cms.gov/medicare/appeals-grievances/prescription-drug/reconsiderations | Summary statistics on IRE reconsiderations | Research only | Irregular, often years behind | Background for investor and patient education | n/a | US government data. Part C IRE is C2C Innovative Solutions from 2026-05-01 (Maximus before) | Verified |

**What isn't available for free:**
- **Commercial and employer (self-funded) claim denials by drug or service.** No public source has these. The Transparency in Coverage PUF has denial reasons but not which services were denied, and it covers only HealthCare.gov plans. Arik's own outcome data (the Price Integrity Loop, M08, and appeal outcomes in M11) is how Arik builds this over time.
- **Texas TDI "IRO Decisions" page:** that's for workers' compensation, not health insurance. Not useful for patients' health-plan denials.
- **Secondary summaries (KFF, OIG, FREOPP):** good research and context, but cite the primary data. Use them for research only.

---

## 6. Coverage (what a plan covers)

| ID | Source | Publisher | URL | What it has | Capture | Cadence | Arik use | Arik label | License / limits | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | Medicare Coverage Database (NCDs, LCDs, Articles) | CMS | Downloads: https://www.cms.gov/medicare-coverage-database/downloads/downloads.aspx ; search https://www.cms.gov/medicare-coverage-database/search.aspx | National and local Medicare coverage rules, billing articles (Part B services, DME, labs, clinic-given drugs; **not** Part D pills) | Bulk (ZIP with CSV + MDB) | Weekly, Thursdays | Denial engine: compare a Medicare denial to the written coverage rule (M13-AC4) | "Medicare coverage rule (CMS MCD, LCD/NCD number, version …)" | US government data. Contains CPT codes: numbers only | Verified |
| V2 | Part D formulary, pharmacy network and pricing files (SPUF) | CMS | Dataset: https://catalog.data.gov/dataset/quarterly-prescription-drug-plan-formulary-pharmacy-network-and-pricing-information ; latest file (2025-12-01 release) https://data.cms.gov/sites/default/files/2026-01/5942aa7e-a0c4-4e65-bd56-32608c33649f/SPUF_2026_20260107.zip | Every Part D and MA-PD plan's formulary (tier, prior auth, step therapy, quantity limit), cost sharing, network pharmacies, average monthly drug pricing, insulin cost sharing | Bulk | Quarterly (a monthly formulary file also exists) | Ranking: Medicare patients' plan rules (M13-AC3, M14-AC4); exception requests | "Your Medicare plan's formulary (CMS file, quarter …)" | Public, US Government Works | Verified |
| V3 | Exchange Public Use Files (Plan Attributes, Benefits and Cost Sharing, Rate, Service Area, Network, Machine-readable URL PUF) | CMS | https://www.cms.gov/marketplace/resources/data/public-use-files | HealthCare.gov plans' deductibles, copays, coinsurance, networks, and each issuer's machine-readable URLs | Bulk | Annual (PY2026 available) | Insurance profile: plan cost sharing (M14-AC3); finding each issuer's formulary feed | "Plan details (CMS Marketplace files, plan year …)" | Free download | Verified |
| V4 | Marketplace machine-readable formularies (issuer `drugs.json`, `plans.json`, `providers.json`) | Each issuer, indexed by the Machine-readable URL PUF (V3) | Index in V3; data dictionary https://www.cms.gov/files/document/machinereadable-datadictionary-py24.pdf | Per drug by RxNorm: tier, prior auth, step therapy, quantity limit, per plan | Bulk (crawl from V3 index) | Issuers update at least monthly | Ranking: marketplace patients' plan rules (M13-AC2) | "Your plan's drug list (issuer file, dated …)" | Public by rule. Research found frequent errors in these files; validate and label as plan-reported | Search-confirmed |
| V5 | Payer FHIR APIs: Provider Directory and Drug Formulary (public, no patient login) | Medicare Advantage, Medicaid, CHIP and FFE QHP payers (CMS-9115 / CMS-0057-F) | Standard: https://hl7.org/fhir/us/davinci-drug-formulary/STU1.0.1/ ; CMS index of required APIs https://www.cms.gov/priorities/burden-reduction/overview/interoperability/implementation-guides-and-standards/standards-and-igs-index-and-resources | Live formulary and provider directory per payer in FHIR | On demand (per payer, endpoint list to build) | Live | Ranking and insurance profile without file downloads; same connector pattern as M15 | "Your plan's formulary (plan's public API, retrieved …)" | Public APIs. Endpoints differ per payer; Kimi builds and maintains a payer endpoint list | Search-confirmed |
| V6 | Medicaid preferred drug lists (PDLs) | Each state Medicaid agency | No central source; each state's Medicaid site | Preferred drugs, prior auth rules | Bulk per state (start with MO and KS) | Varies (often quarterly) | Medicaid patients' plan rules | "Missouri Medicaid preferred drug list (dated …)" | Public. Formats vary (often PDF) | Not yet checked |
| V7 | Commercial insurer medical and pharmacy policies | Each insurer's website | Insurer sites | Coverage criteria for services and drugs | Link-out first; capture passages only where terms allow | Varies | Denial engine: compare a denial to the plan's own written policy | "Insurer's coverage policy (policy number, dated …)" | **Check each site's terms** before capturing (master spec M13) | Not yet checked |

---

## 7. Help paying (programs and charity care)

| ID | Source | Publisher | URL | What it has | Capture | Arik use | License / limits | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | PhRMA Medicine Assistance Tool | PhRMA | https://phrma.org/resources/patient-assistance (links to the tool) | Directory of drugmaker assistance programs | Link-out; capture program names and URLs by hand into `exploits` | Find drugmaker free-drug and copay programs | Industry-run: use as a directory, then verify each program on the drugmaker's own page | Search-confirmed |
| A2 | Drugmaker program pages | Each manufacturer | Manufacturer sites | Program terms, eligibility, applications | Bulk by hand into `exploits`, re-verify on cadence (see arik_health_discount_search_master_list.md) | Arik Agent prefills applications | Primary source for program terms | Existing process |
| A3 | Hospital financial assistance: IRS Form 990 Schedule H via ProPublica Nonprofit Explorer API | ProPublica (IRS data) | https://www.propublica.org/nerds/announcing-the-nonprofit-explorer-api | Nonprofit hospital charity care spending and filings | On demand | Charity care letters: show the hospital is a nonprofit with charity obligations; find its financial assistance policy | Free API; the FAP document itself comes from the hospital's site | Search-confirmed |

---

## 8. Reference data (normalization and lookups)

| ID | Source | Publisher | URL | What it has | Capture | Arik use | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | RxNorm API (RxNav) | National Library of Medicine | https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getNDCs.html | Drug names to RxCUI to NDC mapping | On demand + cache | Match a drug name to NDCs and formulary entries | Search-confirmed |
| R2 | openFDA (NDC directory, labels) | FDA | https://open.fda.gov | NDC directory, drug labels, manufacturer | On demand + cache | Validate NDCs, find manufacturer for program matching | Not opened this session; well-established |
| R3 | NPPES NPI Registry API | CMS | https://npiregistry.cms.hhs.gov/api-page | Every provider and pharmacy NPI with address and taxonomy | On demand + cache | Pharmacy matching (M06-AC3); provider details on bills | Not opened this session; well-established |
| R4 | Census Gazetteer ZCTA file | US Census Bureau | https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html | Zip-area center latitude and longitude | Bulk, yearly | Real distance for nearest pharmacy (M05-AC4) | Search-confirmed |
| R5 | HCPCS Level II and ICD-10 code sets | CMS / CDC | cms.gov and cdc.gov code set pages | Code numbers and descriptions (free) | Bulk, yearly | Read bills and denials | Not yet checked |
| R6 | CARC/RARC denial code lists | X12 | https://x12.org/codes | Claim adjustment and remark codes | Link-out only | Store numbers only, write Arik's own explanations (master spec NN-12) | Policy already set |

---

## 9. Law and precedent

| ID | Source | Publisher | URL | What it has | Capture | Arik use | License / limits | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | CourtListener API and bulk data | Free Law Project | https://wiki.free.law/c/courtlistener/help/api ; bulk https://www.courtlistener.com/help/api/bulk-data/ | Federal and state court opinions, incl. ERISA benefit-denial cases | On demand (research) | Research which arguments win self-funded (ERISA) appeals; never shown as legal advice | Needs a free account; the default rate limit was lowered in May 2026; higher limits with paid membership | Verified (policy change post) |
| L2 | Federal Register | US government | https://www.federalregister.gov | Final rules (e.g., Transparency in Coverage, CMS-0057-F) | On demand | Source citations for rules in `lib/rules/` | Public | Verified (TiC rule page found) |
| L3 | State accumulator ban laws | Already in the repo (`state_accumulator_ban_laws`, 52 rows) | docs/research | Already loaded | n/a | Copay accumulator protections | Existing | Existing |

---

## 10. Build order (recommended)

1. **Pricing and data run (Stage 2):**
   - C1 NADAC live (adapter exists)
   - R1 RxNorm and R3 NPPES lookups
   - R4 ZCTA distances
2. **Denial engine (Stage 3):**
   - D1 Transparency in Coverage PUF loader
   - D2 prior authorization metrics collector (start with the largest Medicare Advantage and Missouri/Kansas payers)
   - V1 Medicare Coverage Database weekly load
   - C6 NCCI quarterly load
   - D4 New York lookups (manual first)
3. **Bill review (Stage 3):**
   - C5 PFS
   - C3 ASP
   - C7 hospital price files for Kansas City hospitals (through each hospital's `cms-hpt.txt`)
4. **Insurance profile and knowledge base (Stage 5):**
   - V2 Part D files
   - V3 Exchange PUFs
   - V4 marketplace formularies
   - V6 Missouri and Kansas Medicaid preferred drug lists
5. **Connected (Stage 6):**
   - V5 payer FHIR APIs
   - C9 payer rate files (targeted)
   - D3 California IMR, after commercial-use approval
6. **Always:** A1/A2 program pages verified by hand on the cadence in arik_health_discount_search_master_list.md.

## 11. Open items

- **D3 California IMR:** request commercial-use approval from CHHS before ingesting.
- **D4 New York DFS:** check the site's terms before automating.
- **D5 Medicare decision search:** document its fields and export options.
- **V5 payer FHIR APIs:** build the payer endpoint list (no central registry found this session).
- **V6 Medicaid preferred drug lists:** find the Missouri and Kansas sources and formats.
- **R5 code sets:** confirm the download URLs.
