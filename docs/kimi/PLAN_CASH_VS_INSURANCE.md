# Plan: cash vs insurance rule and the "At the counter" card

**Status:** plan only, waiting for "go". Written 2026-10-16.
**Asked for:** the owner's queue after free_data_loaders.md: the cash-vs-insurance rule (rx_routing_build.md Part A, step 4) with per-coverage wording, an "At the counter" card on cash and discount-card results (English and Spanish), and tests for each coverage type.

## 1. The rule: `lib/rules/cashVsInsurance.ts` (pure)

**Inputs** (all optional except coverage; unknown is a value, never a guess):
- `coverage`: `uninsured | commercial | medicare_part_d | medicare_advantage | medicaid | unknown`
- `cashPriceUsd` (sourced, from ranking: DTP, cash, discount card), with its source and date
- `planCostUsd` (the patient's copay or coinsurance amount, if they told us or a plan document says), `deductibleMet: yes | no | unknown`
- `countsTowardDeductible: yes | no | unknown` (from the program row; default unknown)
- `federalProgramAllowed: yes | no | unknown` (from the program row; default unknown)
- `drugCoveredByPlan: yes | no | unknown`

**Output:** `{ decision: 'use_cash' | 'use_insurance' | 'ask_patient' | 'not_for_this_coverage', reason: ReasonCode, caveats: CaveatCode[] }`. Reason and caveat codes, not prose; the wording lives in one EN/ES string table so tests can check every code has both languages.

**Rules, in order:**
1. **Medicaid:** never `use_cash` for a drug Medicaid covers. Decision `use_insurance` with reason `medicaid_covered_use_benefit`; if coverage of the drug is unknown, `ask_patient` (reason `ask_if_medicaid_covers`). Wording: "With Medicaid, a covered prescription should cost you no more than the small copay your state sets. Don't pay cash for it; ask the pharmacy to bill Medicaid."
   - **Verify before build:** I will check the wording against an official source: 42 CFR 447.15 (providers must accept Medicaid payment as payment in full) and 42 CFR 447.50 to 447.57 (Medicaid cost sharing), on ecfr.gov, plus a CMS page on Medicaid pharmacy cost sharing. If the regulation text does not support "should cost you no more than the copay" as written, the rule ships with reason `medicaid_pending_verification` and the softer line "With Medicaid, ask the pharmacy to bill Medicaid first," and the item is reported to Ryan.
   - Drugs Medicaid does not cover: `ask_patient` (never a cash recommendation without the patient confirming the denial).
2. **Medicare (Part D or Advantage):** a DTP or cash program row with `federalProgramAllowed` not `yes` is `not_for_this_coverage` (reuses the AKS pattern, like the copay card block). Where cash is allowed and cheaper, `use_cash` always carries caveat `medicare_cash_not_counted`: "Paying cash outside your plan won't count toward your Part D out-of-pocket limit for the year." **Verify:** the incurred-cost definition in 42 CFR 423.100 and the CMS page on the 2026 out-of-pocket cap ($2,100), quoted in the code comment.
3. **Commercial:** plan cost unknown, or deductible status unknown when the cash price is lower than the list price: `ask_patient` (reason `need_plan_cost` / `need_deductible_status`), with the two questions to ask: "What's your copay for this drug?" and "Have you met your deductible this year?". Known plan cost: cheaper side wins. `use_cash` always carries `may_not_count_toward_deductible` unless the program row says it counts; out-of-pocket maximum caveat when `deductibleMet = no`.
4. **Uninsured:** cheaper sourced option, no insurance caveats.
5. **Unknown coverage:** `ask_patient` (reason `need_coverage`).
- Ties and missing cash price: `use_insurance` when plan cost is known, else `ask_patient`. Never a guessed number.

**Where it plugs in:** the ranking stays the price ranking; the rule annotates the best cash/discount pathway and the chat composes the decision in code (no model judgment), like the Medicare block. The grounding guard gets the rule's figures as allowed facts. Demo: the prescription card shows the decision line under "Best path".

## 2. The "At the counter" card (EN/ES)

Shown on any result whose best path is a cash price or a discount card. Built in code from the ranking row and the program row, never by the model.
- **What to say:** "I'd like to pay cash for this prescription using [program or card name]. Please run it as cash, not through my insurance." Discount card version adds "Please use these card numbers."
- **Card details the pharmacist needs:** BIN, PCN, group and member ID, exactly as the program publishes them, only when the program row carries them with a source. If they are missing: "Get the card numbers from [program page]" with the link, never placeholders.
- **Where and when the price applies:** pharmacy (or "any participating pharmacy" when the source says so), quantity, and "price checked [date] by [source]".
- **Deductible caveat** from the rule (commercial: may not count; Medicare: won't count toward the Part D limit).
- **If the price at the counter is different:** "Ask them to check the quantity and that it was run as cash. If it is still different, tell Arik what you were charged" (feeds M08 later).
- Spanish: full parallel strings, reviewed for plain language; `lang` switch like the call card.
- **Data needed:** `exploits` has no BIN/PCN columns today. Plan: a migration (next free number, likely db/037) adding `card_bin`, `card_pcn`, `card_group`, `card_member_id_rule` (text, e.g. "printed on the card you download") with a source column. Only filled from a cited program page; empty means the card says where to get them.

## 3. Tests (`scripts/test_cash_vs_insurance.ts`, `test_counter_card.ts`)

- Medicaid: covered drug never `use_cash`, even when cash is far cheaper; unknown coverage asks.
- Medicare: DTP not allowed for federal programs is blocked; allowed cash always carries the Part D limit caveat.
- Commercial: unknown plan cost asks; unknown deductible asks; cash cheaper with `countsTowardDeductible = unknown` carries the caveat; known plan cost cheaper picks insurance.
- Uninsured: cheaper wins, no caveats. Unknown coverage asks.
- Every reason and caveat code has EN and ES text; no em dashes.
- Counter card: shown only for cash and discount-card bests; never shows a BIN/PCN that has no source; Spanish card has the same fields; the date and source line always present.
- Grounding: the chat's composed decision passes the guard with the rule's numbers; a model sentence saying "pay cash" for a Medicaid case is rejected (new guard check, same shape as the personal-prediction rule).

## 4. Order of work after "go"

1. Verify the Medicaid and Medicare wording against eCFR and CMS (report quotes, mark pending if unclear).
2. Pure rule + string table + tests.
3. Migration for card details (flag the db file before it's needed on the demo).
4. Counter card component (demo prescription card + chat card format) + tests.
5. Chat wiring and guard check. Gates, commit, report.

## Decisions for Ryan

- Approve the Medicaid line wording once the regulation quotes are in (or keep the softer pending line).
- OK to add the card-detail columns (db/037)?
