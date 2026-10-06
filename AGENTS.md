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
(or `scripts/apply_db.mjs` then `scripts/run_sql.mjs` for 004+; 006–024
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
- `lib/` — core infrastructure modules (built 2026-07-24):
  - `cases.ts` — case CRUD + status workflow; illegal transitions throw
    (`IllegalTransitionError` → 409 at the API layer). Guard is the pure
    `assertLegalTransition()` — tested by `scripts/test_transitions.ts`.
    Terminal transitions (`resolved_won`/`resolved_lost`/
    `closed_by_patient`) set `resolved_at`, starting the 90-day
    retention clock.
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
    benchmarks are not patient prices.
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
  - `supabaseAdmin.ts` — lazy service-role client; server-only.
  - `supabaseBrowser.ts` — publishable-key browser client; client comps.
  - `session.ts` — `getUserId(req)`: Bearer JWT or cookie session →
    userId, else null (→ 401). Used by `/api/chat` and `/api/cases/start`.
  - `apiAuth.ts` — the API auth boundary (Step 0, 2026-10-01): `requireUser`
    + the `apiDeps` registry every guarded route calls through. The
    registry is the documented test seam for `scripts/test_auth_guards.ts`;
    app code must never rebind it.
  - `chatRetrieval.ts` — builds the chat route's RETRIEVED_CONTEXT. The
    AI/display consent gates run INSIDE it, so a barred row cannot reach
    an OpenRouter prompt without bypassing the one function the route calls.
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
  `NewCaseForm.tsx` is the guided entry (2026-08-13): honest scope line,
  three suggested-drug chips (Eliquis/Dupixent/Zepbound), a divider,
  then the de-emphasized open textarea. The Eliquis chip sets plan type
  to Medicare via `/api/profile/insurance-type` ONLY when the profile
  has none (never overwrites a chosen value) so the AKS hard-block
  actually fires in the demo. `layout.tsx` carries the temp-demo banner,
  the brand fonts (Outfit headings / Source Sans 3 body via next/font),
  and the fixed glow blobs; `globals.css` holds the brand treatment
  (emerald/slate, light-only by design — no dark scheme, 600px centered
  panel at ≥640px, 56px primary / 48px pill touch targets). `proxy.ts`
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
- `npm audit` reports 3 high-severity findings in Next's transitive
  postcss/sharp deps; `npm audit fix --force` would downgrade Next to 9.x
  — do NOT run it. Accepted for the pilot (build-time only, no custom
  CSS, no self-hosted image optimization); revisit before production.
- `pdfjs-dist` must stay on 5.6.205 — pdf-to-img bundles that exact
  version and pdfjs throws "API version does not match Worker version"
  otherwise. Keep them deduped.
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
