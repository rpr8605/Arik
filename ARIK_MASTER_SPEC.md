# ARIK MASTER SPEC

**Owner:** Ryan Russell (RPR Development LLC)
**Version:** 1.0, 2026-10-05
**Audience:** coding agents (Kimi/OpenCode), collaborators, reviewers
**Status of this file:** the single source of truth for WHAT Arik must do, HOW it operates, and HOW COMPLETE it is. Detailed design for many modules already lives in the root docs (BEHAVIOR.md, CASE_MODEL.md, SECURITY.md, and others); this file indexes them, adds everything decided since 2026-08-13, and defines measurable acceptance criteria for every part of the product.

If this file conflicts with an older doc, this file wins, except: `schema.sql` plus the `db/` migrations remain the source of truth for the database as it exists today.

---

## 0. How to use this document (agents read this first)

### 0.1 Read order

1. This file, sections 0 to 4.
2. HANDOFF.md and AGENTS.md (operational rules, apply order, standing timeout rule).
3. The module section (section 5) for whatever you are building, plus the root docs it references.
4. **Task 0 (section 10) before anything else.** It lays the container and AWS groundwork the rest of this file assumes.
5. The build prompt for the current stage in Appendix B of this file (B1 to B5).

### 0.2 Ground rules for every agent, every task

- **Never guess.** Every claim in a report cites evidence: `file:line`, a test name with its output, or command output. Anything not verified is marked **UNVERIFIED**.
- **The rules decide; the AI explains.** Deterministic code (ranking engine, rules engine, eligibility checks) makes every decision about money, eligibility, deadlines and errors. Models only extract, classify, retrieve and word things.
- **No invented facts.** No number, date, code, price, rule, deadline or legal claim may appear in output unless it comes from a cited source row, a confirmed patient fact, or a rule in the rules registry.
- **Local first.** Build and test against the local Supabase stack. Never deploy, never touch production data, never push unless Ryan says so.
- **Small commits, clear messages, all existing tests stay green.**
- **Partner confidentiality.** Pricing-partner discussions are under NDA. Never write a partner company's name, terms, prices or API details into this repo, commit messages, fixtures or logs. Refer to "the pricing partner." Partner data never goes into AI prompts unless that source's `allow_ai_processing` flag is true.

### 0.3 Measuring completeness (the audit procedure)

Every module in section 5 lists acceptance criteria with IDs (for example `M06-AC3`). To audit the app:

1. For each criterion, assign one status:
   - **DONE**: implemented, wired end to end, and proven by a passing test or a reproducible command. Cite the evidence.
   - **PARTIAL**: some of it exists but the criterion is not fully met. Say exactly what is missing.
   - **MISSING**: nothing implements it.
   - **UNVERIFIED**: could not be checked (for example, needs a live service). Say what would verify it.
2. Score: DONE = 1, PARTIAL = 0.5, MISSING = 0, UNVERIFIED = 0 (and listed separately).
3. Module completeness = average of its criteria. Stage completeness = average of the criteria tagged for that stage (section 6).
4. A stage **gate passes** only when every criterion tagged for that stage is DONE.
5. Write the result to `docs/status/AUDIT_<YYYY-MM-DD>.md` using the template in section 9. Never mark DONE without evidence.

---

## 1. What Arik is

**Arik Health is an AI patient advocate for the money side of healthcare.** It finds the cheapest legitimate way to fill a prescription, catches billing errors, fights insurance denials, and does the paperwork for the patient, all from one chat-first app.

- **Users:** patients first; caregivers acting for a family member; later, employers, clinics, navigators and care teams who provide Arik to the people they serve.
- **The rule that makes it trustworthy:** Arik takes no money from PBMs, drugmakers, discount card networks or anyone else in the pricing chain. A ranking nobody can buy.
- **The promise:** Arik does everything up to the one step that legally has to be the patient (a signature, an attestation, a payment, a consent to submit). See BEHAVIOR.md.
- **Scope:** cost, coverage, billing, appeals. Never clinical advice. Never legal advice.

### 1.1 Business model (for context; drives M19)

| Plan | Who | Price |
| --- | --- | --- |
| Free | Everyone | Drug price search, itemized bill request letter |
| Per bill | Occasional bills | Percentage of verified savings, capped per bill |
| Subscription | Chronic illness, caregivers, families | $50/month with an annual savings guarantee |
| Employer | Self-funded employers, benefit advisors | Per employee per month, ROI guarantee |
| Never | PBMs, drugmakers, card networks | No placement, no referral fees, no data sales |

**Hard billing rule:** a patient never pays Arik more than the monthly subscription price ($50) in any calendar month, across all fees combined. Fees are charged only on verified savings. Charity care approvals are never charged a percentage.

**Structure:** planned as a cooperative from the start (advocates as possible worker-owners). Not a code concern, but explains why human advocates appear in M16 and M11.

---

## 2. Non-negotiables

These are enforced in code with tests, not just in prompts.

| ID | Rule | Where it is enforced |
| --- | --- | --- |
| NN-1 | No revenue from PBMs, pharma or discount networks; no affiliate, referral or tracking links | Code review + test that no referral parameters exist in outbound links |
| NN-2 | Every ranked option, rule and claim has a non-null source | `source_id` checks; evidence-conflict triggers (db/017) |
| NN-3 | Model never answers from nothing: empty retrieval returns a deterministic "no data" response | `app/api/chat/route.ts` |
| NN-4 | No clinical advice; clinical records may be read only as evidence about coverage and billing | System prompt + scope check + tests |
| NN-5 | No legal advice; legal questions are referred out; every letter carries the short notice | Scope check + letter footer test |
| NN-6 | Medicare/government insurance hard-block on drugmaker copay cards (Anti-Kickback Statute) | `lib/medicareEligibility.ts`, `lib/ranking.ts` |
| NN-7 | Arik never signs, attests, pays, or invents a diagnosis for the patient | Action framework (M16) permission levels |
| NN-8 | No immigration status persisted; no SSN stored | IMMIGRATION_STATUS_HANDLING.md, SECURITY.md |
| NN-9 | Demographic fields are opt-in and never affect core pricing | DEMOGRAPHIC_ELIGIBILITY.md |
| NN-10 | All sources ranked identically; no source gets a boost | Ranking tests |
| NN-11 | No CPT descriptors displayed until an AMA license exists (`CPT_DISPLAY_ENABLED=false`) | Feature flag + test |
| NN-12 | No X12 code descriptions copied; Arik writes its own explanations and links to x12.org | `denial_codes` table rules |
| NN-13 | Every network call has a timeout (AGENTS.md standing rule) | Code review + tests |
| NN-14 | No real patient data on infrastructure or AI providers without a signed BAA | Deployment gate (M20) |
| NN-15 | Arik Agent: chooses only from the action registry; eligibility, money and deadline decisions come from the rules engine, never the model; the patient personally confirms attestations, signatures, payments and marketing opt-ins; channel order official API or program hub, then fax/mail/email, then web forms only where site terms allow; never bypass CAPTCHAs or bot checks; never impersonate the patient; every action leaves a receipt and an audit row | M16 hard rules + permission-level tests (M16-AC1, M16-AC8) |

### 2.1 Partner data policy (PROPOSED, pending Ryan's confirmation)

BLUE_BUTTON_AND_DISCOUNT_GRAPH.md says Arik never displays a discount network's proprietary prices inline and only links out. A pricing partner has offered API access. **Until Ryan confirms the change below and updates that doc, partner prices may be ingested and tested locally but must not be shown to patients (`allow_patient_display = false`).**

Proposed rule: partner price data may be shown inline only if (a) no money, placement, preferential treatment or favors change hands; (b) it is ranked exactly like every other source; (c) every price shows its source and date; (d) Arik still shows the other options; (e) the data use agreement permits display, caching and any AI processing.

---

## 3. How Arik operates (the journeys)

Each journey is the acceptance test for the modules it touches.

**J1. Cheapest way to fill a prescription**
Patient types a drug (or uploads a pharmacy receipt) → extraction tier pulls drug, dose, insurance type, location → ranking engine compares cash, discount cards, drugmaker programs, direct-to-patient, insurance (with the patient's plan rules when known) against NADAC/CMS baselines → Medicare block and state accumulator laws applied → response model explains the winner with a trust receipt → Arik prepares the enrollment or card (Tier 0/2) → patient confirms the fill → Price Integrity Loop records whether the quoted price held.

**J2. Bill review**
Patient uploads a summary bill → Arik drafts the itemized bill request → itemized bill uploaded → extraction → patient confirms line items → rule checks (duplicates, dates, room days, NCCI edits, units) → Medicare fee schedule and hospital price context → letters (dispute, No Surprises Act, charity care) → deadlines tracked → outcome recorded → fee ledger charges only verified savings.

**J3. Insurance denial**
Patient uploads a denial letter or EOB (later: pulled through a payer connection) → extraction → patient confirms → plan funding identified (fully insured, self-funded, Medicare, Medicaid) → rules engine checks reason, deadlines, prior auth on file, administrative errors, policy mismatch with chart evidence → appeal path chosen → letter drafted with citations → patient approves → Arik sends (M16) → deadlines tracked → outcome feeds which arguments win.

**J4. Insurance profile**
Patient enters or photographs an insurance card → BIN/PCN/group identify the PBM; plan type and funding recorded → plan documents uploaded or formulary data matched → insurance becomes one more labeled path in J1 (Confirmed / Plan rules / Estimated / Unknown).

**J5. Arik Agent does the legwork**
Any journey reaches an action (enroll, request, send, follow up, renew) → the Arik Agent (M16) plans the case's ordered steps, each with a status → it pre-fills forms from confirmed facts, gathers documents and drafts the submission → the patient is asked only for the steps that legally must be theirs: one-tap approval at the step's BEHAVIOR.md tier, with attestations, signatures, payments and marketing opt-ins always performed by the patient personally → the agent submits through the best allowed channel (official API or program hub first, then fax/mail/email, web form last and only where site terms allow) → every action leaves a receipt with a confirmation number and an audit row → the agent follows up automatically, tracks renewals, and alerts on failure.

**J6. Caregiver**
Caregiver manages a family member's cases with an authorization on file (CAREGIVER_MODE.md); every journey above works on the managed patient's behalf within that authorization.

---

## 4. Architecture

### 4.1 Layers

| Layer | Today | Target |
| --- | --- | --- |
| UI | Next.js 16 App Router, chat-first, case list home | Same; add approval screens, receipts, insurance profile, letters; installable web app, then App Store and Google Play apps wrapping the same UI (M23) |
| API | Next.js route handlers in `app/api/` | Same; every route session-guarded |
| Decision engines | `lib/ranking.ts`, `lib/medicareEligibility.ts`, `lib/deadlines.ts`, `lib/mtm.ts` | Add `lib/rules/` (denials, bills), `lib/pricing/` (ingest) |
| AI layer | `lib/callModel.ts` → OpenRouter (Haiku extraction, Sonnet 4.6 response) | Provider interface: OpenRouter for local dev; BAA-covered provider (Anthropic direct or AWS Bedrock) for patient data; Sonnet 5.5 after evals pass |
| Data | Supabase Postgres, 36 tables, RLS, pgcrypto, pg_cron, Storage | Same schema, self-hosted Supabase on AWS under a BAA |
| Connectors | None | Pricing sources, payer/EHR connections (FHIR), outbound channels (fax, mail, email) |
| Jobs | pg_cron purge, HTTP purge job | Ingest jobs, staleness checks, deadline reminders |
| Hosting | Vercel + hosted Supabase (database project lapsed) | Local Docker for dev; AWS EC2 with Docker, self-hosted Supabase, S3 backups, Bedrock (see infra/aws/README.md) |

### 4.2 Framework pieces (built in Task 0, section 10)

- `output: 'standalone'` in `next.config.ts` (container-ready server bundle).
- `Dockerfile`, `.dockerignore`, `docker-compose.yml` (app container; Supabase runs separately).
- `lib/env.ts`: the one list of every environment variable and its purpose.
- `GET /api/health` (and `?db=1`): status, version, missing env names; 503 when degraded.
- `lib/callModel.ts`: hard timeout covering the whole model exchange (`MODEL_TIMEOUT_MS`, default 60s); test `scripts/test_callmodel_timeout.ts`.
- infra/aws/README.md: target AWS architecture and runbook (content in Appendix A).

---

## 5. Module catalog

Format for each module: **Purpose**, **Existing pieces**, **Spec docs**, **Build requirements**, **Acceptance criteria** (with stage tags S1 to S7 from section 6), **Status at 2026-10-05** (main as of 2026-08-13 plus the 2026-10-05 framework commit).

### M01. Platform and security foundation

**Purpose:** a safe base every feature sits on.
**Existing:** `proxy.ts` (session refresh, anonymous sign-in), `lib/session.ts`, `lib/env.ts`, `/api/health`, model timeout.
**Spec docs:** SECURITY.md, AGENTS.md.
**Build requirements:** session guard helper used by every route; ownership checks on every row access (cases, managed patients via `authorizations_on_file`); never trust a user id from query or body; security headers; rate limiting on chat and upload routes; secrets only in env.

| ID | Criterion | Stage |
| --- | --- | --- |
| M01-AC1 | Every route under `app/api/` except `/api/health` and the service-key job route returns 401 with no session (test per route) | S1 |
| M01-AC2 | Cross-user access to any case, document, identity or managed patient returns 403/404 (test per route) | S1 |
| M01-AC3 | `privacy` DELETE/PATCH act only on the session user; no user id accepted from query or body | S1 |
| M01-AC4 | All "AUTH NOTE" placeholders removed | S1 |
| M01-AC5 | Every outbound fetch has a timeout (grep plus tests for model calls and connectors) | S1 |
| M01-AC6 | `/api/health` reports missing env by name only; `?db=1` checks the database with a 5s timeout | S1 |
| M01-AC7 | Rate limits on chat, upload and auth-adjacent routes, with tests | S4 |
| M01-AC8 | Security headers (CSP, HSTS, frame-ancestors) set and tested | S4 |

**Status:** all MISSING. Task 0 delivers AC6 and the model-call part of AC5.

### M02. Database and environments

**Purpose:** a reproducible database anywhere: laptop, CI, AWS.
**Existing:** `schema.sql`, `db/002` to `db/021`, `scripts/apply_db.mjs`, `scripts/run_sql.mjs`, seed scripts, `smoke_rls.mjs`.
**Build requirements:** local Supabase stack via the Supabase CLI; one command applies schema, migrations and seeds to an empty database; scripts read connection details from env only; anonymous sign-in enabled in config.

| ID | Criterion | Stage |
| --- | --- | --- |
| M02-AC1 | One documented command builds the full database from empty (schema, 21+ migrations, seeds) | S1 |
| M02-AC2 | Table count, seed counts and RLS state reported by a check script and match expectations | S1 |
| M02-AC3 | No script hardcodes a remote project host | S1 |
| M02-AC4 | `smoke_rls.mjs` and `smoke_anonymous_flow.mjs` pass against the local stack | S1 |
| M02-AC5 | Nightly encrypted backup and a tested restore on the target host | S4 |

**Status:** all MISSING (the hosted project was deleted; local stack not yet set up).

### M03. Case model, deadlines, escalations

**Purpose:** the case, not the conversation, is the unit of work.
**Existing:** `cases`, `deadlines`, `escalations`, `case_outcomes`, `case_summaries`; `lib/cases.ts`, `lib/deadlines.ts`, `lib/outcomes.ts`; `test_transitions.ts`, `test_outcomes.ts`.
**Spec docs:** CASE_MODEL.md, DATA_RETENTION.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M03-AC1 | Case status workflow enforced with tests (existing suite stays green) | S1 |
| M03-AC2 | Every generated letter or action creates linked deadline rows | S3 |
| M03-AC3 | Deadline reminders delivered (in-app first; email later) before due dates | S4 |
| M03-AC4 | Outcomes confirmed by the patient feed the Price Integrity Loop and appeal outcomes | S3 |

**Status:** AC1 DONE (13 + 10 assertions). Others MISSING.

### M04. Chat and AI layer

**Purpose:** chat-first experience; models extract and explain, never decide.
**Existing:** `app/api/chat/route.ts`, `chat_system_prompt.md`, `lib/callModel.ts`, `lib/modelConfig.ts`, `lib/extractedFacts.ts`; Spanish support; crisis instruction; trust receipt.
**Spec docs:** BEHAVIOR.md, CRISIS_AWARE_DESIGN.md, CONVERSATIONAL_ENTITY_EXTRACTION.md, UNIVERSAL_ACCESS.md, SCENARIOS.md.
**Build requirements:** a provider interface so the same tiers can run on OpenRouter (local dev) or a BAA-covered provider (Anthropic direct or Bedrock) by config; prompt caching; scope check covers off-topic, clinical and legal questions; model upgrades gated by evals.

| ID | Criterion | Stage |
| --- | --- | --- |
| M04-AC1 | Empty retrieval returns the deterministic "no data" response (test) | S1 |
| M04-AC2 | Model calls go through one provider interface selected by env (`AI_PROVIDER`), with OpenRouter and one BAA-capable provider implemented | S4 |
| M04-AC3 | Response tier on Claude Sonnet 5.5 after the 12 graded ranking eval cases pass at or above the 4.6 baseline | S1 |
| M04-AC4 | Prompt caching on the system prompt, with measured cost per turn logged | S1 |
| M04-AC5 | Legal-advice questions are detected and referred out (test) | S3 |
| M04-AC6 | Clinical scope rule: may read clinical records as evidence, never gives medical advice (tests for both halves) | S3 |
| M04-AC7 | Crisis language drops task mode (existing behavior, test) | S1 |

**Status:** AC1 and AC7 DONE per existing code and smoke history (re-verify locally); others MISSING.

### M05. Drug ranking engine

**Purpose:** pick the cheapest legitimate path for a patient, honestly.
**Existing:** `lib/ranking.ts` (23 tests), Medicare block (17 tests), state accumulator ban table (52 rows), evidence-conflict system, `eval_ranking.ts` (12 graded cases), exploits library (~21 rows), 3 full-depth demo drugs.
**Spec docs:** METHODOLOGY.md, README.md, Arik_Accumulator_Ban_and_Program_Terms_Research.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M05-AC1 | All existing ranking, Medicare and eligibility tests pass | S1 |
| M05-AC2 | `eval_ranking.ts` passes all 12 graded cases against the local database | S1 |
| M05-AC3 | Ranking reads prices from all enabled sources identically, excluding stale rows, and says which were excluded | S2 |
| M05-AC4 | Pharmacy-level prices ranked by distance from the patient's zip when available | S2 |
| M05-AC5 | Insurance appears as a labeled path (Confirmed / Plan rules / Estimated / Unknown) | S6 |
| M05-AC6 | Duplicate discount cards that route through the same processor are collapsed (BLUE_BUTTON_AND_DISCOUNT_GRAPH.md) | S2 |

**Status:** AC1 DONE (82 assertions pass on 2026-10-05). AC2 UNVERIFIED (needs local DB). AC3 DONE (audit 2026-10-05). AC4 DONE 2026-10-16: pharmacy-level prices carry distance from the patient's zip (zip_centroids, db/031), cost first then nearer pharmacy, over 50 miles left out; no pharmacy-level price data is loaded yet (test_ranking.ts). AC5 MISSING. AC6 DONE 2026-10-16: cards sharing `underlying_processor` collapse to the cheapest, naming the others (test_ranking.ts).

### M16. Arik Agent (the workhorse)

**Purpose:** an AI agent that does the patient's legwork end to end: plans the steps for each case, fills forms, gathers documents, drafts and submits, follows up, tracks renewals, and asks the patient only for steps that legally must be theirs.
**Spec docs:** BEHAVIOR.md (autonomy tiers 0 to 3); design doc section "Arik acts for you".
**Build requirements:** action registry (type, required fields, permission level, method, data shared, reversibility); per-case agent plan; approval screen; receipts in the case timeline with confirmation numbers; audit log.
**Hard rules (NN-15):** the agent chooses only from the action registry; eligibility, money and deadline decisions come from the rules engine, never the model; the patient personally confirms attestations, signatures, payments and marketing opt-ins; channel order is official API or program hub, then fax/mail/email, then web forms only where site terms allow; never bypass CAPTCHAs or bot checks; never impersonate the patient; every action leaves a receipt and an audit row.

Phased: v1 (S3) prepares and tracks, nothing leaves the system; v2 (S5) sends for the patient; v3 (S6) standing permission for routine actions; v4 (S7) web forms.

| ID | Criterion | Stage |
| --- | --- | --- |
| M16-AC1 | Action registry with permission levels mapped to BEHAVIOR.md tiers | S3 |
| M16-AC2 | Per-case agent plan: ordered steps with status | S3 |
| M16-AC3 | Form pre-fill from confirmed facts only (test: no unconfirmed value is ever filled) | S3 |
| M16-AC4 | Program application packets attached to exploits (fillable fields) | S3 |
| M16-AC5 | Approval screen: one-screen summary, one tap, recorded consent | S3 |
| M16-AC6 | Receipts and audit log for every action, including failures | S3 |
| M16-AC7 | Status board and reminder deadlines per case | S3 |
| M16-AC8 | Tests prove attest, sign, pay and marketing opt-in steps are impossible without the patient | S3 |
| M16-AC9 | Fax, mail and email channel through a vendor with a BAA | S5 |
| M16-AC10 | Program API/hub submissions | S5 |
| M16-AC11 | Automatic follow-ups and renewal tracking | S5 |
| M16-AC12 | Failure alerts and retries | S5 |
| M16-AC13 | Standing permission: the patient pre-approves named routine action types, revocable any time; every run still leaves a receipt | S6 |
| M16-AC14 | Browser-automated form fill with patient approval at final submit, only where site terms allow | S7 |

**Status:** all MISSING.

### M06. Pricing ingestion pipeline

**Purpose:** turn hand-entered prices into automated, source-tagged price feeds.
**Existing:** `price_points`, `sources` (with freshness fields), `drugs`. No import code.
**Build requirements:** see Appendix B2 Part A. Adapter interface (bulk and quote modes), schema additions (price_sources, pharmacies, freshness and permission fields, ingest audit), NDC normalization, NADAC as first source, ingest runner, enforcement in ranking.

| ID | Criterion | Stage |
| --- | --- | --- |
| M06-AC1 | Adapter interface supports bulk and quote modes; records validated at the boundary | S2 |
| M06-AC2 | `price_sources` with enabled, staleness, retention, `allow_patient_display`, `allow_ai_processing` (defaults false) | S2 |
| M06-AC3 | Pharmacy table and `pharmacy_id` on prices; NPI/NCPDP matching | S2 |
| M06-AC4 | NDC 10-to-11 normalization with tests; unmatched NDCs flagged, never guessed | S2 |
| M06-AC5 | NADAC adapter with fixture tests; NADAC labeled as a benchmark, never a patient price | S2 |
| M06-AC6 | Idempotent ingest runner with an audit row per run | S2 |
| M06-AC7 | Retention purge per source | S2 |
| M06-AC8 | Tests prove `allow_patient_display=false` rows never reach patient output and `allow_ai_processing=false` rows never reach a model prompt | S2 |

**Status (2026-10-16):** all DONE. AC1 quote mode added (`PriceQuoteAdapter`, lib/pricing/adapter.ts; config template quote()). AC2/AC4/AC5/AC7/AC8 per docs/status/AUDIT_2026-10-05.md. AC3 pharmacies (db/025) matched by NPI in the ingest runner; unknown NPI is a reject. AC6 one `ingest_runs` row per run, counts and reason counts only (test_ingest_integration.mjs).

### M07. Partner pricing integration

**Purpose:** plug the pricing partner's API in with a small adapter and a config entry.
**Build requirements:** see Appendix B2 Part B: hardened HTTP client (timeouts, backoff with jitter, 429 and Retry-After, circuit breaker), config-driven adapter template, local mock partner API, quote mode in chat with cache and graceful fallback, kill switch, one-command purge, no-leak logging tests, partner onboarding checklist.

| ID | Criterion | Stage |
| --- | --- | --- |
| M07-AC1 | Hardened HTTP client with tests for timeouts, 5xx retry, 429 handling and circuit breaker | S2 |
| M07-AC2 | Config-driven adapter template supports API key, bearer and OAuth client credentials auth, and page/offset/cursor pagination | S2 |
| M07-AC3 | Local mock partner API exercises valid, paginated, 401, 429, 500, timeout, malformed, stale and unknown-NDC cases | S2 |
| M07-AC4 | Chat never fails because a partner failed (fallback test) | S2 |
| M07-AC5 | `source_disable` and `source_purge` commands with audit records | S2 |
| M07-AC6 | Startup fails fast when an enabled source lacks env vars; logs never contain prices or secrets (test) | S2 |
| M07-AC7 | Repo tagged before any partner confidential information arrives | S1 |
| M07-AC8 | Real partner adapter built from partner docs and passing contract tests | S3 (after docs and data use agreement) |

**Status (2026-10-16):** AC1 to AC7 DONE, mock only: lib/pricing/http.ts (test_http_client.ts), configAdapter.ts + mockPartner.ts + scripts/mock_partner_api.ts, quotes.ts wired into chat with a note when a source doesn't answer, `npm run source:disable|enable|purge` with source_admin_events, instrumentation.ts + /api/health env check, no-leak test (test_partner_readiness.ts), docs/partner_onboarding_checklist.md. AC8 waits on the partner's written OK and docs (private repo).

### M24. Prescription routing

**Purpose:** when a manufacturer direct or other cash pharmacy is the cheapest legitimate path, help the patient get the prescription to that pharmacy, through a neutral adapter for any routing partner. Build prompt: docs/kimi/rx_routing_build.md.
**Hard rules:** no money for routing, ever (no fee, revenue share, referral payment, data fee or favor; enforced by a DB check and tests); partner names, terms, prices and API details never in this repo ("routing partner"); the real adapter lives in the private adapters repo and passes the same contract suite; decisions (cash vs insurance, eligibility, Medicare/Medicaid blocks) come from the rules engine, never the model; Arik never makes a clinical decision and never sends a prescription itself; only an opaque reference goes to a partner, never patient identifiers.

| ID | Criterion | Stage |
| --- | --- | --- |
| M24-AC1 | `dtc_programs` table, CSV import with template, every row sourced | S3 |
| M24-AC2 | Cash vs insurance rule (`lib/rules/cashVsInsurance.ts`): government-insured never steered to a DTP program unless allowed; unknown plan cost asks the patient; deductible caveat | S3 |
| M24-AC3 | Routing and transfer request documents, prepared only, patient approval, receipt; no transfer for controlled substances | S3 |
| M24-AC4 | `RxRoutingProvider` interface, boundary validation, mock provider, reusable contract suite, kill switch and purge | S3 (mock), S5 (live) |
| M24-AC5 | `routing_partners` with `compensation_to_arik = 'none'` enforced by a DB check; neutrality test (affiliation never changes ranking) | S3 |
| M24-AC6 | Public `/how-we-route` page generated from `routing_partners` | S3 |

**Status (2026-10-16):** AC4 to AC6 DONE against the mock: lib/routing/ (provider, httpProvider, mockRoutingPartner, contract, rank, admin, disclosure), db/034, `npm run routing:disable|enable|purge`, app/how-we-route; tests test_routing.ts (contract, minimization, neutrality, no-money) and test_routing_db.mjs (DB checks, kill switch). AC2 is queued (owner's list, after free_data_loaders). AC1 and AC3 MISSING. Live partner connection waits for S4 security, a signed data use agreement and the partner's written OK.

### M08. Price Integrity Loop

**Purpose:** know whether quoted prices actually held at the counter; score sources.
**Existing:** `case_outcomes.pharmacy_used`, patient confirmation prompt, `/api/outcomes`.

| ID | Criterion | Stage |
| --- | --- | --- |
| M08-AC1 | Fill outcome captured per quoted price (paid amount, pharmacy, date) | S6 |
| M08-AC2 | Reliability score per source and per source-pharmacy pair, with a documented formula | S6 |
| M08-AC3 | Ranking uses reliability as an input, never silent suppression; explained in the trust receipt | S6 |
| M08-AC4 | Verified savings records feed the fee ledger (M19) | S7 |

**Status:** AC1 PARTIAL (outcome capture exists, not per quote). Others MISSING.

### M09. Document intake

**Purpose:** get bills, EOBs, denial letters and plan documents in safely and accurately.
**Existing:** `lib/documentIntake.ts` (PDF text first, raster fallback, HEIC, 25MB cap), `/api/cases/[id]/documents`, camera capture, 48h raw purge.
**Spec docs:** MULTI_FORMAT_UPLOAD.md, GUIDED_DOCUMENT_SCANNING.md, DATA_RETENTION.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M09-AC1 | Document types: summary bill, itemized bill, EOB, denial letter, prior auth decision, plan summary, insurance card | S3 |
| M09-AC2 | Malware scanning through a pluggable scanner; production fails closed without one | S4 |
| M09-AC3 | Extraction validated against a schema; invalid output rejected | S3 |
| M09-AC4 | Patient confirmation gate: no rule runs on unconfirmed fields (test) | S3 |
| M09-AC5 | Raw uploads purged on schedule on the target host | S4 |

**Status:** AC1 PARTIAL (bills/EOBs only), AC5 PARTIAL (HTTP job exists, schedule not deployed). Others MISSING.

### M10. Bill review

**Purpose:** find billing errors and unfair prices; produce letters.
**Existing:** `bill_audit_findings`, `hospital_financial_assistance_policies`.
**Build requirements:** see Appendix B3.

| ID | Criterion | Stage |
| --- | --- | --- |
| M10-AC1 | Checks: duplicates, out-of-window dates, room-day count, each citing its rule | S3 |
| M10-AC2 | NCCI procedure-to-procedure and medically-unlikely-edit importer with version recorded on each flag | S3 |
| M10-AC3 | Medicare Physician Fee Schedule shown as context only | S3 |
| M10-AC4 | Summary-bill-only cases produce the itemized bill request letter | S3 |
| M10-AC5 | Hospital price transparency file import for a first set of Kansas City hospitals | S6 |
| M10-AC6 | No CPT descriptors displayed while `CPT_DISPLAY_ENABLED=false` (test) | S3 |

**Status:** all MISSING.

### M11. Denial engine

**Purpose:** read denials, find where they are wrong, and choose the right appeal path.
**Existing:** `denial_appeals`, `exception_precedents`, `employer_plans`.
**Build requirements:** see Appendix B4. Rules registry with citations; deadline rules for fully insured, self-funded (ERISA federal track), Medicare Part D, impacted-payer prior authorization; check functions; denial reader with confirmation gate; plan-funding intake question; `eval_denials.ts` harness.

| ID | Criterion | Stage |
| --- | --- | --- |
| M11-AC1 | `denials`, `denial_codes`, `rules`, `appeal_outcomes` tables with RLS | S3 |
| M11-AC2 | Every encoded rule has a citation and a unit test, including date edge cases | S3 |
| M11-AC3 | Check functions: missing reason, insurer late, patient deadline, prior auth on file, administrative, self-funded track, no error found | S3 |
| M11-AC4 | Denial codes stored as numbers only, explanations written by Arik (`needs_review` until approved), link to x12.org | S3 |
| M11-AC5 | Plan funding captured at intake and routes deadline rules | S3 |
| M11-AC6 | `eval_denials.ts` runs synthetic fixtures for every category | S3 |
| M11-AC7 | Medicare Advantage, Medicaid and state rules added with citations | S5 |

**Status:** all MISSING.

### M12. Letters and output documents

**Purpose:** every letter Arik drafts is accurate, cited and safe.
**Existing:** `output_documents`, `shared_reviews`.
**Spec docs:** EXPORT_AND_TRANSLATION.md, PHARMACIST_AND_REVCYCLE_FORMATS.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M12-AC1 | Template engine (text to PDF) shared by bill review, denials and enrollments | S3 |
| M12-AC2 | Test proves no number, date, code, name or deadline appears unless present in the confirmed record or a rule | S3 |
| M12-AC3 | Exact short notice on every letter: "Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice." | S3 |
| M12-AC4 | Medical necessity letters request the doctor's letter; Arik writes no clinical judgment | S3 |
| M12-AC5 | Spanish output for letters, citations kept verbatim | S5 |

**Status:** all MISSING.

### M13. Knowledge base (policies and rules sources)

**Purpose:** cited, dated, refreshable plan rules and coverage policies.
**Existing:** `sources` with freshness fields, `scripts/check_staleness.mjs` (manual).
**Build requirements:** `policy_documents` (passage, source URL, retrieved date, next check), loaders for the free sources in priority order: federal appeal rules; marketplace machine-readable formularies (`drugs.json`); CMS Part D formulary files; Medicare Coverage Database; payer prior authorization reports; state Medicaid preferred drug lists; commercial insurer policies (check each site's terms); state step therapy laws.

| ID | Criterion | Stage |
| --- | --- | --- |
| M13-AC1 | `policy_documents` table with source, retrieval date and next-check date | S5 |
| M13-AC2 | Marketplace `drugs.json` loader (tier, prior auth, step therapy, quantity limit by RxNorm) | S5 |
| M13-AC3 | Part D formulary file loader | S5 |
| M13-AC4 | Medicare Coverage Database loader (CPT license terms respected) | S5 |
| M13-AC5 | Automated staleness job replacing the manual script | S5 |

**Status:** all MISSING.

### M14. Insurance profile and lookup

**Purpose:** know the patient's coverage well enough to rank it honestly.
**Existing:** `app/PlanTypeSelector.tsx`, `/api/profile/insurance-type`, `user_matching_profile.insurance_plan_name`, `employer_plans`.

| ID | Criterion | Stage |
| --- | --- | --- |
| M14-AC1 | Insurance card entry or photo: payer, member ID (encrypted), group, BIN, PCN, Rx group | S5 |
| M14-AC2 | PBM identified from BIN/PCN; plan type and funding recorded | S5 |
| M14-AC3 | Plan documents (Summary of Benefits, EOB) parsed for Rx tiers and copays, labeled Estimated | S5 |
| M14-AC4 | Formulary match (M13) labeled Plan rules | S6 |
| M14-AC5 | Warning when cash may not count toward the deductible | S5 |

**Status:** AC1 PARTIAL (plan type only). Others MISSING.

### M15. Record connections

**Purpose:** pull claims and clinical evidence with the patient's permission.
**Spec docs:** BLUE_BUTTON_AND_DISCOUNT_GRAPH.md; design doc "Arik: Chart Integration and Denial Engine Design".
**Build requirements:** a connector interface (same pattern as pricing adapters); `record_connections` (encrypted, revocable tokens, scopes); minimum-necessary resource pulls; paths in order: Medicare Blue Button 2.0 (free, sandbox), SMART on FHIR patient apps registered directly with EHR vendors, Flexpa (Patient Access API and TEFCA Individual Access; Startup tier $20,000/year, to be funded).

| ID | Criterion | Stage |
| --- | --- | --- |
| M15-AC1 | Connector interface and `record_connections` table built against a mock FHIR server | S5 |
| M15-AC2 | Blue Button 2.0 sandbox connection pulls Coverage and ExplanationOfBenefit | S6 |
| M15-AC3 | Per-source consent captured and revocable; disconnect deletes tokens | S6 |
| M15-AC4 | Flexpa adapter (after funding) | S6 |

**Status:** all MISSING.

### M17. Caregiver mode and authorizations

**Existing:** `managed_patients`, `authorizations_on_file`, `lib/caregivers.ts`, `/api/managed-patients`.
**Spec docs:** CAREGIVER_MODE.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M17-AC1 | Caregiver access limited to authorized managed patients (tests) | S1 |
| M17-AC2 | Authorization forms generated: HIPAA release, authorized representative, Medicare Appointment of Representative (CMS-1696) | S5 |

**Status:** AC1 PARTIAL (logic exists; route unguarded). AC2 MISSING.

### M18. Privacy, consent and compliance

**Existing:** `consent_ledger`, `lib/consent.ts`, `lib/privacy.ts`, `lib/identityCrypto.ts`, retention jobs.
**Spec docs:** SECURITY.md, DATA_RETENTION.md, IMMIGRATION_STATUS_HANDLING.md, DEMOGRAPHIC_ELIGIBILITY.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M18-AC1 | Full not-legal-advice notice at onboarding, accepted and recorded (`legal_notice` consent category) | S3 |
| M18-AC2 | Washington My Health My Data Act opt-in consent before health data collection, recorded | S4 |
| M18-AC3 | Privacy policy and terms pages, reviewed by counsel | S4 |
| M18-AC4 | AI use disclosed to the patient; human review offered | S4 |
| M18-AC5 | Data export and deletion work end to end (tests) | S4 |
| M18-AC6 | Breach response plan documented (FTC Health Breach Notification Rule) | S4 |

**Status:** all MISSING (consent ledger exists but lacks these categories).

### M19. Plans, billing and the fee ledger

| ID | Criterion | Stage |
| --- | --- | --- |
| M19-AC1 | Fee ledger per patient/household; charges only on verified savings documents | S7 |
| M19-AC2 | Monthly cap: total charges never exceed the subscription price in a calendar month (test); no carry-over | S7 |
| M19-AC3 | Subscribers never charged per-bill fees (test) | S7 |
| M19-AC4 | Annual savings guarantee calculation and refund record | S7 |
| M19-AC5 | Charity care approvals never charged a percentage (test) | S7 |
| M19-AC6 | Employer plan accounts and reporting | S7 |

**Status:** all MISSING.

### M20. Infrastructure and AWS deployment

**Spec docs:** infra/aws/README.md.

| ID | Criterion | Stage |
| --- | --- | --- |
| M20-AC1 | Container builds from `Dockerfile`; runs as non-root; health check passes | S1 |
| M20-AC2 | `docker compose` runs the app against the local Supabase stack | S1 |
| M20-AC3 | Self-hosted Supabase compose for AWS with secrets from AWS Secrets Manager or SSM | S4 |
| M20-AC4 | TLS reverse proxy; only 443 public; Postgres and Studio not public | S4 |
| M20-AC5 | AWS BAA accepted; only HIPAA-eligible services used for patient data | S4 |
| M20-AC6 | Nightly encrypted backups to S3 with a tested restore | S4 |
| M20-AC7 | CI builds, tests and produces a versioned image on every push | S4 |
| M20-AC8 | Infrastructure defined as code | S6 |

**Status:** all MISSING. Task 0 delivers the Dockerfile and compose file for AC1 and AC2.

### M21. Observability and operations

| ID | Criterion | Stage |
| --- | --- | --- |
| M21-AC1 | Structured logs with request ids; no PHI, prices or secrets in logs (test) | S4 |
| M21-AC2 | Model cost per turn and per case recorded | S4 |
| M21-AC3 | Alerts on health check failure, job failure and error spikes | S4 |
| M21-AC4 | Audit log for admin and action-framework events | S5 |

**Status:** all MISSING (one-line model usage log exists).

### M22. Testing and evaluation

| ID | Criterion | Stage |
| --- | --- | --- |
| M22-AC1 | One command runs every pure test suite (`npm test`) | S1 |
| M22-AC2 | `eval_ranking.ts` and `eval_denials.ts` run in CI against a seeded database | S4 |
| M22-AC3 | Graded denial and bill cases written by billing experts (back burner until M10 and M11 exist) | S6 |
| M22-AC4 | Smoke suites run against the local stack and pass | S1 |

**Status:** AC1 PARTIAL (suites exist, no single command). Others MISSING.

### M23. Mobile: installable web app and store apps

**Purpose:** put Arik on patients' phones without rebuilding it. The web app stays the single product. First it becomes installable (a progressive web app). After the pilot, the same app is wrapped with Capacitor for the Apple App Store and Google Play.
**Existing:** chat-first Next.js UI, camera capture in document intake, in-app account deletion (M18-AC5).
**Build requirements:**
- One codebase. No native rewrite.
- The store apps load the hosted Arik app and add phone features through Capacitor plugins.
- Notifications never contain patient details (no drug names, amounts, diagnoses or insurer names). For example: "You have an update in Arik."
- Nothing with patient data is cached for offline use.

| ID | Criterion | Stage |
| --- | --- | --- |
| M23-AC1 | Installable web app: web app manifest, icons, standalone display, service worker with an offline screen that holds no patient data; passes the browser's installability check on iPhone and Android | S4 |
| M23-AC2 | Deadline reminders by web push, opt-in with consent recorded in `consent_ledger`; notification text contains no patient details (test) | S4 |
| M23-AC3 | Capacitor iOS and Android projects wrapping the hosted app; builds reproducible from the repo; app points only at the production domain | S6 |
| M23-AC4 | Phone features that make it more than a website: native camera bill and EOB capture feeding M09 intake, native push for deadlines (same no-details rule), Face ID / fingerprint unlock | S6 |
| M23-AC5 | Store readiness: privacy policy and terms linked in app; account deletion reachable in app; privacy labels and data-safety answers documented in the repo; Sign in with Apple added if any third-party sign-in is offered; store listing text and screenshots | S6 |
| M23-AC6 | Payments decision documented before any in-app purchase: current Apple and Google rules for subscriptions, whether to link out to web checkout, and employer-paid accounts as the default path (blocked on M19) | S7 |

**Status:** all MISSING.

---

## 6. Stages and gates

| Stage | Name | Goal | Gate (all tagged criteria DONE) |
| --- | --- | --- | --- |
| S1 | Demo-ready | Arik runs locally, secured, with a recorded walkthrough | M01-AC1 to AC6, M02-AC1 to AC4, M03-AC1, M04-AC1/3/4/7, M05-AC1/2, M07-AC7, M17-AC1, M20-AC1/2, M22-AC1/4 |
| S2 | Partner-ready | Any pricing partner plugs in with a small adapter | All S2 criteria in M05, M06, M07 |
| S3 | Denials and bills v1 | Upload-based denial engine, bill review and letters; Arik Agent v1 (prep and track) | All S3 criteria in M03, M04, M09, M10, M11, M12, M16, M18-AC1 |
| S4 | Pilot-ready | Safe for real patient data on AWS; installable on phones | All S4 criteria (M01, M02, M04-AC2, M09, M18, M20, M21, M22, M23) |
| S5 | Acts for you + insurance | Action framework, insurance profile, knowledge base | All S5 criteria |
| S6 | Connected | Record connections, formulary match, Price Integrity Loop, App Store and Google Play apps | All S6 criteria |
| S7 | Business-ready | Fees, guarantee, employer plans, browser actions | All S7 criteria |

Stages S2 and S3 can run in parallel after S1. S4 must pass before any real patient data, partner data shown to patients, or record connections.

---

## 7. Decisions

### 7.1 Locked

- Case is the unit of the product (CASE_MODEL.md).
- Two model tiers; models never decide (HANDOFF.md, this file).
- pgcrypto application-layer identity encryption (SECURITY.md).
- Employers are the main revenue; consumer plans per section 1.1; $50 monthly cap on patient fees.
- Arik does everything up to the legally required patient step (BEHAVIOR.md tiers).
- Arik Agent is core product; v1 starts in S3.
- Self-funded plans get a separate federal track; first letter requests the claim file.
- Denial codes: numbers stored, Arik's own explanations, link to x12.org.
- Uploads first; record connections after AWS hosting with BAAs; Flexpa when funded.
- Target host: AWS under a BAA (infra/aws/README.md).
- Every letter and the onboarding flow carry the not-legal-advice notices.
- Mobile: installable web app at the pilot (S4); App Store and Google Play apps via a Capacitor wrapper after the pilot (S6); no native rewrite (M23).

### 7.2 Open (do not build past these without Ryan)

- Partner data display policy (section 2.1).
- AMA CPT license (cost and scope).
- X12 code list subscription.
- AI provider for patient data: Anthropic direct with a BAA, or Claude on AWS Bedrock (confirm model coverage).
- Mail/fax vendor with a BAA.
- Counsel review: debt-settlement and adjuster laws before percentage fees or advocate negotiation; privacy policy; terms.
- Which legal entity lists the store apps (RPR Development LLC or the co-op); Apple organization enrollment needs a D-U-N-S number for that entity.
- Store payment rules for subscriptions (M23-AC6).

---

## 8. Reference index

| Topic | Doc |
| --- | --- |
| Master index, build history | HANDOFF.md |
| Agent rules, apply order, timeouts | AGENTS.md |
| Case model, deadlines, evidence freshness | CASE_MODEL.md |
| Autonomy tiers, onboarding, tone | BEHAVIOR.md |
| Security and identity split | SECURITY.md |
| Retention | DATA_RETENTION.md |
| Crisis-aware design | CRISIS_AWARE_DESIGN.md |
| Caregivers | CAREGIVER_MODE.md |
| Source grading | METHODOLOGY.md |
| Discount networks, Blue Button | BLUE_BUTTON_AND_DISCOUNT_GRAPH.md |
| Exceptions engine | EXCEPTION_INTELLIGENCE_ENGINE.md |
| Employer plans | EMPLOYER_PLAN_DATABASE.md |
| Pharmacist and revenue-cycle formats | PHARMACIST_AND_REVCYCLE_FORMATS.md |
| Uploads and scanning | MULTI_FORMAT_UPLOAD.md, GUIDED_DOCUMENT_SCANNING.md |
| Referrals | REFERRAL_NETWORK.md, ATTORNEY_REFERRAL.md |
| Access and language | UNIVERSAL_ACCESS.md, ACCESSIBILITY.md |
| UI | UI_UX.md |
| AWS target and runbook | infra/aws/README.md (Appendix A) |
| First task (framework) | Section 10 of this file |
| Build prompts by stage | Appendix B1 (local setup + auth), B2 (pricing), B3 (bill review), B4 (denial engine), B5 (AWS readiness) |

---

## 9. Audit report template

Save as `docs/status/AUDIT_<YYYY-MM-DD>.md`.

```markdown
# Arik completeness audit, <date>

Commit: <sha>   Auditor: <agent>   Database: <local/none>

## Summary
| Stage | Criteria | Done | Partial | Missing | Unverified | Score | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | | | | | | % | pass/fail |
...

## Modules
| Module | Score | Notes |
| --- | --- | --- |
| M01 | % | |
...

## Criteria
| ID | Status | Evidence (file:line, test, command) | Gap |
| --- | --- | --- | --- |
| M01-AC1 | | | |
...

## Unverified items and how to verify them
## Regressions since last audit
## Recommended next three tasks
```

---

## 10. Task 0: Framework and AWS groundwork (do this first)

**Why:** these pieces were designed and tested on 2026-10-05 against a copy of main (commit from 2026-08-13). They were not committed, so you make them now. Apply each change exactly, then run the checks at the end. Do not deploy. Do not push. Commit when all checks pass, with the message "Task 0: framework and AWS groundwork".

Results from the original test run, for comparison: typecheck clean; `npm run build` clean (standalone output contained `chat_system_prompt.md` and `pdfjs-dist/standard_fonts`); every existing `scripts/test_*.ts` suite passed; the new timeout test passed 4 of 4; `/api/health` returned 503 with missing env names when env was empty, 200 when set, and 503 with `"database":"timeout"` when the database was unreachable.

### T0-1. Standalone build output (`next.config.ts`)

Add `output: 'standalone'` and keep the existing settings. The full file should read:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // AWS readiness (2026-10-05): emit a self-contained server bundle in
  // .next/standalone so the app runs in a small container with `node server.js`
  // and no full node_modules install. See Dockerfile and infra/aws/README.md.
  output: 'standalone',
  // Document intake libs ship native/wasm payloads (@napi-rs/canvas via
  // pdf-to-img, pdfjs worker assets) - keep them external so the server
  // bundle doesn't try to repack them.
  serverExternalPackages: ['pdfjs-dist', 'pdf-to-img', 'heic-convert'],
  // Document uploads cap at 25MB (enforced in the route); the proxy's
  // default 10MB body buffer would truncate larger multipart bodies
  // before the route ever sees them.
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
};

export default nextConfig;
```

### T0-2. Model-call timeout (`lib/callModel.ts`)

Wrap the OpenRouter call so one timer covers the request AND reading the body. A hung provider fails loud with "timed out after Nms"; HTTP errors still fail loud with their status. Apply this change:

```diff
@@ -37,28 +37,48 @@ export async function callModel(opts: {
         ]
       : opts.prompt;
 
-  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
-    method: 'POST',
-    headers: {
-      Authorization: `Bearer ${apiKey}`,
-      'Content-Type': 'application/json',
-    },
-    body: JSON.stringify({
-      model: spec.slug,
-      messages: [
-        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
-        { role: 'user', content: userContent },
-      ],
-      max_tokens: opts.maxTokens ?? spec.maxTokens,
-      provider: { sort: 'price', max_price: spec.maxPrice },
-    }),
-  });
+  // Every network call gets a hard timeout (AGENTS.md standing rule). A hung
+  // provider must fail loud, not hold a request open. Override with
+  // MODEL_TIMEOUT_MS; default 60s covers long document-extraction calls.
+  const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS) > 0 ? Number(process.env.MODEL_TIMEOUT_MS) : 60_000;
+  const controller = new AbortController();
+  const timer = setTimeout(() => controller.abort(), timeoutMs);
 
-  if (!res.ok) {
-    const body = await res.text();
-    throw new Error(`OpenRouter ${opts.tier} call failed (${res.status}): ${body}`);
+  // The timer covers the whole exchange: connecting AND reading the body.
+  let json: any;
+  try {
+    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
+      signal: controller.signal,
+      method: 'POST',
+      headers: {
+        Authorization: `Bearer ${apiKey}`,
+        'Content-Type': 'application/json',
+      },
+      body: JSON.stringify({
+        model: spec.slug,
+        messages: [
+          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
+          { role: 'user', content: userContent },
+        ],
+        max_tokens: opts.maxTokens ?? spec.maxTokens,
+        provider: { sort: 'price', max_price: spec.maxPrice },
+      }),
+    });
+
+    if (!res.ok) {
+      const body = await res.text();
+      throw new Error(`OpenRouter ${opts.tier} call failed (${res.status}): ${body}`);
+    }
+    json = await res.json();
+  } catch (err) {
+    if (controller.signal.aborted) {
+      throw new Error(`OpenRouter ${opts.tier} call timed out after ${timeoutMs}ms`);
+    }
+    throw err;
+  } finally {
+    clearTimeout(timer);
   }
-  const json = await res.json();
+
   const text = json?.choices?.[0]?.message?.content;
   if (typeof text !== 'string' || text.length === 0) {
     throw new Error(`OpenRouter ${opts.tier} returned no content`);
```

### T0-3. Environment contract (new file `lib/env.ts`)

```ts
// Environment contract (AWS readiness, 2026-10-05).
//
// One list of every variable the app reads, so a deploy can be checked
// before it serves traffic. Values are NEVER returned or logged; callers
// only learn which names are missing.
//
// NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time,
// so they must be present when the container image is built (Dockerfile
// build args), not only at runtime.

export type EnvScope = 'server' | 'public';

export interface EnvVar {
  name: string;
  scope: EnvScope;
  required: boolean;
  purpose: string;
}

export const ENV_VARS: EnvVar[] = [
  { name: 'SUPABASE_URL', scope: 'server', required: true, purpose: 'Supabase API URL for the server-side admin client' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', scope: 'server', required: true, purpose: 'Service-role key (bypasses RLS); server only' },
  { name: 'IDENTITY_ENCRYPTION_KEY', scope: 'server', required: true, purpose: 'pgcrypto passphrase for user_identity columns' },
  { name: 'OPENROUTER_API_KEY', scope: 'server', required: true, purpose: 'Model calls (to be replaced by a BAA-covered provider before patient data)' },
  { name: 'NEXT_PUBLIC_SUPABASE_URL', scope: 'public', required: true, purpose: 'Supabase URL for browser and session proxy' },
  { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', scope: 'public', required: true, purpose: 'Publishable (anon) key for browser and session proxy' },
  { name: 'MODEL_TIMEOUT_MS', scope: 'server', required: false, purpose: 'Model call timeout in ms (default 60000)' },
  { name: 'APP_VERSION', scope: 'server', required: false, purpose: 'Git SHA or release tag reported by /api/health' },
];

export function missingEnv(): string[] {
  return ENV_VARS.filter((v) => v.required && !process.env[v.name]).map((v) => v.name);
}
```

### T0-4. Health endpoint (new file `app/api/health/route.ts`)

```ts
// Health check for load balancers and container orchestrators
// (AWS readiness, 2026-10-05).
//
// GET /api/health        -> process is up and required env names are set
// GET /api/health?db=1   -> also pings the database (5s timeout)
//
// Unauthenticated by design, so it reveals nothing sensitive: no values,
// no row counts, no error text from the database. Missing env vars are
// reported by NAME only so an operator can fix a bad deploy. /api/* is
// already excluded from anonymous-session creation in proxy.ts.

import { NextRequest, NextResponse } from 'next/server';
import { missingEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 5_000;

async function pingDatabase(): Promise<'ok' | 'error' | 'timeout'> {
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS));
  const query = (async () => {
    try {
      const { error } = await supabaseAdmin().from('drugs').select('id', { head: true, count: 'exact' }).limit(1);
      return error ? 'error' : 'ok';
    } catch {
      return 'error';
    }
  })();
  return Promise.race([query, timeout]);
}

export async function GET(req: NextRequest) {
  const missing = missingEnv();
  const body: Record<string, unknown> = {
    status: missing.length === 0 ? 'ok' : 'degraded',
    version: process.env.APP_VERSION ?? 'unknown',
    time: new Date().toISOString(),
    missingEnv: missing,
  };

  if (req.nextUrl.searchParams.get('db') === '1') {
    const db = missing.includes('SUPABASE_URL') || missing.includes('SUPABASE_SERVICE_ROLE_KEY') ? 'skipped' : await pingDatabase();
    body.database = db;
    if (db !== 'ok') body.status = 'degraded';
  }

  return NextResponse.json(body, { status: body.status === 'ok' ? 200 : 503 });
}
```

### T0-5. Container (new files `Dockerfile`, `.dockerignore`, `docker-compose.yml`)

`Dockerfile`:

```dockerfile
# Arik Health app container (AWS readiness, 2026-10-05).
#
# Multi-stage build of the Next.js standalone server. Debian slim (glibc)
# rather than Alpine because pdf-to-img pulls @napi-rs/canvas native
# binaries built for glibc.
#
# NEXT_PUBLIC_* values are baked into the browser bundle at build time,
# so pass them as build args:
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
#     --build-arg APP_VERSION=$(git rev-parse --short HEAD) \
#     -t arik-app .
# Server secrets (SUPABASE_SERVICE_ROLE_KEY, IDENTITY_ENCRYPTION_KEY,
# OPENROUTER_API_KEY, ...) are passed at RUNTIME only, never baked in.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ARG APP_VERSION=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=$APP_VERSION
RUN groupadd --system --gid 1001 arik && useradd --system --uid 1001 --gid arik arik
COPY --from=build --chown=arik:arik /app/.next/standalone ./
COPY --from=build --chown=arik:arik /app/.next/static ./.next/static
# The chat route reads the system prompt from disk at runtime.
COPY --from=build --chown=arik:arik /app/chat_system_prompt.md ./chat_system_prompt.md
USER arik
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

`.dockerignore`:

```text
node_modules
.next
.git
.env
.env*.local
.vercel
.firecrawl
dev-server.log
tsconfig.tsbuildinfo
Dockerfile
docker-compose.yml
infra
```

`docker-compose.yml`:

```yaml
# Local run of the Arik app container (AWS readiness, 2026-10-05).
#
# The database is NOT in this file. Locally, run the Supabase stack with
# the Supabase CLI (`supabase start`) and point .env.local at it. On AWS,
# Supabase runs self-hosted beside the app (see infra/aws/README.md).
#
#   docker compose --env-file .env.local up --build
#
# From inside the container, a Supabase stack on the host machine is at
# host.docker.internal, not localhost.

services:
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
        APP_VERSION: ${APP_VERSION:-local}
    ports:
      - "3000:3000"
    environment:
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      IDENTITY_ENCRYPTION_KEY: ${IDENTITY_ENCRYPTION_KEY}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      MODEL_TIMEOUT_MS: ${MODEL_TIMEOUT_MS:-60000}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
```

### T0-6. Environment template (replace `.env.example`)

```bash
# Full list and purpose of every variable: lib/env.ts (ENV_VARS).
# Check a running deploy with GET /api/health (reports missing NAMES only).

# Server-only (never expose to the browser)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Application-layer key for pgcrypto encryption of user_identity columns.
# Generate a long random passphrase; losing it makes identity data unrecoverable.
IDENTITY_ENCRYPTION_KEY=
# OpenRouter direct model routing (lib/modelConfig.ts - two tiers, :floor
# slugs, max_price caps; calls fail loud rather than silently upgrading).
# Must be replaced by a BAA-covered provider before real patient data.
OPENROUTER_API_KEY=
# Optional: model call timeout in ms (default 60000).
MODEL_TIMEOUT_MS=
# Optional: git SHA or release tag reported by /api/health.
APP_VERSION=

# Browser-safe. Inlined into the client bundle at BUILD time, so they
# must also be passed as Docker build args (see Dockerfile).
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

### T0-7. Timeout test (new file `scripts/test_callmodel_timeout.ts`)

```ts
// Model-call timeout test (AWS readiness, 2026-10-05).
// Run: npx tsx scripts/test_callmodel_timeout.ts
//
// Proves lib/callModel.ts aborts a hung provider instead of waiting forever
// (AGENTS.md standing rule: every network call gets a real timeout). No
// network is used: global fetch is replaced with a stub.

import { callModel } from '../lib/callModel';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

async function main() {
  process.env.OPENROUTER_API_KEY = 'test-key';
  const realFetch = globalThis.fetch;

  // 1. A provider that never answers is aborted after MODEL_TIMEOUT_MS.
  process.env.MODEL_TIMEOUT_MS = '50';
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  const started = Date.now();
  try {
    await callModel({ tier: 'extraction', prompt: 'hi' });
    check('hung provider times out', false, 'resolved unexpectedly');
  } catch (err) {
    const ms = Date.now() - started;
    check('hung provider times out', /timed out after 50ms/.test(String(err)), String(err));
    check('timeout fires promptly', ms < 2000, `took ${ms}ms`);
  }

  // 2. A normal response still works and is not affected by the timer.
  process.env.MODEL_TIMEOUT_MS = '5000';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ model: 'stub', choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200 })) as typeof fetch;
  const text = await callModel({ tier: 'extraction', prompt: 'hi' });
  check('normal response passes through', text === 'ok', text);

  // 3. HTTP errors still fail loud (not reported as a timeout).
  globalThis.fetch = (async () => new Response('nope', { status: 402 })) as typeof fetch;
  try {
    await callModel({ tier: 'extraction', prompt: 'hi' });
    check('http error fails loud', false, 'resolved unexpectedly');
  } catch (err) {
    check('http error fails loud', /failed \(402\)/.test(String(err)) && !/timed out/.test(String(err)), String(err));
  }

  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

### T0-8. Docs and folders

1. Create `infra/aws/README.md` with the content of Appendix A (drop the "Appendix A" heading; make its first heading a level-1 title).
2. Create `docs/status/README.md`: one paragraph saying completeness audits go here, one file per audit named AUDIT_YYYY-MM-DD with the .md extension, using the template in section 9 of this file.
3. In `HANDOFF.md`, right under the title, add a short "Update 2026-10-05" note: this file is now the top-level spec and should be read first; stage build prompts are its Appendix B; audits go in `docs/status/`; the AWS plan is in `infra/aws/`; the "Not a runnable app" section is out of date because the Next.js app exists and builds as a standalone container. Also name this file and the two older root docs that currently trigger validator warnings (`Arik_Accumulator_Ban_and_Program_Terms_Research` and `Arik_Health_Drug_Bundle_Build_Ticket`, each with the .md extension) as background reading.
   **Validator trap:** do NOT write the evidence verification ticket's full filename in HANDOFF.md. Its hyphenated name makes `scripts/validate_repo.py` read it as a reference to a file called `ticket` plus .md, which does not exist, and the validator fails. Leave that one warning.
4. In `AGENTS.md`, above "Gate before any application code", add a "Master spec (2026-10-05)" section: this file defines every module, acceptance criterion and stage gate; build prompts are Appendix B, run in order (B2 and B3 can run in parallel after B1); audits go in `docs/status/`.

### T0-9. Checks (all must pass)

```bash
python3 scripts/validate_repo.py          # 0 failures
npx tsc --noEmit                          # clean
npm run build                             # clean; .next/standalone exists
ls .next/standalone/chat_system_prompt.md .next/standalone/node_modules/pdfjs-dist/standard_fonts
for t in scripts/test_*.ts; do npx tsx "$t" || echo "FAILED: $t"; done
# Standalone server smoke test (copy static assets the way the Dockerfile does):
cp -r .next/static .next/standalone/.next/static
PORT=3100 node .next/standalone/server.js &   # stop it afterwards with: kill %1
curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/api/health   # 503 with empty env, 200 with env set
docker compose --env-file .env.local up --build   # needs Docker; health check must turn healthy
```

Report the output of each command. If Docker is not available, say so and mark M20-AC1/AC2 UNVERIFIED rather than DONE.

---

## Appendix A: Arik on AWS (content for infra/aws/README.md)

**Status:** plan. Nothing here is created yet. No real patient data until every item in the readiness checklist is checked.

#### Why this shape

- One small server running everything in Docker keeps cost near $60 to $150/month at pilot scale.
- AWS signs a Business Associate Addendum (BAA) through AWS Artifact at no extra cost, which covers HIPAA-eligible services (EC2, EBS, S3, Bedrock, SSM, CloudWatch, among others; confirm the current eligible list before use).
- Self-hosting Supabase avoids the hosted plan's BAA price while keeping the same schema, RLS, auth and storage the app already uses.

#### Target architecture (Stage 2 hosting)

```
Internet ── 443 ──> EC2 (Ubuntu LTS, encrypted EBS)
                     ├─ Caddy (TLS, reverse proxy)
                     ├─ arik-app (this repo's Dockerfile, port 3000, internal)
                     └─ Supabase self-hosted (Postgres, Auth, REST, Storage, Studio)
                          Postgres + Studio bound to localhost only
                     │
                     ├─> S3 (nightly encrypted backups, uploads archive if needed)
                     ├─> SSM Parameter Store (all secrets)
                     ├─> CloudWatch (logs, health alarms)
                     └─> Amazon Bedrock (Claude, under the AWS BAA)
                          or Anthropic API under its own BAA
```

- Admin access through AWS Systems Manager Session Manager. No public SSH.
- Security group: inbound 80/443 only.
- Instance size: start around 4 GB RAM (Supabase's container set needs headroom); resize later.

#### Environments

| Env | Database | AI provider | Real patient data |
| --- | --- | --- | --- |
| Local | `supabase start` | OpenRouter | Never |
| Staging (optional) | Self-hosted on a small EC2 | OpenRouter or Bedrock | Never |
| Production | Self-hosted on EC2 under the BAA | Bedrock or Anthropic with BAA | Only after the checklist |

#### Runbook (first deploy)

1. Accept the AWS BAA in AWS Artifact. Turn on MFA for the root user; create an admin IAM user or SSO.
2. Create the EC2 instance with encrypted EBS, an IAM role allowing SSM, S3 (backup bucket only) and Bedrock invoke.
3. Create the S3 backup bucket: block public access, default encryption, versioning, lifecycle rule.
4. Put every secret from `lib/env.ts` in SSM Parameter Store as SecureString.
5. On the instance: install Docker, clone the repo, run `infra/aws/scripts/load_secrets.sh`.
6. Build the app image with the `NEXT_PUBLIC_*` build args, or pull the CI image.
7. `docker compose -f infra/aws/docker-compose.prod.yml up -d`.
8. Apply the database: schema, migrations, seeds (the `db:reset` flow from Appendix B1, pointed at the server).
9. Point DNS at the instance; Caddy issues the certificate.
10. `curl https://<domain>/api/health?db=1` returns 200.
11. Install the backup cron; run one backup and one restore into a scratch database.
12. CloudWatch alarm on the health check and on instance status.

#### Readiness checklist (all must be true before real patient data)

- [ ] AWS BAA accepted
- [ ] AI provider for patient data is covered by a BAA (Bedrock under AWS, or Anthropic direct); OpenRouter disabled in production
- [ ] Every API route session-guarded with ownership tests (spec M01)
- [ ] Postgres and Studio not reachable from the internet
- [ ] Secrets only in SSM; none in the image, repo or logs
- [ ] Encrypted EBS and encrypted S3 backups; restore tested
- [ ] Upload malware scanner configured (uploads fail closed without it)
- [ ] Raw upload purge job scheduled and verified
- [ ] Logs proven free of PHI, prices and secrets
- [ ] Privacy policy, terms, Washington health data consent and the not-legal-advice notice live and recorded
- [ ] Breach response plan written
- [ ] Mail/fax vendor (if used) under a BAA

#### Cost notes (estimates, verify before buying)

- EC2 instance plus EBS: the largest line item.
- S3 backups: small at pilot scale.
- Bedrock: pay per token, similar to direct API pricing; confirm current Claude model availability in the chosen region.
- AWS Activate credits can offset early months; decision pending.

---

# Appendix B: Stage build prompts

Run in order. Each prompt has a STOP point; stop there, report, and wait for Ryan.

## Appendix B1: Local setup and auth guards (Stage S1)

**Owner:** Ryan Russell
**Spec:** this file, modules M01, M02, M04, M05, M17, M20, M22
**Goal:** Arik runs entirely on this machine against a local Supabase stack, every API route is guarded, and the S1 gate can be audited.

Work locally. Do not deploy. Do not push. Never print secret values. Cite `file:line` in every report.

Do this in **two parts**. STOP after Part A, report, and wait for the go-ahead.

---

#### PART A: Local stack

1. **Supabase CLI local stack.** `supabase init` if `supabase/config.toml` is missing (a `supabase/functions` folder already exists; keep it). Enable anonymous sign-ins in config. `supabase start`.
2. **One command database build (M02-AC1).** Add `npm run db:reset` that applies `schema.sql`, then every `db/0*.sql` in order (follow the apply order in AGENTS.md), then seeds. Connection string comes from env only (M02-AC3); remove any hardcoded remote project host from scripts and list each one you changed.
3. **Check script (M02-AC2).** `npm run db:check` prints table count, row counts for seeded tables, and RLS enabled per table. Expected table count: whatever schema plus migrations produce; report it.
4. **Env.** Copy `.env.example` to `.env.local` with the local stack values. `lib/env.ts` is the list of every variable; if you add one, add it there and to `.env.example`.
5. **Smoke (M02-AC4, M22-AC4).** Run `smoke_rls.mjs` and `smoke_anonymous_flow.mjs` against the local stack.
6. **Single test command (M22-AC1).** `npm test` runs every pure suite in `scripts/test_*.ts`.
7. **Ranking eval (M05-AC2).** Run `scripts/eval_ranking.ts` against the local database. Report each of the 12 cases.
8. **Container (M20-AC1/2).** `docker compose up --build` with the app pointed at the local stack (`host.docker.internal`). `curl localhost:3000/api/health?db=1` must return 200.

Report: exact command output for each step, and anything that failed. **STOP.**

---

#### PART B: Auth guards (M01, M17-AC1)

1. Add one helper (for example `lib/requireSession.ts`) that returns the session user or a 401 response. Use the server Supabase client already used by `proxy.ts`.
2. Apply it to every route under `app/api/` except `/api/health` and the service-key purge job. Remove every `AUTH NOTE` comment (currently: cases, cases/[id], cases/[id]/deadlines, identity, managed-patients, outcomes, privacy). Grep for any other unguarded route and list it.
3. Ownership: every row read or write checks the session user owns it, or holds an active `authorizations_on_file` row for the managed patient. Never trust a user id from query string or body (M01-AC3).
4. Tests per route: no session returns 401; another user's resource returns 403 or 404; the owner succeeds.
5. Timeout audit (M01-AC5): list every outbound `fetch` in the repo and whether it has a timeout. Add one where missing.
6. Response tier and cost (M04-AC3/4): add prompt caching on the system prompt and log input, cached and output tokens per turn. Do NOT switch the response model yet; report the eval baseline so Ryan can decide.
7. Tag the repo `pre-partner-baseline` locally (M07-AC7). Do not push the tag.

#### Final report

Use the audit template in section 9 of this file, scoped to the S1 criteria. Never mark DONE without evidence.

---

## Appendix B2: Pricing pipeline and partner readiness (Stage S2)

**Owner:** Ryan Russell
**Spec:** this file, modules M05, M06, M07, and section 2.1 (partner data policy)
**Run after:** B1 Parts A and B.
**Goal:** prices arrive through source adapters instead of hand entry, and any pricing partner can be plugged in with a small adapter plus a config entry.

Work locally. Do not deploy. Do not push. Never print secret values. Cite `file:line`.

**Confidentiality:** a pricing partner is under NDA. Never write any company name, terms, endpoints or prices from a real partner into code, fixtures, commits or logs. Everything in this build uses a mock partner.

Two parts. STOP after Part A.

---

#### PART A: Pipeline + NADAC

##### A1. Schema (new migration after the latest `db/` file, RLS on everything)

- `price_sources`: key, display name, kind (`benchmark` | `cash` | `discount_card` | `manufacturer` | `direct` | `partner`), mode (`bulk` | `quote`), `enabled`, `max_staleness_hours`, `retention_days`, `allow_patient_display` (default false), `allow_ai_processing` (default false), linked `sources` row for citation.
- `pharmacies`: NPI, NCPDP, name, address, zip, lat/lng, chain.
- On `price_points`: `price_source_id`, `pharmacy_id` (nullable), `observed_at`, `expires_at`, `ndc11`.
- `ingest_runs`: source, started, finished, status, rows read/inserted/updated/rejected, error summary (no price values).

Explain how you reused `sources` and `price_points` rather than duplicating them.

##### A2. Adapter interface (`lib/pricing/`)

- `PriceAdapter` with `fetchBulk()` (async iterator) and `quote(ndc, qty, zip)`.
- Records validated at the boundary (zod or the repo's validator); invalid records are counted and rejected, never coerced.
- NDC 10-to-11 normalization (4-4-2, 5-3-2, 5-4-1 forms) with tests. Unmatched NDCs flagged, never guessed.

##### A3. NADAC adapter

- Bulk adapter for the CMS NADAC dataset. Fixture-based tests only (no network in tests).
- NADAC rows are `kind = benchmark`: shown as "what pharmacies pay", never as a patient price.

##### A4. Runner and enforcement

- `npm run ingest -- <source>`: idempotent, writes one `ingest_runs` row, respects `enabled`.
- Retention purge per source (M06-AC7).
- Ranking (`lib/ranking.ts`) reads all enabled sources identically, excludes rows past `max_staleness_hours`, and returns which rows were excluded and why.
- Tests: `allow_patient_display = false` rows never reach patient-facing output; `allow_ai_processing = false` rows never appear in a model prompt (M06-AC8).
- Duplicate discount cards sharing a processor (BIN/PCN) collapse into one option (M05-AC6).

Run all suites. Report. **STOP.**

---

#### PART B: Partner readiness (mock only)

1. **HTTP client** (`lib/pricing/http.ts`): per-request timeout, retry on 5xx with exponential backoff and jitter, honors 429 + `Retry-After`, circuit breaker. Tests for each.
2. **Config-driven adapter template:** auth by API key, bearer token or OAuth client credentials; pagination by page, offset or cursor; field mapping in config. Credentials only from env vars named in config; startup fails fast if an enabled source is missing one (M07-AC6).
3. **Mock partner API** (`scripts/mock_partner_api.ts`, local only) with scenarios: valid, paginated, 401, 429, 500, timeout, malformed JSON, stale prices, unknown NDC.
4. **Quote mode in chat:** short-lived cache; if the partner fails or times out, chat answers with the other sources and says one source was unavailable (M07-AC4).
5. **Kill switch and purge:** `npm run source:disable -- <key>` and `npm run source:purge -- <key>`, each writing an audit row (M07-AC5).
6. **No-leak test:** logs and error messages never contain prices, credentials or full request bodies.
7. **`docs/partner_onboarding_checklist` (Markdown file):** what Ryan needs from any partner (API docs, sandbox key, rate limits, data use terms covering display, caching, retention and AI processing, BAA if any PHI flows) and the steps to add an adapter.

#### Final report

Audit template from section 9 of this file, scoped to S2 criteria, with exact test output.

---

## Appendix B3: Bill review phase 1 (Stage S3)

**Owner:** Ryan Russell
**Spec:** this file, modules M09, M10, M12, M18-AC1
**Run after:** B1. Can run in parallel with B2. Shares the letter engine and notices with B4 (denial engine); whichever runs first builds them, the other reuses them.
**Goal:** a patient uploads a hospital or provider bill, confirms the line items, and gets rule-based findings plus letters.

Work locally. Do not deploy. Do not push. Uploads only. Nothing is sent on the patient's behalf. Cite `file:line`.

Two parts. STOP after Part A.

---

#### Ground rules

- **The rules decide; the AI does not.** Models extract and word things. Every finding comes from a deterministic check with a cited rule.
- **No CPT descriptors** while `CPT_DISPLAY_ENABLED=false` (create the flag if missing). Code numbers only (M10-AC6).
- **Reuse first:** `bill_audit_findings`, `uploaded_documents`, `pending_fact_corrections`, `output_documents`, `deadlines`, `hospital_financial_assistance_policies`. Report how each was used.
- No real PHI in fixtures.

---

#### PART A: Data + checks (no AI)

1. **Line item schema** (migration): bill header (provider, facility, NPI if present, statement date, admit/discharge dates, totals, bill type `summary` | `itemized`) and line items (date of service, revenue code, code number, units, charge, description as printed). RLS.
2. **Checks** (`lib/rules/bills/`), each returning a finding with its citation or nothing:
   - duplicate line (same code, date, units, charge)
   - service date outside the admission window
   - room-and-board days greater than nights between admit and discharge
   - units exceeding the Medicare medically unlikely edit (after step 3)
   - procedure pairs flagged by NCCI procedure-to-procedure edits (after step 3)
3. **NCCI importer:** loads the CMS NCCI PTP and MUE files from a local download path; records the file version and quarter on every finding (M10-AC2). Fixture subset for tests.
4. **Medicare Physician Fee Schedule importer:** context only, shown as "what Medicare pays," never as "what you owe" (M10-AC3).
5. Unit tests for every check, including edge cases (same-day admit and discharge, midnight crossings, leap years).

Report. **STOP.**

---

#### PART B: Reader, letters, notices

1. **Intake:** document types summary bill and itemized bill (extend `lib/documentIntake.ts`). Size and type limits. Scanner interface `scanFile` with a pluggable implementation; in production with no scanner, uploads fail closed (M09-AC2).
2. **Bill reader:** Haiku tier extraction into the schema, validated at the boundary; invalid output rejected (M09-AC3). Patient confirms line items through `pending_fact_corrections`; no check runs on unconfirmed data, with a test (M09-AC4).
3. **Letter engine** (if B4 has not built it): plain text to PDF through `output_documents`; generating a letter creates matching `deadlines` rows.
4. **Letters:**
   - Itemized bill request (always available, including free tier; M10-AC4)
   - Billing error dispute (fills only from confirmed findings)
   - Charity care / financial assistance application cover letter (uses `hospital_financial_assistance_policies`)
   - No Surprises Act dispute: mark the rule values UNVERIFIED unless a citation is given to you; do not invent thresholds or deadlines
5. **Letter test (M12-AC2):** no number, date, code, name or deadline appears unless it is in the confirmed record or a rule.
6. **Footer (M12-AC3), exactly:** "Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice."
7. **Onboarding notice (M18-AC1):** if not built yet, show the full not-legal-advice text from Appendix B4, Part B, step B4 and record acceptance in `consent_ledger` under `legal_notice`.

#### Final report

Audit template from section 9 of this file, scoped to the criteria above, with exact test output and every UNVERIFIED item.

---

## Appendix B4: Denial engine v1 (Stage S3)

**Owner:** Ryan Russell
**Date:** 2026-10-05
**Run after:** Appendix B1, and Appendix B2 Part A
**Spec:** this file, modules M03, M09, M11, M12, M18-AC1. Background: the design doc "Arik: Chart Integration and Denial Engine Design"

Build Arik's denial engine v1: a deterministic rules engine, a denial reader for uploaded documents, and appeal letters. Uploads only: no connections to EHRs, payers, Flexpa or any outside API. Work locally (local Supabase stack). Do not deploy. Do not push.

Do this in **two parts**. STOP after Part A, report, and wait for the go-ahead.

---

#### Prerequisites (check first, stop if missing)

- Local Supabase stack running, all migrations applied.
- Auth guards on every previously open API route are merged (M01-AC1 to AC4 in this file).
- Model-call timeout in `lib/callModel.ts` is in place.

If any is missing, stop and report which.

---

#### Ground rules

- **Never guess.** Cite file:line in your report. Mark anything unverified as UNVERIFIED.
- **The rules engine decides; the AI does not.** The AI only extracts, classifies and polishes wording. No AI output may set a flag, a deadline or an eligibility decision.
- **Every rule carries a citation** (URL + the rule it encodes). Use ONLY the rule values listed in this file. If a rule you need is not listed, do not invent it: leave it unimplemented and list it in the report.
- **Never copy X12 code descriptions** anywhere (code, seeds, fixtures, UI). Store code numbers only. Arik writes its own explanations later.
- **Reuse existing tables before creating new ones.** Read the schema first and report how you used each of: `denial_appeals`, `deadlines`, `output_documents`, `uploaded_documents`, `pending_fact_corrections`, `case_outcomes`, `exception_precedents`, `sources`, `evidence_conflicts`, `consent_ledger`, `authorizations_on_file`, `employer_plans`.
- **CPT descriptors stay hidden** behind `CPT_DISPLAY_ENABLED=false` (create the flag if it does not exist). Code numbers only.
- **No actions on the patient's behalf in this build.** Nothing is submitted, mailed, faxed, emailed or filled into a third-party site. Letters are generated for download only. The action framework is a separate, later build.
- Small commits with clear messages. No secrets in code, logs or fixtures.

---

### PART A: Schema + rules engine (no AI)

#### A1. Schema

New migration after the latest `db/` file. RLS on every new table, matching existing patterns.

- **`denials`**: `case_id`, `document_id`, `payer_name`, `plan_funding` (`fully_insured` | `self_funded` | `medicare_part_d` | `medicare_advantage` | `medicaid` | `marketplace` | `unknown`), `denial_category` (`no_reason_given` | `administrative` | `excluded_service` | `no_prior_authorization` | `medical_necessity` | `other`), `carc_codes text[]`, `rarc_codes text[]`, `service_or_drug`, `notice_date`, `date_of_service`, `is_prior_auth_decision`, `is_urgent`, `status`, `confirmed_at`
- **`denial_codes`**: `code_set` (`CARC` | `RARC`), `code`, `arik_explanation` (nullable), `explanation_status` (`needs_review` | `approved`), `x12_url`. Seed NO explanations; status `needs_review`; `x12_url` = `https://x12.org/codes`
- **`plan_funding`** on cases (or reuse `employer_plans` if it fits; explain the choice)
- **`rules`**: `rule_id`, `version`, `plan_funding`, `description`, `citation_url`, `effective_from`, `effective_to`, `active`
- **`appeal_outcomes`**: `denial_id`, `appeal_level`, `argument_types text[]`, `submitted_at`, `decided_at`, `result` (`won` | `partial` | `lost` | `pending` | `withdrawn`), `notes`
- Reuse **`deadlines`** for every computed deadline (link to `denial_id`)

#### A2. Rules engine (`lib/rules/`)

Pure, deterministic, versioned functions. One unit test per rule, including date edge cases (month ends, leap years). Days are calendar days unless a rule says otherwise. Encode exactly these rules:

##### Fully insured, marketplace and employer plans

Sources: https://www.healthcare.gov/appeal-insurance-company-decision/internal-appeals/ and https://www.healthcare.gov/appeal-insurance-company-decision/external-review/

- Internal appeal: patient has **180 days** from receipt of the denial notice
- Insurer decision on internal appeal: **30 days** for care not yet received, **60 days** for care already received, **72 hours** if urgent
- External review: patient files within **4 months** of the final internal denial
- External review decision: **45 days** standard, **72 hours** expedited

##### Self-funded plans (ERISA, federal external review)

Source: https://ogletree.com/insights-resources/blog-posts/internal-claims-and-appeals-and-external-review-under-ppaca/

- Internal appeal: **180 days** from the denial notice
- Federal external review: file within **4 months**; decision within **45 days**
- First recommended action: request the claim file and plan documents (free of charge, on request)

##### Medicare Part D

Source: https://www.medicare.gov/providers-services/claims-appeals-complaints/appeals/drug-plans

- Level 1 redetermination: **65 days** from the denial notice; decision **7 days** (benefit) or **14 days** (payment), **72 hours** expedited
- Level 2 Independent Review Entity: **60 days** from the Level 1 decision; same decision times
- Levels 3 to 5: **60 days** each; mark dollar thresholds as UNVERIFIED (do not hardcode 2024 amounts)

##### Prior authorization decisions (impacted payers)

Applies to Medicare Advantage, Medicaid, CHIP and federal marketplace QHPs; medical items and services only, **not drugs**; effective **2026-01-01**.

Source: https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-prior-authorization-final-rule-cms-0057-f

- Specific denial reason required
- Decision within **72 hours** expedited, **7 calendar days** standard

##### Not implemented (list in report, do not invent)

Medicare Advantage appeal deadlines, Medicaid appeal deadlines, state-specific rules.

#### A3. Check functions

Each returns a flag with its citation, or nothing.

- **`missing_specific_reason`**: `denial_category = no_reason_given`, or an impacted-payer prior auth denial with no specific reason
- **`insurer_late`**: insurer decision date exceeds the applicable rule
- **`patient_deadline`**: compute the patient's next deadline and days remaining; status `ok` | `due_soon` (14 days or fewer) | `overdue`
- **`prior_auth_on_file`**: an approved authorization for the same service and dates exists in the case (case data only)
- **`administrative_denial`**: category `administrative` -> recommend asking the provider for a corrected claim
- **`self_funded_track`**: `plan_funding = self_funded` -> claim-file request first
- **`no_error_found`**: none of the above -> route to exceptions and other ways to pay (existing ranking engine)

#### A4. Part A tests + report

All rule and check tests, plus all existing suites. Report the exact output.

**STOP HERE and wait.**

---

### PART B: Denial reader, letters, notices (run when told to go)

#### B1. Upload safety

- Extend document intake to accept: denial letter, EOB, prior auth decision, plan summary.
- Enforce file type and size limits.
- Add a scanner interface (`scanFile`) with a pluggable implementation. In production mode with no scanner configured, uploads fail closed. Add a clear TODO and report the gap honestly.

#### B2. Denial reader

- Haiku extraction (existing tier in `lib/modelConfig.ts`) into the `denials` schema, validated at the boundary (zod or the repo's validator). Invalid output is rejected, never coerced.
- Codes: extract CARC/RARC **numbers only**.
- Patient confirmation via `pending_fact_corrections`. No check in A3 runs on unconfirmed fields. Test this gate.
- Intake question when `plan_funding` is unknown: "Who pays your claims?" with plain options and an "I don't know" path that tells the patient to ask HR or check the plan summary.

#### B3. Letters

Plain text -> PDF, reusing `output_documents`. Templates:

1. Claim-file and plan-document request (self-funded)
2. Demand for the specific denial reason
3. Internal appeal
4. External review request
5. Part D redetermination
6. Part D exception request (formulary or tier)

Rules:

- Letters fill ONLY from confirmed denial data, check results and rule citations. AI may smooth wording.
- A test must prove no number, date, code, name or deadline appears in a letter unless it is in the confirmed record or a rule.
- Medical necessity: the letter asks the treating doctor for a supporting letter. Arik never writes clinical judgment.
- Every letter ends with exactly:

  > Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.

- Generating a letter creates the matching `deadlines` rows.
- Download only. Nothing is sent by Arik in this build.

#### B4. Notices and chat scope

- **Onboarding:** show this exact text and record acceptance in `consent_ledger` (new category `legal_notice`):

  > Arik Health is not a law firm and does not give legal advice. Arik helps you understand your bills, your coverage and your appeal rights, and drafts letters for you to review, change and send yourself. Using Arik does not create an attorney-client relationship. Arik does not give medical advice; decisions about your care belong to you and your doctor. For legal advice about your situation, contact a licensed attorney or your state's health insurance consumer assistance program.

- **Legal questions in chat:** extend the on-topic check (the scope boundary in `app/api/chat/route.ts`) to detect legal-advice requests (suing, legal rights in a specific case). The response says Arik cannot give legal advice, points to a lawyer or the state consumer assistance program, then keeps helping with what it can. Test it.
- **Clinical scope rule:** update the system prompt from "never clinical" to: Arik may read clinical records only as evidence about coverage and billing, and never gives medical advice. Add tests proving it still refuses medical questions.

#### B5. Test harness

`scripts/eval_denials.ts`, modeled on `scripts/eval_ranking.ts`. Ship with synthetic fixtures (no real PHI): one per `denial_category`, plus one self-funded and one Part D. Each fixture states the expected category, flags, deadline and letter type. The harness must be ready for graded cases written by billing experts later.

#### B6. Final report

1. What was built, with file:line evidence
2. Exact test output for all suites, plus `eval_denials` results
3. UNVERIFIED items and rules deliberately not implemented
4. What is needed before real patient denial letters are accepted (scanner, hosting, consent, privacy policy)

---

## Appendix B5: AWS readiness (Stage S4 infrastructure)

**Owner:** Ryan Russell
**Spec:** this file, modules M02-AC5, M04-AC2, M20, M21; `infra/aws/README.md`
**Run after:** B1. Independent of B2 and B3.
**Goal:** everything needed to stand Arik up on AWS exists in the repo and is tested locally. Creating AWS resources is Ryan's call; this build only prepares.

Do not create cloud resources. Do not deploy. Do not push. Never print secret values. Cite `file:line`.

Requires Task 0 (section 10): standalone Next.js output, `Dockerfile`, `docker-compose.yml`, `lib/env.ts`, `GET /api/health`, model-call timeout. Verify each before building on it.

---

#### Tasks

1. **AI provider interface (M04-AC2).** Refactor `lib/callModel.ts` behind a provider interface selected by `AI_PROVIDER` (`openrouter` | `anthropic` | `bedrock`). Keep the two tiers and the timeout. Implement `openrouter` (existing) and `anthropic` (Messages API) fully; `bedrock` may be a stub that fails loud with a clear message. Model ids per provider live in `lib/modelConfig.ts`. Add every new env var to `lib/env.ts` and `.env.example`. Stubbed-fetch tests like `scripts/test_callmodel_timeout.ts`.
2. **Production compose (M20-AC3/4).** `infra/aws/docker-compose.prod.yml`: app image, Caddy reverse proxy with automatic TLS, and the self-hosted Supabase services (from the official Supabase docker setup; pin versions). Only 443/80 published. Postgres and Studio bound to localhost only.
3. **Secrets (M20-AC3).** `infra/aws/scripts/load_secrets.sh` pulls values from AWS SSM Parameter Store into an env file readable only by root; never echoes values.
4. **Backups (M02-AC5, M20-AC6).** `infra/aws/scripts/backup.sh` (pg_dump, gzip, encrypt, upload to S3 with server-side encryption) and `restore.sh`. Test both locally against the local stack using a local S3-compatible target or a file target.
5. **CI (M20-AC7).** GitHub Actions workflow: install, typecheck, `npm test`, `python3 scripts/validate_repo.py`, build the Docker image tagged with the commit sha. No deploy step. No secrets required for CI.
6. **Logging (M21-AC1/2).** Structured JSON logs with a request id; a redaction helper; a test proving logs never contain PHI fields, prices or secrets. Log model cost per turn.
7. **Security headers (M01-AC8).** CSP, HSTS, frame-ancestors, referrer policy, tested.
8. **Readiness check.** `npm run aws:check` prints the readiness checklist from `infra/aws/README.md` with each item's status based on what it can verify locally.

#### Final report

Audit template from section 9 of this file for M20, M21, M04-AC2, M02-AC5, M01-AC8, with exact output.
