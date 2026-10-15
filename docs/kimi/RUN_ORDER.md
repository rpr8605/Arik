# Kimi: Arik run order (use at the start of every credit session)

**Owner:** Ryan Russell
**Date:** 2026-10-13
**Put this file at:** `docs/kimi/RUN_ORDER.md`
**Use:** Paste "Follow docs/kimi/RUN_ORDER.md. Budget this session: $__" at the start of each session.

This file sets the order of work. Each item points to the prompt or spec section that holds the details. Read those only when you reach that item.

---

## Credit rules (apply to everything)

- **Plan before building.** Phase 0 below costs little. Never start building in the same step as planning.
- **Read narrowly.** Use `git log`, `git diff --stat`, `grep -n`, `head`, and line ranges. Never read a whole large file unless you are editing it. Never re-read a file you just wrote.
- **Batch commands.** One shell call per logical step, not one per file.
- **Quiet output.** Tests, builds and installs report pass/fail counts and the first failing assertion only. No full logs.
- **No re-work.** If something already passes its acceptance test, mark it done and move on.
- **Stop early.** Stop and report if an item goes over its size estimate by half, a step runs over 4 minutes, or the same error repeats twice.
- **Report short.** Under 10 lines per item: what changed, tests, anything UNVERIFIED, next item.

## Standing rules

- Work locally, small commits, **never push** unless Ryan says so. **Never deploy** unless an item says so and Ryan approves in that session.
- **Partner confidentiality.** Never write a partner's name, terms, prices or API details in the repo, commits, fixtures or logs. If a file named `.confidential-terms` exists locally (untracked), grep the repo for every term in it during Phase 0 and report any hits without printing the terms.
- **No money from routing or pricing sources, ever** (spec hard rules, M24).
- **Secrets:** only in env vars or AWS SSM Parameter Store. Never print, log or commit them.
- **AWS:** infrastructure as code only (CDK or CloudFormation). Never use root credentials. No em dashes in AWS resource names or descriptions.
- **AWS:** always use --profile arik-ai. Never use root or a personal admin profile. ai-admin cannot delete resources, change audit or budget settings, or create logins or keys; if a task needs one of those, stop and ask Ryan.
- **Never invent data.** Templates and marked fixtures only.

---

## Phase 0: Intake and plan (do this every session, then STOP)

1. `git status`, `git log --oneline -15`, and list files changed or added since the last session's report, including untracked `.md` files in the repo root and `docs/`.
2. For each **new** `.md`, read only its title, its "Put this file at" line, and its section headings. Note it if it changes the order below.
3. Check the status of each work queue item from its acceptance tests or spec criteria, not by reading code: **done**, **partial** (say what's left) or **missing**.
4. Output a table: item, status, size (S = under $3, M = $3 to $8, L = over $8, rough), and what you will do this session within the stated budget. If no budget is given, plan exactly one item.
5. **STOP and wait for "go."**

---

## Work queue (in order of importance)

Do items in this order. Skip anything already done. Never start an item whose prerequisites are missing; report it and move to the next.

### 0. Housekeeping and abuse protection (small, do first)
- Repo gate green: `validate_repo.py` passes. Every prompt lives in `docs/kimi/`; only one copy of each.
- Test `db/025` on the local stack, then commit it.
- Rate-limit the chat and upload routes, and put a hard daily cap on paid model calls for anonymous users, because the public demo can run up the model bill today (moved up from S4).
- Fix README.md so it describes the app as it is today.

### 1. Finish S2 pricing ingestion (M05, M06)
- **Why first:** everything else (data loaders, routing, the true-cost engine) sits on these tables and adapters.
- **Source:** spec Appendix B2 Part A. The last S2 run stopped after the `db/025` migration (committed in item 0). Pick up from there: per-run `ingest_runs` audit rows, pharmacy matching, quote mode, duplicate-card collapse, pharmacy distance.
- **Done when:** all S2 criteria in M05 and M06 pass. The M07 partner-readiness criteria are item 7, after Agent v1.

### 2. Drug data depth (biggest demo gap)
- **Why:** the demo only covers 17 drugs.
- **Do:**
  - Load NADAC broadly as a benchmark (already an S2 adapter).
  - Expand `drugs` to the top 200 drugs by total spending in the CMS Medicare Part D Spending by Drug dataset, with NDCs matched from the FDA NDC Directory.
  - Unmatched NDCs are flagged, never guessed.
- **Done when:**
  - The 200 drugs are loaded, each linked to its source row.
  - A spot check of 10 random drugs shows correct NDC matches.
  - NADAC is still labeled as a benchmark, never a patient price.

### 3. Free data loaders, Part A (denial stats and prior-auth metrics)
- **Source:** `docs/kimi/free_data_loaders.md`, Part A only.

### 4. AI provider switch + AWS staging (M04-AC2, M20), prepare only
- **AI provider switch first:** `AI_PROVIDER=openrouter|bedrock`, OpenRouter stays the default. Bedrock adapter built and fixture-tested so it can be turned on later; Bedrock model access is not approved yet, so no live Bedrock calls.
- **Prerequisite:** the `arik-ai` profile works (`aws sts get-caller-identity --profile arik-ai` shows `ai-admin`). If not, do the provider switch only and say so.
- **Do:**
  - Write the CDK for staging: t4g.medium, encrypted EBS, secrets from SSM, CloudWatch logs.
  - Cost alarms: new CloudWatch alarms defined in the CDK code. Never edit the existing budget (`ai-admin` cannot change budgets or delete stacks, by design).
  - Write a one-page deploy runbook in `docs/`.
  - Synth and validate locally.
  - **Do not deploy.** Ryan approves the deploy in a later session.
- **Done when:** provider tests pass with OpenRouter still the default, synth passes, the runbook exists, and no secrets are in the templates.

### 5. Arik Agent v1: action registry and approvals (M16 AC1 to AC8)
- **Why here:** prescription routing (items 9 and 10) needs the action registry.
- **Rule:** prepare and track only. Nothing leaves the system in v1.

### 6. Bills and denials, first pass (M10, M11; spec Appendix B3 and B4)
- **Why:** S3 in the spec runs bills and denials alongside the Agent; they are half of Arik's pitch.
- **Source:** ARIK_MASTER_SPEC.md Appendix B3 (bill review) and Appendix B4 (denial engine v1). Build the S3 criteria only.

### 7. Partner-ready adapter, against the mock only (M07)
- **Source:** spec Appendix B2 Part B: hardened HTTP client, config-driven adapter template, local mock partner API, chat fallback, disable/purge commands, no-leak logs.
- **Done when:** all S2 criteria in M07 pass, except M07-AC8 (the real partner adapter, which lives in a private repo later).

### 8. Installable web app (M23 AC1 and AC2)
- **Do:**
  - PWA manifest, service worker, and an install prompt.
  - Push reminders that carry no patient details.

### 9. Prescription routing, Part A (M24)
- **Source:** `docs/kimi/rx_routing_build.md`, Part A.
- **Covers:** drug-maker direct prices, the cash-vs-insurance rule, and routing and transfer requests.

### 10. Prescription routing, Part B, against the mock only (M24)
- **Source:** `docs/kimi/rx_routing_build.md`, Part B.
- **Covers:** the neutral routing adapter, the database rule that compensation to Arik can only be "none", the neutrality test, and the disclosure page.
- **Rule:** every routing partner stays `enabled = false`. Live routing waits for S5.

### 11. Free data loaders, Part B (Medicare coverage rules)
- **Source:** `docs/kimi/free_data_loaders.md`, Part B.

### 12. True cost and reach (M25), only when its prompt exists
- **Source:** a prompt Ryan will add to `docs/kimi/` named for M25 (true cost and reach).
- **Covers:** distance gating, mail order and shipping, the total cost of getting the drug, and multi-drug plans.
- **Rule:** if that prompt isn't there, skip this item.

## Not now (do not start, even with spare credits)

- The real partner adapter, or turning on live routing. These need S4 security, a signed data use agreement and the partner's docs, and they live in the private repo.
- Deploying anything to AWS without Ryan's approval in that session.
- Switching the default AI provider to Bedrock until Ryan confirms Bedrock access is approved (building the switch is item 4).
- App Store and Google Play builds (M23 AC3 and up).
- Arik prescribing, or connecting directly to an e-prescribing vendor.

## Spare credits

If the budget allows more after the planned items, use what's left on, in this order:

1. Failing or missing tests in finished items.
2. Updating the **Status** lines in ARIK_MASTER_SPEC.md to match reality, then running the validator.

Never start a new L-size item with less than its estimate remaining.

## End-of-session report (always)

- Items done or partial this session
- Tests: pass/fail counts
- Commits made (hashes only)
- Anything UNVERIFIED or blocked, and what Ryan needs to do
- The suggested first item for next session
