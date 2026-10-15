# Arik next-phase plan, 2026-10-14

Plan only. Nothing here is built yet. Based on `docs/status/orientation.md` (same day), `RUN_ORDER.md`, the stage gates in `ARIK_MASTER_SPEC.md` (section 6, Appendix A, Appendix B3) and `rx_routing_build(1).md`.

**Files not where the prompt expected them:**
- `docs/kimi/` still doesn't exist. RUN_ORDER.md and both rx_routing_build copies sit at the repo root.
- `free_data_loaders.md`, `true_cost_reach.md` and `DENIAL_ENGINE_V1.md` are not in the repo. Plans for RUN_ORDER items 3, 9 and 10 and for the denial engine (B4) can't be made from them.

**Two facts checked today:**
- **The public demo is live.** `https://arik-liard.vercel.app/` returns 200, and `/api/health?db=1` returns `status: ok, database: ok`. The hosted database behind it is up, so the spec's "database project lapsed" is out of date. Health reports `version: unknown`: `APP_VERSION` isn't set on Vercel, so we can't tell which commit the demo runs.
- **The AWS CLI is not installed on this machine,** and `%USERPROFILE%\.aws` was empty before today. The new `arik-ai` profile points at `source_profile = arik-ryan`, which isn't defined anywhere yet.

---

## A. Where the most lift is

Ranked by impact on (1) an investor and first-employer demo and (2) unblocking later work, against effort.

| # | Work | Demo | Unblocks | Effort | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Get the repo gate green, commit `db/025`, set `APP_VERSION` | Low | High | S | Every Kimi session stops on a red validator. `db/025` is the S2 foundation the routing and pharmacy work sit on. |
| 2 | Rate limits on chat/upload/cases-start + security headers (M01-AC7/8) | High (protective) | Medium | S | The demo link is public, anyone gets an anonymous login, and chat calls paid models. One shared link could run up the bill or get the demo pulled mid-pitch. These are S4 items anyway. |
| 3 | Drug data depth: top 200 Part D drugs by spend + NADAC as a broad benchmark (RUN_ORDER #2) | Very high | Medium | L | 17 drugs means most investor test queries hit "no data." This is the single biggest demo gap. |
| 4 | Letter engine + itemized-bill request letter + legal footer + onboarding legal notice (M12-AC1/AC3, M10-AC4, M18-AC1) | High | Very high | M | A "Arik wrote the letter for you" moment. The itemized-bill request is the free-tier promise, and the same engine is reused by bill review, denials, routing requests and the Agent. |
| 5 | Bill review Part A: deterministic checks + NCCI/MUE importer (Appendix B3 Part A) | High (employer) | High | M–L | Employers care about medical bills more than one-off drug prices. No AI and no decisions needed, and every check cites a rule. |
| 6 | AI provider interface, OpenRouter + Bedrock, selected by env (M04-AC2) | None | Very high | M | It is the only code change standing between the app and a BAA-covered AI path. It is needed before any AWS staging run uses Bedrock. |
| 7 | AWS staging infrastructure as code, synth only + runbook (RUN_ORDER #4, M20) | Low now | Very high | M | Starts the pilot track. See section D. |
| 8 | Arik Agent v1: action registry + per-case plan + approval screen + receipts (M16-AC1–8) | High | Very high | L | Prescription routing (M24) and enrollments depend on it. It is larger than one session; split into registry/plan first, then approval/receipts. |

Lower lift for now:
- **M07 partner layer against the mock:** finishes S2, but has no demo value until a partner signs.
- **M24 DTC programs:** a strong investor story, but the price data has to be filled in by hand by Ryan.
- **The installable web app (M23):** it isn't in the spec, and the web link already demos fine.

---

## B. What can be built today (no decision from Ryan needed)

Each item fits in one Claude Pro session unless marked. Sizes: S = under an hour of agent work, M = a full session, L = more than one session.

### B1. Gate green + tree tidy (S)
- **What:**
  - Fix the two validator failures: stop RUN_ORDER.md pointing at files that don't exist by marking those items "prompt file pending" rather than deleting them.
  - Test `db/025` on the local stack (`npm run db:reset`, `db:check`) and commit it.
  - Add `APP_VERSION` to the build so `/api/health` shows the commit.
  - Moving files into `docs/kimi/` waits on question C1.
- **Files:** `RUN_ORDER.md`, `db/025_pharmacies_ingest_runs.sql`, `scripts/db_check.mjs` (expected counts), `.env.example`/`lib/env.ts` if `APP_VERSION` needs a note.
- **Done when:** `python scripts\validate_repo.py` shows 0 failures; `npm run db:reset` and `npm run db:check` show the `pharmacies` and `ingest_runs` tables with RLS on; `npm test` passes 12/12; `npm run build` is green.

### B2. Rate limits + security headers (S–M)
- **What:**
  - A Postgres-backed fixed-window limiter (new table plus one function; no new vendor), applied through `lib/apiAuth.ts` to chat, documents and cases/start. It returns 429 with `Retry-After`.
  - CSP, HSTS, `frame-ancestors`, `X-Content-Type-Options` and `Referrer-Policy` set in `next.config.ts`.
- **Files:** `db/026_rate_limits.sql`, `lib/rateLimit.ts`, `lib/apiAuth.ts`, `next.config.ts`, `scripts/test_rate_limit.ts`, `scripts/test_auth_guards.ts` (429 case).
- **Done when:** the pure limiter tests pass (window edges, per-user keys, anonymous users limited too); the auth guard suite shows 429 after N calls; `curl -I` on the local server shows the headers; `npm run build` is green.

### B3. Drug data depth, top 200 (L, two sessions)
- **What:**
  - A loader for the CMS Medicare Part D Spending by Drug dataset (top 200 by total spending) and the FDA NDC Directory, for NDC matching. Unmatched NDCs are flagged, never guessed. Every drug links to a `sources` row.
  - NADAC loaded for those drugs as a labeled benchmark through the existing adapter.
  - Session 1: loaders + fixture tests. Session 2: real files + spot check.
- **Files:** `scripts/load_partd_top_drugs.ts`, `scripts/load_fda_ndc.ts`, fixtures in `scripts/fixtures/`, `scripts/test_drug_loaders.ts`, possibly `db/027_drug_ndc_map.sql`.
- **Done when:** 200 drugs are loaded, each with a `source_id`; the unmatched list is printed; a spot check of 10 random drugs matches the FDA directory; `test_ranking.ts` test 11 still proves NADAC never ranks; `eval_ranking.ts` stays 12/12.
- **Note:** the real files are public government downloads, but fetching them is a network step. Either Ryan downloads them or approves the agent fetching them, with timeouts.

### B4. Letter engine + itemized-bill request + notices (M)
- **What:**
  - A plain-text-to-PDF engine writing to `output_documents`. Generating a letter creates `deadlines` rows.
  - The itemized-bill request letter.
  - The exact footer: "Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice."
  - An onboarding legal notice, with acceptance recorded under `legal_notice` in `consent_ledger` via `lib/consent.ts`.
- **Files:** `lib/letters/engine.ts`, `lib/letters/templates/itemizedBillRequest.ts`, `app/api/cases/[id]/letters/route.ts`, the onboarding component under `app/`, migration for the `legal_notice` category if the enum needs it, `scripts/test_letters.ts`.
- **Done when:** a test proves no number, date, name or deadline appears unless it is in the confirmed record (M12-AC2); a footer string test passes; the letter creates a deadline row; the consent ledger row is written; the auth guard suite covers the new route.
- **Open:** the full onboarding notice text lives in spec Appendix B4 Part B step B4. If it is incomplete there, it becomes a C item.

### B5. Bill review Part A (M–L)
- **What:**
  - A bill header and line-item migration with RLS.
  - Five checks in `lib/rules/bills/`: duplicates, date outside the admission window, room-day count, MUE units, NCCI pairs.
  - An NCCI/MUE importer from a local path that records the file version on every finding.
  - A Medicare fee schedule importer, shown as context only.
  - The `CPT_DISPLAY_ENABLED=false` flag.
- **Files:** `db/02x_bill_line_items.sql`, `lib/rules/bills/*.ts`, `scripts/import_ncci.ts`, `scripts/import_mpfs.ts`, `scripts/test_bill_checks.ts`, fixture subsets.
- **Done when:** every check has unit tests, including same-day admit/discharge, midnight crossing and leap years; findings carry citation and file version; a test proves no CPT descriptor is output with the flag off.

### B6. AI provider interface (M)
- **What:** `AI_PROVIDER=openrouter|bedrock`. The existing OpenRouter path is moved behind an interface, and a Bedrock adapter is added (Converse API with an explicit timeout). No silent fallback between providers; a misconfigured provider fails loudly.
- **Files:** `lib/callModel.ts`, `lib/modelConfig.ts`, `lib/ai/openrouter.ts`, `lib/ai/bedrock.ts`, `lib/env.ts`, `scripts/test_ai_provider.ts`; `package.json` (adds `@aws-sdk/client-bedrock-runtime`, exact pin).
- **Done when:** fixture tests with no network cover provider selection, timeout, error mapping and usage logging for both; `test_callmodel_timeout.ts` still passes; `eval_responses.ts` on OpenRouter is unchanged. A live Bedrock check waits on C5.

### B7. AWS staging IaC, synth only (M)
- **What:**
  - A CDK app with one EC2 instance, encrypted EBS, an instance role (SSM, the backup bucket, Bedrock invoke), the S3 backup bucket, SSM parameter names (no values), a CloudWatch log group and alarm, and a security group with 443/80 only.
  - The `docker-compose.prod.yml`, Caddyfile and `load_secrets.sh` from Appendix A.
  - A one-page runbook. No deploy.
- **Files:** `infra/aws/cdk/*`, `infra/aws/docker-compose.prod.yml`, `infra/aws/Caddyfile`, `infra/aws/scripts/load_secrets.sh`, `docs/aws_staging_runbook.md`.
- **Done when:** `cdk synth` passes locally; a grep shows no secrets in templates; no em dashes in resource names.
- **Prerequisite:** none for synth itself, but see D on bootstrap permissions.

---

## C. Needs more figuring out before building

| # | Question for Ryan | Who else could answer | Blocks |
| --- | --- | --- | --- |
| C1 | Which `rx_routing_build` copy is correct? Does live partner routing gate on S3 or S5? | Nobody; it's your spec | Moving files into `docs/kimi/`, M24 spec update |
| C2 | Where are `free_data_loaders.md`, `true_cost_reach.md` and `DENIAL_ENGINE_V1.md`? | Whoever wrote the Kimi prompts | RUN_ORDER items 3, 9, 10 and the whole denial engine (B4) |
| C3 | Who is the demo for, and which journeys must it show? For example: drug price only, or drug + bill + letter; which drugs an investor or employer will type. | Your advisor or the first employer contact | The order of B3, B4 and B5 and which drugs to load first |
| C4 | Should the Vercel demo stay open to anyone, or move behind a shared passcode until rate limits ship? | Nobody | How urgent B2 is |
| C5 | AWS: is the BAA accepted in AWS Artifact? Is Bedrock model access granted in us-east-1 for the Claude models we use? How large are the credits and when do they expire? | AWS console (Artifact, Bedrock model access, Billing credits) | Any live Bedrock call, the staging deploy, cost math in D |
| C6 | Can `ai-admin` create IAM roles and run `cdk bootstrap`? Bootstrap creates roles and an S3 bucket. Also, RUN_ORDER says alarms tie to the existing budget, but `ai-admin` cannot change budget settings. | Whoever set up the `ai-admin` policy | Deploying B7 (synth works without it) |
| C7 | Partner display policy (spec 2.1): confirmed or still pending? | Counsel; the partner's data use agreement | Showing any partner price; the M07 real adapter |
| C8 | Which DTC programs exclude government-insured patients, and will you fill the `dtc_programs` CSV by hand? | Manufacturer program terms; counsel | M24 Part A having real data |
| C9 | No Surprises Act thresholds and deadlines: do you have citations, or should the letter ship with values marked UNVERIFIED? | Health billing expert, counsel | The NSA dispute letter in B3 Part B |
| C10 | Should M23 (installable app), M24 (routing) and M25 (true cost) be added to the spec now? | Nobody | Validator references; audit scoring |
| C11 | Domain name for the AWS staging and pilot site. | Nobody | TLS / Caddy in the staging deploy |
| C12 | Malware scanner: is ClamAV on the server OK, or do you want a managed scanner? | Security reviewer | M09-AC2 (S4 gate); uploads must fail closed in production without it |

---

## D. AWS timing

**Recommendation: stand up a small AWS staging slice now (synthetic data only) and grow it as features land. Keep the Vercel link as the investor demo until staging matches it, then cut over once. Don't do the whole move at the end.**

Why:
- **Investor demo link:** Vercel plus hosted Supabase works today (health 200, database ok). There's no reason to risk it. It stays the demo link through the next few sessions.
- **Move-later risk is high:**
  - Self-hosted Supabase is not identical to hosted: auth settings including anonymous sign-ins, Storage, pg_cron/pg_net, edge functions.
  - The pdf-to-img native canvas dependency is built for glibc, and a Graviton (t4g, ARM) instance needs ARM builds of it, which is unverified.
  - Bedrock has its own model IDs and request format.
  - Finding all of that in one go at pilot time is the worst moment. A staging slice surfaces each problem while it's small.
- **Cost against credits:** Appendix A estimates $60 to $150/month for the full setup. A staging slice (one ~4 GB instance, a small encrypted disk, a backup bucket, logs) sits at the low end of that, and can be stopped when not in use. Bedrock is pay per token at prices similar to direct. Check the credit balance and expiry (C5) before deploying.
- **Docker setup:** the container already builds, runs as non-root and passes its health check against the local stack. Staging is mostly the self-hosted Supabase compose, Caddy and secrets from SSM, not new app work.
- **OpenRouter to Bedrock:** this needs the provider interface (B6) whatever the timing. Staging is where it gets exercised for real, with synthetic data, before any patient data exists.
- **Patient data rule:** unchanged. Staging holds fixtures and synthetic data only. Real patient data waits for every item in the Appendix A readiness checklist (the S4 gate). Starting now just means those items (backups, TLS, Postgres not public, logs without PHI) get built on the real host instead of guessed at.

**First 3 steps:**
1. **Ryan, about 20 minutes:**
   - Install AWS CLI v2 (a recent version that has `aws login`).
   - Run `aws login --profile arik-ryan`, then `aws sts get-caller-identity --profile arik-ai` and check that it shows the `ai-admin` role.
   - In the console, confirm the BAA in Artifact, request Bedrock access to the Claude models in us-east-1, and note the credit balance (C5, C6).
2. **Agent session:** the AI provider interface (B6), so OpenRouter and Bedrock are swappable by env and fully tested with fixtures. No AWS calls needed.
3. **Agent session:** staging IaC with `cdk synth` and the runbook (B7). Then Ryan approves the deploy in a later session, the database flow is applied to the server, and `/api/health?db=1` returns 200 on staging with synthetic data.

---

## E. Suggested order for the next 3 sessions

1. **Session 1, gate + protect the demo:** B1 (gate green, `db/025` committed, `APP_VERSION`) and B2 (rate limits + security headers). Small, decision-free, and they protect the link you'll be sending to investors. Before this session, answer C1 and C4 if possible; B1 works without C1 except for the file move.
2. **Session 2, drug data depth:** B3 session 1 (loaders + fixture tests); session 2 of B3 lands the real files at the start of session 3 if needed. Answer C3 first so the most-demoed drugs are confirmed in the top 200.
3. **Session 3, AWS foundations:** B6 (AI provider interface) and, if time allows, B7 (staging synth). This assumes you did D step 1. If you haven't, swap in B4 (letter engine + itemized-bill request) and do AWS in session 4.

After that: B4, then B5 (bill review Part A), then M16 Agent v1 in two sessions, then M24 Part A once the DTC data (C8) exists.

**Changes to RUN_ORDER this implies:**
- Rate limits/headers move up to the front.
- M07 partner mock work (the rest of RUN_ORDER #1) drops behind drug data, because it has no demo value until a partner signs.
- The PWA (#5) drops behind the letter engine, bill review and Agent v1.
- AWS prep (#4) stays roughly where it is, but is preceded by the provider interface.
