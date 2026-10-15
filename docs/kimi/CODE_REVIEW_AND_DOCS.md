# Code review and developer docs pass

**Owner:** Ryan Russell
**Date:** 2026-10-14
**Put this file at:** `docs/kimi/CODE_REVIEW_AND_DOCS.md`
**Use:** "Follow docs/kimi/CODE_REVIEW_AND_DOCS.md, Part A, area 1." Then one area per session.

Two goals:
1. Make sure every piece of code works the way it should and nothing is quietly tripping us up.
2. Make the codebase easy for any future developer to find their way around.

Do **Part A (review) first** and fix what it finds, then **Part B (comments and docs)**, so the comments describe the corrected code.

---

## Rules for both parts

- **One area per session.** Work through the areas in the order below and stop at the end of each one.
- **Usage:** read each file once, fully, only when it's in the current area. No re-reads. Test output: pass/fail counts and the first failure only.
- **Never change behavior in Part B.** Comments, docs and safe renames only. Run the tests after every area.
- **Renames:** only local variables, private helpers and file-internal names. Never rename database tables or columns, API routes, environment variables, exported function names used in more than one file, or anything in `db/`, without asking Ryan first.
- **Partner confidentiality:** no partner names, terms or API details in comments or docs.
- **Commits:** local only, one commit per area, message `review: <area>` or `docs: <area>`. No push, no deploy.
- **No em dashes** in comments or docs.

## The areas, in order

1. **Chat pipeline:** chat routes, `lib/chatSession.ts`, `lib/chatRetrieval.ts`, `lib/callModel.ts`, `lib/modelConfig.ts`, `lib/groundingGuard.ts`, `lib/trustReceipt.ts`, `lib/extractedFacts.ts`
2. **Ranking and rules:** `lib/ranking.ts`, `lib/medicareEligibility.ts`, rules code, `lib/deadlines.ts`
3. **Pricing:** `lib/pricing/` and the ingest scripts
4. **Auth, privacy and security:** `proxy.ts`, `lib/apiAuth.ts`, `lib/session.ts`, `lib/consent.ts`, `lib/privacy.ts`, `lib/identityCrypto.ts`, rate limiting, security headers
5. **Cases, caregivers and documents:** `lib/cases.ts`, `lib/caregivers.ts`, `lib/documentIntake.ts`, `lib/outcomes.ts`, `lib/mtm.ts`, upload routes
6. **The rest of `app/`:** pages, components, the remaining API routes
7. **Database:** `schema.sql`, `db/` migrations, row security policies, `supabase/`
8. **Scripts, tests and infrastructure:** `scripts/`, `infra/`, `Dockerfile`, `docker-compose.yml`, `package.json` scripts

If a file isn't listed, put it in the closest area, and list it in that area's report.

---

## Part A: Review (find problems, don't fix yet)

For each area, read every file in it and check:

- **Correctness:** logic errors, off-by-one errors, wrong units (cents vs dollars, days vs months), time zone and date bugs, rounding, unhandled empty or null cases.
- **Errors:** missing try/catch at boundaries, swallowed errors, error messages that leak internals or patient data.
- **Security:** missing auth or ownership checks, trusting a user id from the request, SQL built from strings, secrets in code, patient data in logs.
- **The money rules:** anything that could let partner or industry money affect ranking, show `allow_patient_display = false` data, or send `allow_ai_processing = false` data to a model.
- **AI safety:** any path where a number reaches the patient without passing the grounding guard.
- **Dead or duplicate code:** unused exports, two functions doing the same job, TODOs that matter.
- **Tests:** important logic with no test.
- **Docs drift:** places where the code disagrees with AGENTS.md or the spec.

**Report**, appended to `docs/status/code_review.md` (create it in the first session). One table per area:

| # | Severity | File:line | What's wrong | Why it matters | Suggested fix | Size |
|---|---|---|---|---|---|---|

Severity:
- **Critical:** wrong money, data leak, or security hole
- **High:** wrong result or crash a user can hit
- **Medium:** fragile code or a missing test on important logic
- **Low:** cleanup

**After each area, STOP.** Ryan decides which findings to fix. Fixes happen in their own session, each with a test that would have caught the bug.

---

## Part B: Comments and developer docs (after the fixes)

For each area:

1. **File header** at the top of every file, 3 to 6 lines:
   - what the file is for
   - what calls it, and what it calls
   - any rule it enforces (for example, "Medicare patients never see copay cards")
2. **Function docs** on every exported function, and on any internal function over about 15 lines: what it does, its inputs and outputs, what it throws, and any side effects (database writes, model calls, network calls).
3. **Block comments** above each logical step inside longer functions, one line each: `// Step 2: drop prices the patient isn't allowed to see`.
4. **Why comments** wherever the code does something surprising, with a pointer to the spec section or decision behind it, for example `// See spec M06-AC8`.
5. **Clear names:** rename unclear local and private names (`d`, `tmp`, `res2`) under the renaming rules above.
6. **No noise:** don't comment the obvious (`i++ // add one`). Comments explain intent and rules, not syntax.

**Docs to write once, in the final docs session:**
- `docs/DEVELOPER_GUIDE.md`, covering:
  - how to set up locally
  - how a chat request flows end to end
  - where each kind of logic lives
  - how to add a price source, a rule, a migration and a test
  - the non-negotiable rules (money, privacy, grounding)
  - a glossary: NDC, NADAC, PBM, U&C, PEPM, BAA, and the rest
- A short `README.md` in each main folder (`lib/`, `lib/pricing/`, `app/`, `db/`, `scripts/`) saying what's in it and where to start.
- Point AGENTS.md and CLAUDE.md to the developer guide.

**Check after each area:** `npm test`, `npm run typecheck` and the validator all pass, and the diff shows only comments, docs and allowed renames.

---

## Report (after each session, under 10 lines)

- Area covered
- Findings by severity (Part A), or files documented (Part B)
- Tests: pass/fail counts
- Commit hash
- Next area
