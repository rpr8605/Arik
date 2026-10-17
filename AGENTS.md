# AGENTS.md — Arik

Patient-facing healthcare-cost advocate ("anti-GoodRx" for drug pricing +
bill/denial fights). Supabase Postgres brain + thin Next.js frontend.
The repo is now a **spec + early app**: Next.js 16 (App Router, Turbopack)
+ TypeScript strict scaffold exists at repo root, but there is no live
Arik database yet — see "Supabase target project" below.

## Master spec (2026-10-05)

`ARIK_MASTER_SPEC.md` defines every module, acceptance criterion and
stage gate. Stage build prompts are its Appendix B - run in order (B2 and
B3 can run in parallel after B1). Completeness audits go in
`docs/status/`.

## Gate before any application code

1. `python scripts\validate_repo.py` must pass with 0 failures (script
   lives in `scripts/` — it resolves paths relative to its own location,
   so it fails spuriously if moved back to repo root).
2. `npm run build` must stay green (compiles + type-checks all routes).
3. Complete `PRE_BUILD_CHECKLIST.md` and report findings to the user.
   Last full review: 2026-07-24 (passed; findings repaired same day).

## Standing operational rule (2026-08-12 — permanent, not tied to one bug)

Nothing gets more than 3–4 minutes before you stop and report, full stop.
This applies to every category of wait — dev server startup, a fetch/API
call, a database query, a firecrawl scrape, waiting on any external
process.

- Every bash tool call that could plausibly hang (starting a server,
  polling a port, calling an API, running a script that makes network
  calls) gets an explicit timeout parameter on the tool call itself, not
  just internal logic hoping to bound it.
- Every fetch() or network call inside any script you write or run gets
  an AbortController with a real timeout — no exceptions, even in
  "quick" scripts.
- If something hasn't resolved in 3–4 minutes: stop retrying, stop
  waiting, do NOT loop back and try the same thing again silently. Report
  exactly what you tried, what the last known state was, and what you
  think is stuck. Then wait for instruction — don't guess at a workaround
  and keep going.
- A clean "this failed/timed out" report is always better than a hang.
  Three failed attempts logged in 12 minutes beats one silent hang that
  eats 20+ minutes of nothing.

## Supabase target project (READ BEFORE ANY DB WORK)

Arik's project is live: `iwayoxmpbueneagdkpzj` (schema + 002–005 applied
2026-07-24 via direct Postgres; seeded: 15 drugs, 18 price points, 2
sources). **Check which project the MCP session is bound to before ANY
MCP DB call** — the MCP in older sessions still points at the **MsJaneHH
project** (organizations/patients/qa_rules, live data); never run Arik
SQL there. Direct Postgres (scripts below, driven by `.env.local`) is the
safe path until the retargeted MCP is confirmed via `list_tables`.
Apply order on a fresh project: `schema.sql` → `db/002_identity_crypto.sql`
→ `db/003_rls_policies.sql` → `db/004_grants.sql` →
`db/005_can_access_case_security_definer.sql` →
`db/006_conversational_extraction.sql` →
`db/007_language_and_consent_ledger.sql` → `db/008_document_intake.sql`
→ `db/009_data_retention.sql` → `db/010_state_accumulator_ban_laws.sql`
→ `db/011_reduced_if_maximizer_detected.sql`
→ `db/012_counter_override_guidance.sql` → `db/013_eliquis_dtp_tiers.sql`
→ `db/014_case_outcomes_pharmacy.sql` → `db/015_income_pct_fpl.sql` →
`db/016_eligibility_screeners.sql` → `db/017_exploits_evidence_fold.sql`
→ `db/018_bundle_seeds.sql` → `db/019_nv_regulatory_guidance.sql` →
`db/020_conflict_classes.sql` → `db/021_explanation_style_and_support_phone.sql`
→ `db/022_pricing_ingestion.sql` →
`db/023_price_sources_defaults_false.sql` → `db/024_nadac_displayable.sql`
→ `db/025_pharmacies_ingest_runs.sql` → `db/026_rate_limits.sql`
→ `db/027_user_style_prefs.sql` → `db/028_demo_samples.sql`
→ `db/029_program_phones.sql` → `db/030_bmspaf_medicare_terms.sql`
→ `db/031_pricing_s2_closeout.sql` → `db/032_drug_data.sql`
→ `db/033_imbruvica_negotiated_price.sql` → `db/034_routing_partners.sql`
→ `db/035_denial_data.sql` → `db/036_policy_documents.sql`
→ `db/037_program_card_details.sql` → `db/038_bill_review.sql`
→ `db/039_bill_reference_data.sql` → `db/040_bill_rights_checks.sql`
→ `db/041_denial_engine.sql` → `db/042_agent_actions.sql`
(or `scripts/apply_db.mjs` then `scripts/run_sql.mjs` for 004+; 006–042
are idempotent). **Local CLI stack one-command build: `npm run db:reset`**
(scripts/db_reset.mjs; loopback hosts only) — order is schema.sql → seed
scripts → db/0*.sql, because several migrations patch seeded rows by
title/name (db/013/017/018/020/021) and match nothing if they run first;
`npm run db:check` (scripts/db_check.mjs) prints table count, RLS state
and seeded row counts. 010 loads owner-verified demo states (IA/ND/CA
primary_source_verified; NV classified `regulatory_guidance` by the owner
2026-08-12 via db/019 — not folded into yes/no); the other 48 rows stay
`secondary_aggregated` with
corroboration data loaded by `scripts/load_state_corroboration.mjs`.

## Authority and read order

`HANDOFF.md` is the master index — read it first, then CASE_MODEL.md,
SECURITY.md, BEHAVIOR.md, CRISIS_AWARE_DESIGN.md in that order. **When a
doc's prose conflicts with `schema.sql`, schema.sql wins.** When any older
phase list conflicts with HANDOFF.md's build sequence, HANDOFF wins.

## Scope discipline

- Build: core case-model infrastructure, then Phase 1 (drug pricing), then
  Phase 1.5 (bill auditor/denial appeals/charity care, parallel track).
- Do NOT build even if it looks cheap: insurer/PBM ownership graph, Blue
  Button 2.0, attorney referral at scale, employer plan database,
  hospital/imaging price shopping, the monitor job, any payment/billing.

## Non-negotiable constraints (stop and flag if asked to violate)

- Chat response model states only facts present in `RETRIEVED_CONTEXT`.
  Empty retrieval → deterministic code-level "no data" response; never let
  the model answer from general knowledge.
- Every `exploits`/`accumulator_policies`/`exception_precedents` row
  requires non-null `source_id` — enforce in the insert path; the DB does
  not constrain it.
- No PBM/pharma/discount-network revenue, including affiliate/referral
  links (click-out-only model per BLUE_BUTTON_AND_DISCOUNT_GRAPH.md).
- No attorney pay-for-placement; referral ranking never uses payment.
- Cost/coverage info only — no clinical recommendations (SCENARIOS.md
  Scenario 5 shows the boundary).
- No immigration status persistence, ever — ephemeral in-code check only,
  never in any table, log, or model context (IMMIGRATION_STATUS_HANDLING.md).
- Demographic eligibility flags: opt-in, additive-only, core pricing path
  must not read them (DEMOGRAPHIC_ELIGIBILITY.md).
- Every assistant chat message logs `retrieved_exploit_ids`; every
  recommendation carries the trust-receipt block (chat_system_prompt.md).

## Locked decisions (2026-07-24)

- Model router: OpenRouter direct (no MIST dependency — that decision
  never landed and was replaced same-day). `lib/modelConfig.ts` maps
  tiers → slugs with max_price caps: `anthropic/claude-haiku-4.5:floor`
  (extraction), `anthropic/claude-sonnet-5.5:floor` (response, switched
  2026-10-05 after eval_responses.ts matched the 4.6 baseline at lower
  per-token price; slug/pricing verified against the OpenRouter models
  API). Calls fail loud, never silently upgrade. Needs `OPENROUTER_API_KEY`.
- Identity encryption: pgcrypto at the application layer (no external vault).
- MTM cost threshold: $1,276 for 2026, verified against CMS CY2026 MTM
  memo; re-verify annually. Plans may set lower thresholds — present as
  "likely eligible," never a hard boolean.

## Key files and their status

- `schema.sql` — 38 tables, single source of truth for the DB. Apply
  first on a fresh project.
- `db/002_identity_crypto.sql` — pgcrypto extension + `encrypt_identity`/
  `decrypt_identity` helpers (service-role only). Widens
  `user_identity.date_of_birth` to text (ciphertext is text).
- `db/003_rls_policies.sql` — RLS on all 27 tables + `can_access_case()`
  helper. Reference data = authenticated read; user data = owner/caregiver.
- `app/api/chat/route.ts` — the chat route. Requires a session (Bearer
  JWT or cookie via `lib/session.ts`; 401 otherwise). Pipeline: extraction
  → retrieval → AKS hard-block → `lib/ranking.ts` (deterministic pathway
  order) → grounded response; empty retrieval and
  unparseable extraction both short-circuit to deterministic answers in
  code. Third short-circuit (2026-08-13): the extraction schema carries
  `on_topic`; clearly off-topic messages (general knowledge, creative
  writing, coding help, prompt-extraction attempts) get the warm redirect
  string at the EXTRACTION step — no fact merge, no retrieval, no
  response-model call. Crisis/distress language is always on_topic so it
  reaches the crisis-aware pipeline. `callModel()` (OpenRouter direct,
  `lib/callModel.ts`) logs one usage line per call (prompt/completion/
  cached tokens). S1 hardening (2026-10-05): the response model writes
  only the explanation — `lib/groundingGuard.ts` checks every figure,
  percentage and program name against the retrieved data (one
  regeneration with the offenders listed, then a deterministic
  sourced-options fallback), and the `---DETAILS---` trust receipt is
  built in code from the ranking output (`lib/trustReceipt.ts`), never by
  the model. Since db/022
  (2026-10-01): retrieval also reads `price_sources`, and the
  RETRIEVED_CONTEXT is built by `lib/chatRetrieval.ts` with the
  consent/staleness partition applied inside; the API response carries
  `excluded_prices` (withheld stale prices are said out loud).
- The real bill path (Phases 2 to 4, 2026-10-16; plan:
  docs/kimi/PLAN_PHASES_2_4.md). Interfaces in `lib/production/types.ts`,
  demo and real implementations side by side, one contract suite
  (`test_production_contracts.ts`). Reader: on-server by default
  (`lib/production/real/readers.ts` + pure `lib/production/layout.ts`;
  `DOCUMENT_READER=model` is an opt-in that needs a BAA; the vision
  reader refuses any non-synthetic document). Benchmark:
  docs/research/reader_benchmark.md. Checks: pure
  `lib/rules/bills/checks.ts` (duplicates, room days, ask-about, MUE unit
  limits, NCCI pairs, doctor price benchmark) on reference rows from
  db/039 loaded by `npm run ingest -- bill_refs` (numbers only, no CPT
  descriptions). NCCI pair files and the OPPS/CLFS fee files sit behind
  the AMA license page on cms.gov and are NOT downloaded: pairs load only
  via `--ptp-dir` after the owner accepts that license. **Owner decision
  2026-10-16: the license is NOT accepted (counsel is asked first). Do not
  download or load the pair files; on real data the pair check returns
  nothing, by design** (docs/legal_review_before_launch.md). Letters: `lib/letters/` (every fact written by
  code; `LETTER_MODEL_SENTENCE=true` adds one guarded tone sentence, the
  model is told no patient data); freeze = sha256 + pdf-lib PDF, and a DB
  trigger refuses edits to a frozen letter's content. Routes:
  `cases/[id]/documents/[docId]/confirm`, `cases/[id]/letters`,
  `cases/[id]/letters/[letterId]` (403 in DEMO_MODE). Screen:
  `app/cases/[id]/BillReview.tsx`. Tests: test_layout, test_bill_checks,
  test_letters, test_confirm_bill; e2e `scripts/synth_docs/e2e.ts`;
  live `smoke_bill_review.mjs`. Patient rights checks (2026-10-16,
  `lib/rules/bills/rights.ts`, quotes in
  docs/research/no_surprises_charity_care_verification.md): No Surprises
  emergency and ancillary limits (work/marketplace plans only; "if" when
  coverage is unknown), the good faith estimate $400 dispute threshold
  (the patient enters the estimate; the amounts a finding names travel as
  `refsUsd` / db/040 `ref_amounts_usd` so letters pass grounding), and
  nonprofit hospital financial assistance (240-day application window).
  All "ask", never assumed; coverage comes from the case subject as in
  chat. Test: test_bill_rights.
- The real denial path (Phase 5, 2026-10-17; spec Appendix B4; rule
  quotes in docs/research/denial_rules_verification.md, eCFR current to
  2026-10-15). Pure engine in `lib/rules/denials/`: `rules.ts` (registry
  with citations, deadlines per plan type: employer/marketplace 180 days
  and external review four months by the 147.136 calendar rule; Part D
  and Medicare Advantage 5 presumed days + 60; Medicaid plan 60, fair
  hearing 90 to 120, state Medicaid left to the notice; plan decision
  limits for `insurer_late`), `checks.ts` (the spec A3 checks plus
  medical necessity, excluded service and external review), `parse.ts`
  (denial text -> draft, no model; the layout parser keeps `text` for
  denial letters and EOBs), `confirm.ts` (the ONLY ConfirmedDenial
  constructor: nothing runs on unconfirmed data), `arguments.ts` (appeal
  points; Medicare Advantage cites a Medicare coverage rule only when it
  lists the exact code, 42 CFR 422.101(b)), `codes.ts` (CARC/RARC numbers
  only; category words always shown; per-code wording in db/041
  `denial_codes` stays hidden until the owner sets `explanation_status =
  'approved'`). Letters: `lib/letters/denialTemplates.ts` (appeal /
  redetermination / reconsideration, external review, claim file,
  specific reason, Part D exception, and the request to the doctor for a
  letter and records; `denialLetterProblems` proves every number, date
  and code comes from the record or a rule and that no clinical judgment
  is written). Safety rules: a window that runs from receipt is counted
  from the date ON the notice; a shorter window stated in the letter
  wins. `lib/deadlines.ts` (older payer-specific rules, unverified) is
  not used by the denial path. Data: `lib/production/denialReview.ts`,
  route `cases/[id]/documents/[docId]/denial` (403 in DEMO_MODE), denial
  letters through `cases/[id]/letters` (the patient types the name).
  Screen: `app/cases/[id]/DenialReview.tsx` ("Who pays your claims?").
  db/041: denials, denial_codes, rules (mirror of the registry, test
  proves they match), appeal_outcomes; deadlines and letters gain
  denial_id. Tests: test_denial_rules, test_denials, eval_denials (graded
  cases via `--cases`), e2e `scripts/synth_docs/e2e_denials.ts`, live
  `smoke_denial_review.mjs`. Not built: state rules, Medicare levels 3
  to 5, marketplace prior authorization (45 CFR 156.223), federal
  holidays, the B4 legal notice and chat legal-scope items.
- Agent actions (Phase 6, 2026-10-17; plan docs/kimi/PLAN_PHASE_6.md).
  Pure in `lib/actions/`: `registry.ts` (every action's tier, patient-only
  steps, requirements; `canRun()` is the one gate: sign/attest/pay/opt-in
  impossible without the patient, nothing leaves without approval, Tier 3
  never), `authorization.ts` (one-time authorization, text is a
  PLACEHOLDER for counsel, versioned and hashed; finger signature PNG with
  an ink check via sharp; signed letter = frozen text + signature, PDF
  dates pinned to the signing time so a rebuilt copy matches its stored
  hash), `senders.ts` (`FaxSender`/`MailSender`; demo executors =
  "Practice send", nothing leaves; any `SEND_EXECUTOR` other than demo
  gets refusing stubs until a vendor that signed a BAA exists),
  `tracker.ts` (reply deadlines only from verified rules, counted from the
  delivery date: appeal decision limits from Phase 5, external review 45
  days; none for bill letters and requests; overdue), `replies.ts`
  (classify approved / denied again / info requested / collections notice
  / corrected bill / unknown, propose the next step; approving drafts a
  letter at most), `notify.ts` (no health details; no delivery channel
  yet), `syntheticReplies.ts`. Data: `lib/production/actions.ts`
  (approvals ledgered as `agent_authorization` / `agent_action`; no IP or
  device data anywhere). Routes: `authorization`, `cases/[id]/letters/
  [letterId]/sign`, `cases/[id]/jobs`, `cases/[id]/jobs/[jobId]`,
  `.../jobs/[jobId]/replies`, `cases/[id]/replies/[replyId]` (all 403 in
  DEMO_MODE). Screens: `SendFlow.tsx` (under a frozen letter),
  `SignaturePad.tsx`, `Tracker.tsx` (case page). db/042:
  agent_authorizations, letter_signatures, send_jobs, send_job_events
  (append-only trigger), case_inbound_numbers, replies. The privacy
  cascade skips a table a database does not have yet (PGRST205/42P01).
  Tests: test_actions, test_tracker, test_replies, auth guards, live
  `smoke_agent_actions.mjs`. Gated: real fax/mail/e-sign vendors (BAA),
  counsel's authorization text, notification delivery, inbound webhooks.
- Patient home P1 (Phase 7, 2026-10-17; design docs/design/patient_home_*):
  pure `lib/home/compose.ts` (status chips in words, Needs you soonest
  first, Saved so far from the latest PATIENT-CONFIRMED outcome per case
  only, monthly savings never multiplied by a guessed duration, "possible"
  on its own labeled line, Coming up, the job timeline composed from
  existing rows newest first, the documents list), loader
  `lib/home/load.ts` (own and managed patients' cases via listCases,
  never samples; read-only, no new tables). Routes `api/home`,
  `api/jobs`, `api/jobs/[id]`, `api/documents` (403 in DEMO_MODE). Pages
  `/home`, `/jobs`, `/jobs/[id]`, `/docs` with `app/home/BottomNav.tsx`; in
  DEMO_MODE they point to the sample patients (demo unchanged). Frozen
  letter PDFs pin their dates to the freeze time, so a re-download is
  byte-identical. Not counted yet: savings on purged cases
  (`case_summaries` does not record patient confirmation). Tests:
  test_home, auth guards, live `smoke_patient_home.mjs`. P2 (profile,
  privacy center) and P3 (savings confirmation flow, employer rollup) next.
- `lib/` — core infrastructure modules (built 2026-07-24):
  - `cases.ts` — case CRUD + status workflow; illegal transitions throw
    (`IllegalTransitionError` → 409 at the API layer). Guard is the pure
    `assertLegalTransition()` — tested by `scripts/test_transitions.ts`.
    Terminal transitions (`resolved_won`/`resolved_lost`/
    `closed_by_patient`) set `resolved_at`, starting the 90-day
    retention clock. Decided 2026-10-14, not built: receipts, sent letters
    and confirmed savings will outlive that purge until the patient
    deletes them (patient home P1; DATA_RETENTION.md).
  - `deadlines.ts` — deadline engine. Rules carry `basis` text; unverified
    rules store `source_id`/`last_verified_at` null; no matching rule →
    honest `no_rule` result, never a guessed deadline.
  - `identityCrypto.ts` — the ONLY encrypt/decrypt paths for
    `user_identity`. `decryptIdentityForForm()` is for form generation
    only; everything else uses `readIdentityMasked()` (booleans, never
    values).
  - `caregivers.ts`, `privacy.ts` (full deletion cascade + per-category
    demographic clearing; clears are consent-ledgered), `outcomes.ts`
    (patient-confirmed only; `pharmacy_used` per db/014; pure
    `shouldPromptOutcomeConfirmation()` gates the terminal-transition
    prompt — tested by `scripts/test_outcomes.ts`).
  - `mtm.ts` — MTM eligibility, pure `computeMtmEligibility()` (tested by
    `scripts/test_mtm.ts`) + DB loader `computeAndStoreMtmCheck()`.
  - `medicareEligibility.ts` — the AKS hard-block: pure
    `partitionCopayCardsForInsurance()` (tested by
    `scripts/test_medicare.ts`). Manufacturer copay cards never surface for
    Medicare/Medicaid patients; the block reason is appended
    deterministically in code, never left to the model.
  - `ranking.ts` — the ranking engine (built 2026-08-12). Pure
    `rankPathways()` (tested by `scripts/test_ranking.ts`) + DB loader
    `rankSavingsPathsForDrug()`. Winner = lowest 3-12 month trajectory
    cost, never point-in-time; only `verified_current` rows rank;
    conflicted/unresolved rows go to pendingVerification with no number;
    state-ban assertions require `primary_source_verified` (the SQL
    function has no confidence awareness). Since 2026-10-01 (db/022):
    price rows pass the consent/staleness partition in
    `lib/pricing/enforcement.ts` before pathway construction, excluded
    stale rows are reported on the result as `excludedPrices`, and
    `acquisition_benchmark` rows (NADAC-type) never rank as pathways —
    benchmarks are not patient prices. One-time offers (free first fill) go
    to `bridges`, never `ranked`: no yearly figure, never the winner; the
    trust receipt and fallback word them as first-fill bridges (2026-10-15).
    A program's stated Medicare terms (`medicare_allowed` true / false /
    anything else = unknown) are read in `eligibilityNotes`: unknown is
    held as pending and never offered to a Medicare patient (db/030).
  - `extractedFacts.ts` — Feature A merge step (built 2026-07-28): every
    extracted fact → durable profile/case/med row immediately;
    contradictions park in `pending_fact_corrections` (never silent
    overwrite, never blocking); pre-case facts stage in
    `pending_case_facts` and migrate on case creation.
  - `resolveLocation.ts` — pure raw-location → zip/state resolver (tested
    by `scripts/test_location.ts`). USPS codes match case-sensitively on
    purpose ("in" ≠ Indiana).
  - `consent.ts` — the ONLY write path for `consent_ledger` (append-only;
    no update/delete anywhere; RLS is owner-read, service-role-write).
  - `documentIntake.ts` — Feature C pipeline (built 2026-07-28): pdfjs
    text-first for native PDFs, pdf-to-img raster fallback for scanned,
    heic-convert server-side, magic-byte image sniffing, 25MB cap.
    Screening is type/size only — malware scanning is a known deferred
    gap, do not close it accidentally.
  - `rateLimit.ts` — rate limits + public-demo model budget (2026-10-14,
    M01-AC7 moved up from S4). The limit table is pure (tested by
    `scripts/test_rate_limit.ts`); counting is one atomic all-or-nothing
    SQL function, `consume_rate_limits()` in db/026, which reads
    `auth.users.is_anonymous` itself. Per-user + per-IP (keyed hash, never
    the raw IP) + ONE combined daily cap for all anonymous users (default
    200 model requests, `RATE_LIMIT_ANON_DAILY_MODEL_CAP`) — per-user caps
    alone are dodged by clearing cookies, since proxy.ts mints a new
    anonymous user per cookieless visit. Applied via `apiDeps` on chat,
    documents and cases/start (401 → 429/503 → ownership). **Fails closed
    (503)**, so db/026 must be applied to a database BEFORE code that calls
    it is deployed there. `scripts/smoke_rate_limit.mjs` proves the SQL
    against the local stack.
  - `securityHeaders.ts` — CSP/HSTS/frame/nosniff/referrer/permissions
    headers, built in `next.config.ts` (tested by
    `scripts/test_security_headers.ts`). CSP keeps `'unsafe-inline'` for
    Next hydration + next/font; a nonce CSP is the S4 follow-up.
    `connect-src` allows only this app and `NEXT_PUBLIC_SUPABASE_URL`.
    `APP_VERSION` is fixed at build from APP_VERSION → VERCEL_GIT_COMMIT_SHA
    → local git, so `/api/health` shows the deployed commit.
  - `supabaseAdmin.ts` — lazy service-role client; server-only.
  - `supabaseBrowser.ts` — publishable-key browser client; client comps.
  - `session.ts` — `getUserId(req)`: Bearer JWT or cookie session →
    userId, else null (→ 401). Used by `/api/chat` and `/api/cases/start`.
  - `apiAuth.ts` — the API auth boundary (Step 0, 2026-10-01): `requireUser`
    + the `apiDeps` registry every guarded route calls through. The
    registry is the documented test seam for `scripts/test_auth_guards.ts`;
    app code must never rebind it.
  - `persona/arik.ts` + `persona/styleSignals.ts` + `chatPrompt.ts` —
    Arik's persona (2026-10-14; the persona developer guide in docs/ (ARIK_PERSONA) is the
    guide, the one source of truth for voice/intro/crisis text is
    `persona/arik.ts`). Code-written intro and crisis replies (988/911;
    pharmacist/urgent care for life-sustaining meds) composed around the
    model text; deterministic style dials from the conversation only
    (never profile data), recomputed per turn, never stored; style block
    goes in the UNCACHED prompt so caching holds. `test_style_neutrality.ts`
    proves style never changes facts. Saved preferences (length/order
    only) in `user_style_prefs` (db/027) via `/api/preferences/style`,
    ledgered as `style_preference`.
  - `demo/samples.ts` + `demo/sampleCases.ts` + `demo/sampleDocs.ts` —
    demo sample patients (DEMO_DAY stage 1, db/028). Five fictional
    patients live as fixtures in code; "Try a sample patient" copies one
    into the visitor's account as a case marked `is_sample`, keyed by a
    per-tab sessionStorage id (`app/sampleSession.ts`). Purged after 60
    minutes idle (pg_cron, every 5 min) or at once on Reset; never in
    "Your cases", outcomes (409) or the 90-day purge's summaries. A sample
    case's chat uses the fixture's situation (`resolveChatSubject` sample
    input), never merges facts into the visitor's profile. Everything is
    gated by `DEMO_MODE=true` (404 otherwise); with it on, real uploads are
    refused (403) and "+" offers only fictional sample documents. Tested by
    `test_demo_samples.ts`, `test_auth_guards.ts`, `smoke_demo_samples.mjs`.
    **Apply db/028 before deploying with DEMO_MODE on.**
  - `walkthrough/` + `app/walk/` + `app/samples/[key]` — the scripted demo
    walkthroughs (docs/kimi/DEMO_WALKTHROUGHS.md, DEMO_MODE only): bill
    (Luis), denial (Tasha), prescription (Maria/James/Dana) and the sample
    patient homes. Scripts are data (`walkthrough/flows.ts`), letters are
    fixtures (`walkthrough/letters.ts`), documents are generated SVGs in
    `public/demo/docs`. No model calls, nothing uploaded or sent: receipts
    and new jobs live in sessionStorage (`app/walk/demoJobs.ts`). The only
    live data is Flow 1's prices via `/api/demo/rx` → `demo/rxOptions.ts`
    (same copay-card block + ranking engine as chat; one-time offers are
    shown as a bridge, never "Best path"). Script integrity, totals and
    the letter-stated denial deadline are tested by
    `test_walkthroughs.ts`; the click-through is a Playwright run.
  - `programPhone.ts` — which program number to show (chat "Call the
    program" + demo call card): only a number copied from the program's
    own page (`support_phone`, cited by `support_phone_source_url`, hours
    in `support_phone_hours`, db/029), only for a program the engine
    offers, best path first; blocked/pending rows never lend one.
    `test_program_phone.ts`.
  - `caseCard.ts` + `caseCards.ts` — the one place internal case status,
    type and field names become plain words (home cards, case header);
    `test_case_card.ts` proves no raw name reaches the screen.
  - `chatSubject.ts` — whose situation a chat turn is about (review fixes
    C1/C3, 2026-10-14): a caregiver case uses the MANAGED PATIENT's
    insurance/state/income (unknown today, so manufacturer copay cards are
    held back with a reason), never the caregiver's; and the model sees
    only `MODEL_PROFILE_FIELDS` + drug/dose medications (no demographic
    flags, conditions, income, employer, zip, prescriber). Tested by
    `scripts/test_chat_subject.ts`.
  - `chatRetrieval.ts` — builds the chat route's RETRIEVED_CONTEXT. The
    AI/display consent gates run INSIDE it, so a barred row cannot reach
    an OpenRouter prompt without bypassing the one function the route calls.
  - S2 partner readiness (2026-10-16, mock only): `pricing/http.ts`
    hardened client (timeout, 5xx backoff+jitter, 429 Retry-After,
    per-source circuit breaker; errors carry no bodies/URLs),
    `pricing/configAdapter.ts` (config-driven adapter: api_key/bearer/
    OAuth, page/offset/cursor, field map; `checkSourceEnv` +
    `instrumentation.ts` fail fast on missing env NAMES),
    `pricing/mockPartner.ts` (+ `scripts/mock_partner_api.ts`),
    `pricing/quotes.ts` + `quoteSources.ts` (live quotes in chat; the
    registry is EMPTY in this repo, real partner configs live in the
    private repo), `pricing/sourceAdmin.ts` + `npm run source:disable|
    enable|purge`. Ingest runner writes `ingest_runs` and matches pharmacy
    NPIs. db/031 adds price_sources kind/mode, the pharmacy-aware natural
    key and `zip_centroids`. Tests: `test_http_client.ts`,
    `test_partner_readiness.ts`, `test_ingest_integration.mjs` (arik-pg).
  - Drug data, top 200 (2026-10-16, docs/kimi/DRUG_DATA_TOP200.md):
    `drugdata/parse.ts` (pure: Part D grouping of presentations into
    drugs, salt-word/qualifier rules, FDA product match by active
    substances, RxNorm, Census gazetteer), `scripts/load_drug_data.ts
    partd|ndc|rxnorm|nadac|zips|size` (LOCAL only; downloads to `.data/`),
    `scripts/export_seed.mjs` -> one idempotent SQL file merged by natural
    keys, `scripts/apply_remote.mjs` (refuses anything but project
    iwayoxmpbueneagdkpzj; dry run by default, `--confirm` to commit,
    stops above 80% of the 500 MB free plan; `--local` to test on arik-pg).
    Anything that doesn't match cleanly goes to `drug_data_review`, never
    guessed. NADAC is ONE DATASET PER YEAR on data.medicaid.gov: the id is
    looked up by title (`resolveNadacDatasetId`); units EA/ML/GM and the
    brand/generic class are from the CMS field definitions. Freshness uses
    `as_of_date` when a source has it (enforcement.ts). Benchmarks never
    reach the model or ranking: chat fetches them separately and a drug
    with no patient-price path gets the code-built answer in
    `benchmarkAnswer.ts` ("what pharmacies pay", never "your price").
    Tests: `test_drug_data.ts`, `test_benchmark_answer.ts`.
  - `routing/` — prescription routing Part B (M24, 2026-10-16), MOCK
    ONLY, no partner names: `RxRoutingProvider` (provider.ts, boundary
    validation, opaque `newRoutingReference` so no patient data goes to a
    partner), `httpProvider.ts` (M07 client + shared `createAuth`; the
    private repo supplies field `map` functions), `mockRoutingPartner.ts`,
    `contract.ts` (`runRoutingContract`: the suite the real adapter must
    pass), `rank.ts` (`rankDestinations` drops partner identity before
    ordering; neutrality test), `admin.ts` + `npm run routing:disable|
    enable|purge`, `disclosure.ts` + `app/how-we-route`. db/034:
    `compensation_to_arik` check = 'none', enabling needs a data use
    agreement date. Tests: `test_routing.ts`, `test_routing_db.mjs`.
  - `rules/cashVsInsurance.ts` + `counterCard.ts` — cash vs insurance
    (2026-10-16, docs/kimi/PLAN_CASH_VS_INSURANCE.md; regulation quotes
    in docs/research/cash_vs_insurance_verification.md): codes + one EN/ES
    string table, decided in code. Medicaid never steered to cash; a covered
    drug gets the owner-approved line citing 42 CFR 447.15 ("should cost
    you only your Medicaid copay"), marked `legalReview` for counsel before
    launch (`LEGAL_REVIEW_REASONS`; docs/legal_review_before_launch.md);
    Medicare always gets the Part D limit caveat; commercial asks for
    plan cost and deductible status. Ranking: a drug maker's program is
    pending for Medicare/Medicaid until `exploits.federal_program_allowed`
    = 'yes' (db/037); a list price is `reference` and never the winner.
    "At the counter" card only for cash/discount-card paths, card numbers
    only with `card_details_source_url`. Guard rule 6: no cash advice to
    a Medicaid patient. Test: `test_cash_vs_insurance.ts`.
  - `data/` — free data loaders Part A (2026-10-16): `denial.ts` (pure:
    TiC PUF values `*`/`**`/`***`/`N/A` -> null + flag, per-issuer
    aggregation, prior auth template validation, summaries that never
    read as a personal prediction), `xlsx.ts` + `csv.ts` (small pure
    readers), `denialData.ts` (`getInsurerDenialStats`,
    `getPriorAuthMetrics`: values + source label/URL/data year, or "no
    data"). `npm run ingest -- tic_puf | prior_auth --file <csv>` goes
    through `scripts/ingest.ts` (price sources still go to
    ingest_prices.ts); runs log to `ingest_runs.dataset` (db/035). The
    grounding guard's rule 5 rejects "X% chance your claim is denied"
    style text. Test: `test_denial_data.ts`.
    Part B: `coverage.ts` (pure: MCD tables -> one record per current
    NCD/LCD/Article per the MCD data dictionary; states from contractor
    jurisdictions when a document has several contractors, else its
    primary jurisdiction; drafts = display_id set; codes only),
    `coverageData.ts` (`getCoverageRule(codeOrName, state)`), loader
    `npm run ingest -- mcd` (scripts/load_coverage_data.ts, replaces the
    current set; db/036). Refresh cadence for every source:
    docs/data_refresh_schedule.md. `export_seed.mjs` now also carries
    payer_denial_stats and policy_documents. Test: `test_coverage_data.ts`.
  - `pricing/adapter.ts` — source-agnostic `PriceSourceAdapter` contract
    (fetch/normalize → `NormalizedPrice`; rejects are logged, never
    coerced), `pricing/adapters/` (registry + `nadac.ts`; field mapping
    with per-field sources and UNVERIFIED marks in the header),
    `pricing/enforcement.ts` — pure `partitionPricesForConsent()`
    (staleness + `allow_patient_display`/`allow_ai_processing` gates,
    tested by `scripts/test_pricing_enforcement.ts`).
- `app/` — `login` (magic link + password), `auth/callback`, `page.tsx`
  (case list + guided-entry front door + `PlanTypeSelector`
  coverage control), `cases/[id]` (+ Thread, DocumentUpload,
  OutcomePrompt client comps), `api/cases/start` (creates case + session
  from free text; keyword-type heuristic is a visible filing aid).
  `NewCaseForm.tsx` is the welcome screen (FIRST_RUN_AND_BRAND.md,
  2026-10-15): Arik's greeting bubble (persona intro), four starters
  (prescription starts a case; bill, denial and sample patient say
  "coming in this demo soon" until 5a), the "Try it with a real drug"
  strip and the pinned chat box. The Eliquis button sets plan type
  to Medicare via `/api/profile/insurance-type` ONLY when the profile
  has none (never overwrites a chosen value) so the AKS hard-block
  actually fires in the demo. `layout.tsx` carries the once-per-session
  splash (gate script before first paint; off with reduced motion), the
  coral demo ticker (`DemoTicker.tsx`), the header (logo PNG + the
  `LanguagePreference.tsx` EN | ES pill, still the ledgered path), the
  brand fonts and the fixed glow blobs. Brand assets live in
  `public/brand/` (owner's kit; logo PNGs, the traced SVG is not yet
  approved); app icons are `app/favicon.ico`, `icon.png`, `apple-icon.png`,
  `opengraph-image.jpg`. `globals.css` holds the brand tokens (navy
  #325773, teal #109890 from the logo; light-only by design, 56px
  primary / 48px pill touch targets). `validate_repo.py` fails on any em
  dash in app/ or lib/ strings. `proxy.ts`
  refreshes the auth cookie (Next 16's name for middleware) and signs
  cookieless visitors in anonymously.
- `scripts/` — `validate_repo.py` (structural gate), `apply_db.mjs`
  (fresh-project schema apply + verify), `run_sql.mjs` (apply one file),
  `smoke_rls.mjs` (RLS cross-user tests, needs fixture users in
  auth.users — self-cleaning), `seed_drugs.mjs`, `seed_exploits.mjs`,
  `check_seed.mjs`, `check_exploits.mjs`, `test_transitions.ts`,
  `test_mtm.ts`, `test_location.ts`, `smoke_http.mjs` (API workflow +
  409s), `smoke_chat.mjs` (grounded + short-circuit chat paths),
  `smoke_extraction.mjs` (Feature A: merge, corrections confirm/dismiss,
  staging migration), `smoke_language.mjs` (Feature B: preference API,
  launch-scope 400s, ledger rows, es chat + es extraction),
  `smoke_documents.mjs` (Feature C: pdf native/scanned/image/HEIC-fail,
  401/413/415, storage + expiry), `smoke_retention.mjs` (Feature D:
  resolved_at, extended-retention opt-in/out + ledger, raw-upload purge,
  pg_cron case purge + summary), `smoke_flow.mjs` (onboarding front
  door e2e), `eval_fixtures.mjs` (the four complaint-pattern eval
  fixtures; shape self-check when run directly, consumed by the Phase 5
  harness), `check_staleness.mjs` (30-day freshness flag; exit 1 on any
  stale exploit/source row — the manual version of ticket 1.4's monitor),
  `reconcile_state_law_passes.mjs` (three-pass state-law diff → buckets +
  review-priority doc; never touches the DB),
  `test_medicare.ts` (pure AKS hard-block tests),
  `smoke_medicare.mjs` (e2e: Medicare Part D + Eliquis → copay card
  blocked, PAP surfaced, legal note visible),
  `test_outcomes.ts` (pure outcome-prompt decision tests),
  `test_ranking.ts` (pure ranking-engine tests),
  `eval_ranking_cases.mjs` + `eval_ranking.ts` (12 ranking eval cases;
  owner supplies ground truth, nothing self-grades), `eval_responses.ts`
  (the same 12 cases through the grounded response path: winner+price vs
  the engine, invented-number inventory, foreign-program check, trust
  receipt; `--model <slug>` to A/B tiers),
  `smoke_zepbound_conflict.mjs` (live chat: conflicted Zepbound card
  surfaces only as pending-verification, never a trusted number),
  `smoke_scope_boundary.mjs` (2026-08-13: out-of-scope drug gets the
  honest no-data answer; 4 off-topic message types get the redirect
  verbatim; broad on-topic questions still reach the response model),
  `load_state_corroboration.mjs` (fills corroboration_count/source_pass_ids
  on secondary state-ban rows from the reconciliation JSON; never touches
  verified/flagged rows), `test_auth_guards.ts` (Step 0 per-route 401/404
  proofs, serverless), `ingest_prices.ts` (pricing ingest runner:
  `--source <id> [--file] [--dry-run]`; ARIK_PG* env only, never the
  remote), `test_nadac.ts` (fixture-only adapter tests),
  `test_pricing_enforcement.ts` (staleness + AI/display gates),
  `test_ingest_integration.mjs` (runner CLI vs local arik-pg),
`local_pg_apply.mjs` + `local_pg_bootstrap.sql` (bare-Postgres local dev
stack; emulates auth/roles/cron/Storage, filters pg_cron/pg_net
create-extension lines locally), `db_reset.mjs` + `db_check.mjs` (the
`npm run db:reset` / `npm run db:check` local Supabase CLI stack flow),
`run_tests.mjs` (`npm test`: every test_*.ts suite),
`test_grounding_guard.ts` (guard pass/regenerate/fallback),
`smoke_privacy_delete.ts` (M18-AC5: full-account deletion e2e). Node scripts read
  `.env.local`; smoke scripts use the auth admin API for fixture users.
- `app/api/` — thin route wrappers: `cases`, `cases/[id]` (GET/PATCH
  transition), `cases/[id]/deadlines`, `identity` (masked GET/PUT only),
  `managed-patients`, `privacy` (DELETE all / PATCH clear category),
  `outcomes`, `corrections` (one-tap confirm/dismiss of pending fact
  corrections; whitelisted targets only), `preferences` (language GET/PUT;
  en/es launch scope, every change ledgered), `profile/insurance-type`
  (PUT plan type only — member ID/group number are deliberately not
  collected anywhere; session-authed; feeds the AKS hard-block), `cases/[id]/documents`
  (upload → storage → preprocess → extract → persist; failures kept as
  first-class 'failed' rows, 502), `managed-patients` PATCH
  (extended-retention opt-in/out, session-authed, ledgered),
  `jobs/purge-expired-uploads` (service-key bearer only; deletes expired
  raw Storage objects, keeps rows). **Every API route enforces session
  auth (Step 0, 2026-10-01)**: routes resolve the caller only via
  `lib/apiAuth.ts`'s `requireUser` (the old request-supplied userId is
  ignored everywhere), case-scoped routes check `canAccessCase()` in
  `lib/cases.ts` (owner or managing caregiver; stranger and nonexistent
  get the same 404), and `scripts/test_auth_guards.ts` proves 401/403/404
  per route (33 checks, serverless, via the apiDeps test seam).
- `chat_system_prompt.md` — loaded at runtime; contains hard rules,
  crisis-awareness standing instruction, required trust-receipt section.
  Keep all three intact if edited.
- `seed_drugs.json` — 2026 point-in-time figures; create `sources` rows
  during load and verify before production use.
- `scripts/validate_repo.py` — structural checks (JSON validity, schema
  forward-refs, doc table references). Note: it only checks `create table`
  names in docs, not `references` targets inside doc SQL snippets.

## Toolchain quirks (cost real time, don't rediscover)

- Node 24 + npm 11. Dependencies are exact-pinned; keep the lockfile.
  `@types/pg` is a devDependency (exact pin) because the `.ts` ingest
  runner imports `pg` — the package ships no bundled types.
- Local dev database: `docker run -d --name arik-pg -e POSTGRES_PASSWORD=postgres
  -e POSTGRES_DB=arik -p 127.0.0.1:54329:5432 postgres:16`, then
  `node scripts/local_pg_apply.mjs 022` (fresh) or `--only 022`
  (incremental; schema.sql is one-shot). The bootstrap emulates Supabase
  roles/auth/cron/Storage; pg_cron and pg_net `create extension` lines in
  db/009 are filtered LOCALLY ONLY (stubbed cron schema records schedules
  in cron.job). Port 54329 avoids the beacon-relay postgres on 5432 —
  do not touch that container.
- **TypeScript must stay on 5.x** (currently 5.9.3). `typescript@7`
  (native preview) crashes `next build`'s type-check step with a cryptic
  "id argument must be of type string" worker error.
- `next build` is the verification gate (compile + full type-check);
  `npm run typecheck` (`tsc --noEmit`) is the faster inner loop.
- Env vars: see `.env.example`. Build passes without them; runtime API
  calls need `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `IDENTITY_ENCRYPTION_KEY` (app-held pgcrypto passphrase — losing it
  makes identity data unrecoverable).
- `npm audit`: 0 findings as of 2026-10-16, after upgrading next
  16.2.11 -> 16.3.8 (critical RCE advisories GHSA-p293-qw3h-jr36,
  GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j and others, all < 16.3.8) and
  pdf-to-img 6.2.0 -> 7.0.0 with pdfjs-dist 5.6.205 -> 6.2.108 (malicious
  PDF JavaScript execution, GHSA-hq66-cqwq-w95j, < 6.2.108). Re-run
  `npm audit` before every deploy; never `npm audit fix --force`.
- `pdfjs-dist` must match the version pdf-to-img depends on (6.2.108 for
  pdf-to-img 7.0.0); pdfjs throws "API version does not match Worker
  version" otherwise. Keep them deduped (`npm ls pdfjs-dist`).
- OCR: `tesseract.js` 7.0.0 with `@tesseract.js-data/eng` 1.0.0 (the
  English data ships in node_modules; no download at run time). It MUST
  stay in `serverExternalPackages` and keep its explicit `workerPath`
  (lib/production/real/readers.ts): bundled, the worker path becomes
  `E:\ROOT\node_modules\...`, the worker never starts and an upload
  hung 3.7 minutes. Worker start and each page are time-capped.
- pdfjs `standardFontDataUrl` needs a real fs path with a trailing
  FORWARD slash (Turbopack's require.resolve returns a virtual
  "[externals]" path; use process.cwd() + node_modules, see
  lib/documentIntake.ts).
- Uploads >10MB need `experimental.proxyClientMaxBodySize: '30mb'` in
  next.config.ts — Next 16's proxy truncates multipart bodies at 10MB by
  default and the route then dies with a 500 formData parse error.
- `cron.job` rejects direct DML on Supabase (42501 even as postgres) —
  use `cron.unschedule()`/`cron.schedule()` only. And run_sql.mjs sends
  multi-statement files as ONE implicit transaction: any failure rolls
  the whole file back (a mid-file cron.job failure looked like the
  extensions "never installed" — check pg_extension after errors).
- Edge Function deploy for `supabase/functions/purge-expired-uploads/`
  is BLOCKED: MCP is bound to MsJaneHH (reconfirmed 2026-07-28) and the
  local CLI account lacks the Arik project. `/api/jobs/purge-expired-
  uploads` runs the identical purge today; deploy + pg_net schedule is
  the one open infra action.
- Vercel: production alias is https://arik-liard.vercel.app (project
  `arik`, team `rpr-dev-s-projects`, single-seat Hobby; repo `.vercel/`
  is linked). Deployment URLs (arik-*-rpr-dev-s-projects.vercel.app) are
  behind Vercel SSO deployment protection — anonymous requests 302 to
  vercel.com/sso-api, so probe the alias for live checks, not the
  deployment URL. CLI access = `vercel login` (creds cached under
  %APPDATA%\com.vercel.cli\Data); no token in any .env file.
  `vercel logs` streams live only by default; for history use
  `--no-follow` with `--since`/`--status-code`/`--expand`.
- 2026-08-13 incident: prod 500 on GET / was Vercel-only because the
  four server env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  IDENTITY_ENCRYPTION_KEY, OPENROUTER_API_KEY) existed with EMPTY values
  — `vercel env ls` lists names only; verify values with
  `vercel env pull` (compare lengths, never print secrets). Env changes
  need a redeploy; `vercel redeploy <url>` rebuilds the same source,
  avoiding working-tree drift. Also note proxy.ts signs cookieless
  visitors in anonymously (signInAnonymously), so anonymous traffic DOES
  reach supabaseAdmin() code paths — never rule out a server-side path
  on "anon never gets there" grounds.

## Architecture intent (affects how you extend it)

- The case, not the conversation, is the product unit (CASE_MODEL.md).
  Chat is case-scoped: one thread per case, never one continuous history.
- Chat is a 3-step RAG pipeline: cheap extraction model → plain Supabase
  queries (no LLM) → reasoning model grounded only in retrieved rows.
  Do not collapse into one model call.
- Autonomy tiers (BEHAVIOR.md): Tier 0/1 automatic; Tier 2 one-tap confirm
  before anything leaves the system; Tier 3 (signatures, clinical
  judgment, inferred diagnoses) never built, not even as a disabled path.
- The `exploits` database is the actual asset; the frontend is disposable
  and re-skinnable per vertical against the same/forked Supabase instance.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
