# Arik: Pre-Build Checklist (Manual Review)

Run `python3 scripts/validate_repo.py` first. It catches structural bugs
(bad JSON, schema forward-references, code querying tables that don't
exist). It does NOT catch the items below - those need an actual read.

**Do not write any application code until every item here is checked and
any findings are reported back before proceeding.**

## 1. Read order confirmation

Confirm you've read, in order: HANDOFF.md, CASE_MODEL.md, SECURITY.md,
BEHAVIOR.md, CRISIS_AWARE_DESIGN.md. These five establish the rules
everything else builds on. If anything in the remaining docs seems to
contradict one of these five, flag it rather than picking a side
silently.

## 2. Non-negotiable constraints - confirm each is actually enforceable

For each constraint listed in HANDOFF.md's "Non-negotiable constraints"
section, confirm there's a real mechanism to enforce it, not just a
sentence saying it should happen:

- [ ] Chat response grounding: does `chat_system_prompt.md`'s instruction
      actually get enforced by the code path in `route.ts`, or could the
      response model still free-associate if retrieval comes back empty?
- [ ] `source_id` requirement on `exploits`/`accumulator_policies`/
      `exception_precedents`: is there an actual application-layer check
      before insert, or does the schema silently allow a null source_id
      today? (It does allow null today - schema.sql does not constrain
      this at the DB level. Confirm the insert code path Kimi writes
      adds the check, don't assume the schema handles it.)
- [ ] No PBM/pharma/discount-network revenue: confirm no code path being
      written includes an affiliate link, referral tracking parameter, or
      revenue-share integration with any named discount network
- [ ] No attorney pay-for-placement: confirm `referral_resources` ranking
      logic (whenever it's written) never orders by a payment field
- [ ] No clinical recommendations: spot-check that any generated response
      touching drug/treatment choice stays in cost/coverage framing, per
      SCENARIOS.md's Scenario 5 example
- [ ] No immigration status persistence: confirm no column, table, or log
      anywhere retains this field - it should never even transiently
      appear in an application log
- [ ] Demographic eligibility fields (DEMOGRAPHIC_ELIGIBILITY.md) never
      alter core pricing output - confirm this in whatever matching logic
      gets written, not just assumed

## 3. Cross-doc contradiction check

Several docs were written at different points in the conversation and
later corrected earlier assumptions (e.g., CASE_MODEL.md corrected the
original Phase ordering, SECURITY.md's HIPAA framing was corrected
mid-repo). Confirm:

- [ ] No doc still describes `user_profiles` as a single merged table -
      it should only ever be referenced as split `user_identity` /
      `user_matching_profile`
- [ ] No doc implies "lighter compliance posture is fine because HIPAA
      may not apply" - SECURITY.md's correction should be the only
      framing anywhere
- [ ] No doc implies chat is one continuous thread rather than
      case-scoped - check BEHAVIOR.md's scenario examples and UI_UX.md
      against CASE_MODEL.md's correction

## 4. Scope discipline

- [ ] Confirm you are building Phase 1 (drug pricing) and Phase 1.5 (bill
      auditor, parallel track) only, per HANDOFF.md's build sequence -
      not Phase 2/3 features, even if they seem quick to add
- [ ] Confirm you are NOT building: the insurer/PBM ownership graph, Blue
      Button 2.0 integration, attorney referral at scale, employer plan
      database, or hospital/imaging price shopping in this pass

## 5. Open items requiring a human decision before proceeding

- [ ] `callModel()` in route.ts needs a real model router - confirm with
      Ryan whether this shares the MIST project's OpenRouter setup or
      stays independent before wiring it
- [ ] Column-level encryption approach for `user_identity` (pgcrypto vs.
      external vault) needs to be chosen, not inferred
- [ ] The MTM cost eligibility threshold in `mtm_eligibility_checks`
      logic needs the current-year CMS figure verified before hardcoding
      (~$1,276 was the figure at last check, confirm before use)

## 6. Report back before writing code

Once this checklist and the automated script both pass, report: which
items required judgment calls, anything that seemed ambiguous or
contradictory, and confirmation of the model-router decision from item 5.
Then, and only then, begin Phase 1 implementation per HANDOFF.md.
