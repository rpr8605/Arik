# Arik Health — Drug Bundle Build Ticket (for Kimi / OpenCode)

**Purpose of this doc:** Everything Kimi needs to build the "beat GoodRx" drug bundle system for Arik Health, without re-deriving the architecture from scratch. Read this in full before touching code. Read `CASE_MODEL.md` first if you haven't — case-scoping affects almost everything below.

**Source material this ticket was built from:** HANDOFF.md, README.md, AGENTS.md, schema.sql (referenced, not yet reviewed directly), independent architecture review cross-checked against a second AI's review of the same docs.

---

## 0. The core reframe (read this first)

**"Drug list" is the wrong mental model. "Savings-path bundle" is the right one.**

Adding rows to `drugs` or `seed_drugs.json` does nothing on its own. A drug only "beats GoodRx" when it has a complete bundle across four tables:

```
sources            → the citable proof (program terms PDF, PBM policy doc, statute)
drugs              → canonical drug (ingredient, dose form)
price_points        → the GoodRx/cash floor, tagged with pharmacy + underlying_processor (BIN/PCN)
exploits            → the legal mechanism that beats the floor, with source_id + medicare_legal flag
accumulator_policies → the payer rule that can silently nullify an exploit
```

Current seed state (as of last check): **15 drugs, 18 price points, only 2 sources rows.** The bottleneck is not the drug count, it's the sources/exploits layer, which is almost empty. Do not grow the drug count until the bundle pattern is proven on the first 3.

---

## PHASE 1 — Build Phase (code/schema, safe to start now)

This phase does not touch real PHI and does not require legal sign-off. Kimi can start immediately.

### 1.1 Fix the Edge Function / MCP project-ref bug — DO THIS FIRST
The raw-upload purge job (`/api/jobs/purge-expired-uploads`) is supposed to run via Edge Function + `pg_net` schedule, but MCP is currently bound to the **MsJaneHH** Supabase project instead of Arik's (`iwayoxmpbueneagdkpzj`). This means EOBs/denial letters are not auto-deleting on the 48h raw-upload window. This is a live data-retention gap, not a backlog item — fix before any other work on this ticket.

### 1.2 `source_id` enforcement
HANDOFF states every `exploits` / `accumulator_policies` / `exception_precedents` row requires a non-null `source_id`, but this is **app-layer enforced, not DB-enforced**. Before scaling past 3 drugs:
- Add a validation check in `lib/` (or extend `scripts/validate_repo.py`) that rejects any insert into these tables missing `source_id`.
- This closes the gap where a bulk agent insert could silently create un-cited savings claims.

### 1.3 Eligibility / ranking engine
Build the patient-aware ranking layer that filters `exploits` by `user_matching_profile`:

```
commercial + income > 400% FPL + no accumulator  → rank manufacturer $0 copay first
Medicare + income < 400% FPL                       → rank foundation grant first (copay is Medicare-illegal)
uninsured + income < 500% FPL                      → rank PAP first
all others                                          → fallback to lowest price_points
```

Required per-exploit checks before anything shows a $0 price to a patient:
- `insurance_type_required` (commercial only? Medicare allowed?)
- `income_min` / `income_max`, stored as **% FPL, not dollar amounts** (PAPs commonly use 200/400/500% FPL tiers)
- `state_or_location_raw` → resolved via `resolveLocation.ts` (zip resolution already built; USPS codes are case-sensitive by design, don't "fix" that)
- `accumulator_policies` check — if the patient's PBM runs an accumulator/maximizer, a $0 manufacturer card does **not** count toward deductible. Must surface a warning, not just hide the exploit.
- `exception_precedents` — for prior-auth/step-therapy bypass cases

If any check fails, fall through to the next-best path. Never show a $0 price the patient can't actually get.

### 1.4 Staleness / freshness monitor (manual version now, automated later)
README defers the full monitor job to a later phase, but you need a manual-equivalent now:
- `sources.last_verified_at` + `effective_start`/`effective_end` fields already exist — use them.
- Daily job: flag any source older than 30 days as stale; hide the associated exploit until re-verified.
- PBM/manufacturer terms move monthly — this is explicitly adversarial per README, treat staleness as a real risk, not a cosmetic flag.

### 1.5 `case_outcomes` wiring
This is the KPI proof mechanism — without it, "we beat GoodRx" is an anecdote, not a verified claim.
- Case status workflow already exists in `lib/cases.ts` with `assertLegalTransition()` (illegal transitions throw 409) — wire outcome confirmation into that state machine.
- On patient confirmation (e.g., "paid $0 with MyWay"), write to `case_outcomes`: amount saved, pharmacy used, timestamp.

### 1.6 No-hallucination audit (verification, not new build)
HANDOFF already states this as a non-negotiable — this task is auditing existing behavior against spec, not building new:
- Chat responses must come **only** from `RETRIEVED_CONTEXT`.
- Empty retrieval → deterministic "no data on that" response written in code. Never let the model attempt to fill the gap.
- Every assistant message must log `retrieved_exploit_ids`.
- Trust receipt (source, retrieval date, eligibility basis) required per `chat_system_prompt.md` on every priced answer.

### 1.7 Build the KPI test harness
In `check_exploits.mjs`, assert for every drug bundle:
```
best_arikk_verified_net < best_goodrx_low
AND source_id IS NOT NULL
AND medicare_legal flag matches patient insurance type
AND last_verified_at within 30 days
```
This single test is the ongoing KPI: % of bet drugs where Arik's verified net price beats GoodRx's low, with a citation. Run this alongside `python scripts/validate_repo.py` and `npm run build` on every bundle addition — these are the existing gates per AGENTS.md, don't bypass them.

### 1.8 Documentation/schema hygiene fixes (small, do alongside the above)
- `output_documents.source_id` is **intentionally polymorphic**, not an FK (it can point to several tables). Confirm the app layer enforces referential correctness here manually — an unenforced polymorphic reference will silently break export/print if it's not handled.
- Add the consent ledger (already implemented in `db/007`) to `SECURITY.md` — it's currently missing from that doc even though it exists in the database. Documentation gap, not a code gap, but close it before onboarding real users.

---

## PHASE 2 — Data/Curation Phase (gated on verified sourcing, not on engineering speed)

**This is the actual bottleneck of the whole project. Budget calendar time here, not sprint points.**

### 2.1 Do NOT add 12 drugs. Build 3 complete bundles first.
Start with: **Dupixent, Zepbound, Eliquis.** These three cover the three branches that legally beat GoodRx: commercial manufacturer coupon, Medicare-legal foundation/PAP, and self-pay/alternative-fulfillment program.

Each bundle needs:
- **1 `sources` row minimum** (ideally 2+ — one per exploit), each with retrieval date + effective date
- **2–3 `price_points`** (Costco, Walmart, GoodRx-low), each tagged with pharmacy + `underlying_processor`/BIN/PCN — a $500 GoodRx price at CVS via one processor and a $520 Costco cash price are *different claims* and must be stored as different rows
- **2 `exploits` minimum per drug**: one commercial-pathway, one Medicare-legal pathway
- **1 `accumulator_policies` row** where applicable to the patient's PBM

**Example bundle spec — Dupixent:**
| Row | Detail |
|---|---|
| price_point | GoodRx low ≈ $3,140 |
| Exploit A | MyWay copay card, $0, commercial only, `medicare_legal=false`, source = MyWay program terms PDF |
| Exploit B | PAN Foundation grant, $0, `medicare_legal=true`, income-tested, source = PAN Foundation Dupixent fund page |
| Backup source | HealthWell Foundation (alternate foundation option if PAN fund is closed/exhausted) |

Apply the same pattern to Zepbound (Lilly self-pay vial program + LillyCompass copay card) and Eliquis (BMS PAP income criteria + FDA Orange Book authorized-generic apixaban reference).

### 2.2 Why this is slow (and why that's correct, not a problem to route around)
Every `medicare_legal` flag, every income threshold, every "is this PBM running an accumulator" determination requires actual verification against program terms, CMS guidance, and PBM policy docs, not inference. Getting `medicare_legal` wrong on a single exploit isn't a bug, it's potentially steering a Medicare patient toward a program that could raise anti-kickback/inducement concerns. **Do not let Kimi (or any autonomous agent) infer these values.** They should be sourced from real documents and, ideally, sanity-checked against legal guidance before being marked verified.

### 2.3 Tier 1 backlog (build after the first 3 bundles pass validation)
In priority order once Dupixent/Zepbound/Eliquis are proven:
4. Tirzepatide (Zepbound/Mounjaro) — self-pay vial vs pen, prior-auth T2D vs weight-loss branching, compounded/shortage-status tracking
5. Semaglutide (Ozempic/Wegovy) — Novo programs, T2D vs obesity coverage exception, medical-necessity documentation
6. Risankizumab (Skyrizi) / Secukinumab (Cosentyx) — specialty pharmacy steering detection, manufacturer $0 commercial + foundation Medicare
7. Empagliflozin (Jardiance) — PAP, 340B/FQHC, $35 program eligibility, generic dapagliflozin therapeutic-interchange logic
8. Sacubitril/valsartan (Entresto) — Novartis PAP + foundation + $35 commercial program; good test case for commercial-vs-Medicare branching

**Tier 2 (hold until Tier 1 is fully validated and generating verified KPI wins):**
Adalimumab/biosimilars (Humira vs Hadlima/Yusimry — tests PBM-specific biosimilar steering), Lenalidomide/Revlimid (REMS + foundation grant logic), Insulin (Humalog/Lantus — $35 cap laws, 340B, Lilly/Sanofi programs), Ustekinumab/Stelara (biosimilar-wave/patent-expiration tracking), Trikafta (ultra-high-cost orphan drug workflow, no GoodRx win possible — tests the ceiling case).

---

## PHASE 3 — Compliance Gates (blockers, not backlog)

These are not sprint tasks. They gate whether real patient data can touch the system at all.

| Gap | Status | Action |
|---|---|---|
| Edge Function / MCP pointed at wrong Supabase project | **Live gap** | Fix in Phase 1.1 before anything else |
| 48h raw-upload / 90-day case purge windows | Working defaults, **pending Hunter/legal review** | Do not take real PHI until locked. Build/test against synthetic data only until then. |
| Consent ledger exists in DB but missing from SECURITY.md | Documentation gap | Add before Privacy Policy is published |
| Malware scanning on document intake | Deferred — type/size checks only | Close before any real patient bill/EOB upload in pilot |
| `employer_plans.extracted_plan_facts` | No uploader-identity scrubbing yet | Required before ingesting employer plan documents at scale — this is a pipeline requirement, not a nice-to-have |
| MTM $1,276 threshold (2026) | Locked against CMS memo, but **requires annual re-verification** and plans may set lower thresholds | Present MTM eligibility as "likely eligible," never as a hard boolean |

---

## Hard constraints (do not let these erode under sprint pressure)
- **No PBM/pharma/discount-network revenue, ever** — including affiliate links. Click-out-only. This is *why* Arik's recommendations are trustworthy — it can recommend the path that costs the business money.
- **No clinical recommendations, ever** — cost/coverage guidance only.
- **No immigration status persistence, ever** — ephemeral check only, never stored.
- **Demographic eligibility flags are additive-only** — they can unlock additional pathways, but must never affect the core pricing path itself.

---

## Immediate next steps (in order)
1. Fix the Edge Function/MCP project-ref bug (1.1)
2. Add `source_id` non-null enforcement at the app layer (1.2)
3. Build eligibility/ranking engine + accumulator check (1.3)
4. Build the 3 complete bundles: Dupixent, Zepbound, Eliquis (2.1) — this can run in parallel with steps 1–3 since it's research/sourcing work, not code
5. Write and pass the `check_exploits.mjs` KPI test (1.7) against those 3 bundles
6. Only then: expand to Tier 1 remaining 4 drugs, then Tier 2

**Do not skip ahead to adding more drugs before step 5 passes.** The whole point of this architecture is that a claim without a source and a legality flag isn't a savings path, it's a liability.
