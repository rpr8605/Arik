# AGENTS.md — Arik

Patient-facing healthcare-cost advocate ("anti-GoodRx" for drug pricing +
bill/denial fights). Supabase Postgres brain + thin Next.js frontend.
The repo is now a **spec + early app**: Next.js 16 (App Router, Turbopack)
+ TypeScript strict scaffold exists at repo root, but there is no live
Arik database yet — see "Supabase target project" below.

## Gate before any application code

1. `python scripts\validate_repo.py` must pass with 0 failures (script
   lives in `scripts/` — it resolves paths relative to its own location,
   so it fails spuriously if moved back to repo root).
2. `npm run build` must stay green (compiles + type-checks all routes).
3. Complete `PRE_BUILD_CHECKLIST.md` and report findings to the user.
   Last full review: 2026-07-24 (passed; findings repaired same day).

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
`db/005_can_access_case_security_definer.sql` (or `scripts/apply_db.mjs`
then `scripts/run_sql.mjs` for 004/005).

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

- Model router: shares the MIST project's OpenRouter setup — config lives
  with the user, not in this repo; ask for it when wiring `callModel()`.
- Identity encryption: pgcrypto at the application layer (no external vault).
- MTM cost threshold: $1,276 for 2026, verified against CMS CY2026 MTM
  memo; re-verify annually. Plans may set lower thresholds — present as
  "likely eligible," never a hard boolean.

## Key files and their status

- `schema.sql` — 27 tables, single source of truth for the DB. Apply
  first on a fresh project.
- `db/002_identity_crypto.sql` — pgcrypto extension + `encrypt_identity`/
  `decrypt_identity` helpers (service-role only). Widens
  `user_identity.date_of_birth` to text (ciphertext is text).
- `db/003_rls_policies.sql` — RLS on all 27 tables + `can_access_case()`
  helper. Reference data = authenticated read; user data = owner/caregiver.
- `app/api/chat/route.ts` — the chat route draft. Client creation is lazy
  (module-level clients crash Next builds). `callModel()`/
  `loadSystemPrompt()` are typed stubs. Known warts to fix when wiring:
  brand match is case-sensitive, no `JSON.parse` guard, user message
  interpolated raw into the extraction prompt.
- `lib/` — core infrastructure modules (built 2026-07-24):
  - `cases.ts` — case CRUD + status workflow; illegal transitions throw
    (`IllegalTransitionError` → 409 at the API layer). Guard is the pure
    `assertLegalTransition()` — tested by `scripts/test_transitions.ts`.
  - `deadlines.ts` — deadline engine. Rules carry `basis` text; unverified
    rules store `source_id`/`last_verified_at` null; no matching rule →
    honest `no_rule` result, never a guessed deadline.
  - `identityCrypto.ts` — the ONLY encrypt/decrypt paths for
    `user_identity`. `decryptIdentityForForm()` is for form generation
    only; everything else uses `readIdentityMasked()` (booleans, never
    values).
  - `caregivers.ts`, `privacy.ts` (full deletion cascade + per-category
    demographic clearing), `outcomes.ts` (patient-confirmed only).
  - `mtm.ts` — MTM eligibility, pure `computeMtmEligibility()` (tested by
    `scripts/test_mtm.ts`) + DB loader `computeAndStoreMtmCheck()`.
  - `supabaseAdmin.ts` — lazy service-role client; server-only.
- `scripts/` — `validate_repo.py` (structural gate), `apply_db.mjs`
  (fresh-project schema apply + verify), `run_sql.mjs` (apply one file),
  `smoke_rls.mjs` (RLS cross-user tests, needs fixture users in
  auth.users — self-cleaning), `seed_drugs.mjs`, `check_seed.mjs`,
  `test_transitions.ts`, `test_mtm.ts`. Node scripts read `.env.local`.
- `app/api/` — thin route wrappers: `cases`, `cases/[id]` (GET/PATCH
  transition), `cases/[id]/deadlines`, `identity` (masked GET/PUT only),
  `managed-patients`, `privacy` (DELETE all / PATCH clear category),
  `outcomes`. Each carries an AUTH NOTE: userId comes from the request
  until Phase 1 wires Supabase auth — do not deploy publicly before then.
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
