# Arik orientation report, 2026-10-14

Read-only orientation. No code was changed or committed. Based on README, AGENTS.md, ARIK_MASTER_SPEC.md (sections 1-7 and the module criteria), HANDOFF.md headings, docs/ headings, the latest audit (docs/status/AUDIT_2026-10-05.md), file headers, `git log`, `npm test` and `scripts/validate_repo.py`.

Not run this session: `npm run build`, smoke scripts, evals (they need a running database, a dev server or paid model calls). Those claims below come from the 2026-10-05 audit and commit messages, not from me.

## 1. What Arik is

Arik is a patient's money advocate for healthcare. You tell it which drug you need and your situation, and it finds the cheapest legal way to get it: cash price, manufacturer programs, discount cards, state law protections. It shows the source for every answer. Its one firm rule is that it takes no money from drug companies, PBMs or discount networks, so nobody can pay to be ranked higher. Bills and insurance denials are the next planned area.

## 2. What it does today (from code and tests)

- **Drug-cost chat, one thread per case.** A cheap model pulls facts out of the message (drug, plan type, location). Plain database queries fetch matching programs and prices. A ranking engine picks the cheapest option over 3 to 12 months. A second model writes only the explanation. Code builds the source receipt and checks every number and program name against the retrieved data, regenerating once and falling back to a fixed answer if the check fails.
- **Safety short-circuits in code:** no data means a fixed "no data" answer; off-topic messages get a redirect; crisis language switches out of task mode; Medicare/Medicaid patients never see drugmaker copay cards (anti-kickback rule).
- **Cases:** create, status workflow with illegal moves blocked, deadlines (an honest "no rule" if none applies), outcome confirmation.
- **Profile:** facts remembered across messages, contradictions held for one-tap confirm, English/Spanish, plan type selector, caregiver access to managed patients.
- **Documents:** PDF/image/HEIC upload with text extraction (bills/EOBs only), 25 MB cap.
- **Privacy:** encrypted identity fields, consent ledger, full account deletion, 48-hour raw upload purge, 90-day case purge.
- **Auth:** anonymous-first sign-in; every API route requires a session and checks case ownership.
- **Pricing pipeline:** source adapter contract, a NADAC (government benchmark) adapter, an ingest runner, and consent/staleness gates so barred prices never reach patients or model prompts. NADAC is shown as "what pharmacies pay" and never ranked.
- **Ops:** `/api/health`, Docker container, a one-command local database rebuild (`npm run db:reset`).
- **Data depth is thin:** about 17 drugs and 21 programs seeded.

**Tests run today:** `npm test` passed 12/12 suites, 0 failures. `validate_repo.py` reports **2 failures**, 5 warnings (see section 5).

## 3. How it's built

- **App:** Next.js 16 (App Router, TypeScript) under `app/`. Thin pages plus API routes. `proxy.ts` refreshes the login cookie and signs new visitors in anonymously.
- **Logic:** `lib/`. The pattern is a function with no database access that makes the decision (each has a `scripts/test_*.ts` suite), wrapped in a small database loader.
- **Database:** Supabase Postgres. `schema.sql` (38 tables) plus migrations `db/002` to `db/024`, with untracked `db/025` (see section 5). Row-level security on every table, pgcrypto for identity, pg_cron for purges.
- **AI:** OpenRouter only (`lib/callModel.ts`, `lib/modelConfig.ts`): Haiku 4.5 for extraction, Sonnet 5.5 for responses. Hard timeouts, no silent model upgrades. Models never make decisions.
- **Pricing:** `lib/pricing/`. Adapter, then normalized rows, then the `price_sources` consent flags, then ranking.
- **Agent (Arik Agent, M16):** not built. The spec calls it core product starting in S3. No action registry, approvals or receipts exist yet.
- **Hosting:** a Vercel demo (arik-liard.vercel.app) and local Docker. AWS is a plan only (`infra/aws/README.md`).

## 4. Where it stands against the plan

| Stage | Status | What's missing |
| --- | --- | --- |
| S1 Demo-ready | **Done** (audit 100%, tag `s1-demo-ready`) | Nothing for the gate. The recorded walkthrough from the stage goal isn't evidenced in the repo. |
| S2 Partner-ready | **Partial** (~40%) | Partner layer (M07 AC1-6: hardened HTTP client, mock partner API, chat fallback, disable/purge commands, no-leak logs). Quote mode. Pharmacy distance ranking. Duplicate-card collapse. `db/025` (pharmacies, ingest-run audit) is written but untracked, and no code uses it. |
| S3 Denials and bills v1 | **Not started** (~6%) | Bill checks, denial engine, letters, Arik Agent v1, legal/clinical scope tests, onboarding legal notice. Only doc-intake pieces exist. |
| S4 Pilot-ready | **Not started** (~7%) | BAA AI provider, rate limits, security headers, malware scanning, backups, CI, logging without health data, AWS hosting, privacy/terms, data export. |
| S5 Acts for you + insurance | **Not started** | Insurance card/PBM lookup, knowledge base loaders, fax/mail channel, authorization forms. Plan type is the only piece. |
| S6 Connected | **Not started** | Record connections, formulary match, price reliability loop. `pharmacy_used` is captured, nothing more. |
| S7 Business-ready | **Not started** | Fee ledger, $50 cap, guarantee, employer plans. |

**Modules:**
- **Mostly done:** M01, M02, M04, M06.
- **Half done:** M05, M17, M22.
- **Thin:** M03, M08, M09, M14, M18, M20, M21.
- **Zero:** M07 (code), M10, M11, M12, M13, M15, M16, M19.
- **M23 to M25 don't exist in the spec.** They appear only in RUN_ORDER.md and rx_routing_build.md, which say to add them.

## 5. Problems I noticed

1. **Repo gate is red.** `validate_repo.py` fails because RUN_ORDER.md points to `free_data_loaders.md` and `true_cost_reach.md`, which don't exist. AGENTS.md says no app code until this is 0 failures.
2. **Kimi files are in the wrong place.** RUN_ORDER.md says it belongs in `docs/kimi/`, but that folder doesn't exist. There are two different untracked copies, `rx_routing_build.md` and `rx_routing_build(1).md`. They disagree on which stage gates partner routing.
3. **`db/025` is untracked and unverified.** RUN_ORDER says the last S2 run stopped right after writing it. No code reads `pharmacies` or `ingest_runs`, and I can't tell whether it was applied anywhere.
4. **Public demo cost exposure.** The Vercel alias signs anyone in anonymously, chat calls paid models, and there is no rate limiting (M01-AC7). Anyone can run up the OpenRouter bill.
5. **Not safe for real patient data yet, as designed.** OpenRouter has no BAA. There is no malware scan on uploads (a known deferred gap). There are no security headers. Document extraction coerces bad output instead of rejecting it (audit, M09-AC3).
6. **Docs disagree with each other or the code:**
   - AGENTS.md opens with "no live Arik database yet," then says project `iwayoxmpbueneagdkpzj` "is live." The spec says the database project "lapsed." I can't tell which is true.
   - Table count: HANDOFF.md and the spec say 36 tables; schema.sql and AGENTS.md say 38.
   - README.md still says "not a runnable app" (HANDOFF flags its own copy of that claim as stale).
   - The spec's per-module "Status" lines (for example, M01 "all MISSING") predate the work. Use the audit instead.
   - The audit header names commit 207d6c9 but describes later commits, and it says `npm test` is 11/11 (now 12).
   - AGENTS.md says the auth guard test is "33 checks"; the audit says 49/49.
   - The audit mentions `DENIAL_ENGINE_V1.md`, which is not in the repo. The S3 denial prompt depends on it.
7. **Smaller loose ends:**
   - The Supabase edge function deploy is blocked (wrong account binding).
   - 3 high `npm audit` findings are accepted for the pilot.
   - `dev-server.err.log` sits untracked at the repo root.
   - `scripts/dogfood_profile_run.mjs` is untracked and hardcodes one real-looking patient profile (uninsured, Missouri, 0% FPL). It has no identifiers, but decide whether to keep it.
   - `CLAUDE.md` is new and untracked (created in an earlier step of this session by `/init`).
8. **Secrets:** none found in tracked files. `.env.local` and `.env.remote.backup` exist locally and are gitignored; the backup presumably holds remote credentials.
9. **Partner confidentiality:** no partner is named anywhere. The only partner mentions are generic, in ARIK_MASTER_SPEC.md, RUN_ORDER.md, both rx_routing_build files and the audit. No `.confidential-terms` file exists, so that check from RUN_ORDER Phase 0 couldn't run.

## 6. What to do next (priority order)

1. **Get the gate green and the tree clean (small).** Create `docs/kimi/`, move RUN_ORDER.md and the correct rx_routing_build into it, delete the other copy, add or remove the two missing file references, and commit `db/025` after testing it on the local stack. Nothing else should start on a red validator.
2. **Rate-limit chat and uploads, and add security headers (M01-AC7/8, small).** These are S4 items, but the public demo is open to cost abuse today. I'd move this ahead of RUN_ORDER item 2.
3. **Finish S2 (RUN_ORDER item 1).** Wire `db/025` into code (ingest-run audit rows, pharmacy matching, card-processor collapse, disable/purge commands), then build the M07 partner layer against the mock: hardened client, mock API, quote mode with chat fallback, no-leak log test.
4. **Drug data depth (RUN_ORDER item 2).** 17 drugs is the biggest demo gap. Top-200 Part D drugs plus NADAC as a benchmark.
5. **Start S3 instead of the installable web app.** I'd change RUN_ORDER here. It puts the PWA (M23, not in the spec) at #5 and AWS prep at #4, and it never schedules bill review or the denial engine (spec Appendix B3/B4), even though the spec says S2 and S3 run in parallel. I'd put Arik Agent v1 (item 6) and bill review phase 1 ahead of the PWA. AWS prep is blocked on your IAM user anyway.

## 7. Questions for you

1. Which `rx_routing_build` copy is the right one (does live partner routing gate on S3 or S5)?
2. Do `free_data_loaders.md`, `true_cost_reach.md` and `DENIAL_ENGINE_V1.md` exist somewhere I can't see?
3. Is the Arik Supabase project (`iwayoxmpbueneagdkpzj`) live or lapsed, and is the Vercel demo still meant to be public?
4. Should M23 (installable app), M24 (prescription routing) and M25 (true cost) be added to ARIK_MASTER_SPEC.md now?
5. Is leaving S3 (bills/denials) out of the work queue deliberate?
6. Spec 2.1 partner display policy: confirmed or still pending?
7. Has the non-root AWS IAM user been created (prerequisite for RUN_ORDER item 4)?
8. Keep or drop `scripts/dogfood_profile_run.mjs`?
