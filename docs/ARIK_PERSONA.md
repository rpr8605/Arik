# Arik persona: developer notes

The owner's spec is the persona build prompt in `docs/kimi/`. This page is
for developers: where each piece lives and the rules you must not break.
The persona text itself has one source of truth, `lib/persona/arik.ts`.
`chat_system_prompt.md` and BEHAVIOR.md point there; don't copy it.

## What is fixed and what adapts

| Fixed for everyone (code) | Adapts per person (style only) |
|---|---|
| Intro line (`INTRO`), personality and voice (`PERSONA_SYSTEM_BLOCK`), crisis replies (`CRISIS_REPLY`) | Length, order, tone, reading level, pace (`StyleDials`) |

**Style never touches substance.** Prices, programs, eligibility, rankings,
deadlines, the Medicare copay-card block and the trust receipt are the same
for every style. `scripts/test_style_neutrality.ts` proves it: across 52
style variants, the system prompt and every retrieved fact are byte-identical,
and the prompt differs only by the style block.

## How a turn flows (`app/api/chat/route.ts`)

1. **History** for the session is read first (one query).
2. **`detectStyle(userMessages, savedPrefs)`** in `lib/persona/styleSignals.ts`:
   - Inputs are only what the person wrote in this conversation plus a preference they saved. There is no parameter for profile, age, location or insurance, so outside data can't creep in.
   - Precedence: inferred signals < saved preference < an explicit ask in this conversation.
   - Crisis language freezes the dials at neutral.
3. **`introFor()`:** the full intro on someone's first reply ever, "Hi, it's Arik again." on the first reply of a later case, nothing after that, and never during a crisis.
4. **The normal pipeline runs** (extraction, retrieval, the copay-card block, ranking). Crisis language detected in code is never sent to the off-topic redirect.
5. **`buildResponsePrompt()`** in `lib/chatPrompt.ts` (pure):
   - The system prompt is the persona block plus `chat_system_prompt.md`. It's identical every turn, so prompt caching works.
   - The style block (`styleBlock()`, under 80 tokens) goes last in the uncached user prompt.
6. **The grounding guard checks the model's text.**
7. **`composeReply()`:** the code-written crisis reply comes first. Otherwise the intro, then the answer. For self-harm on a short-circuit path (clarify, no data), the crisis reply stands alone.
8. **Watchdog:** `measureLoad()` logs counts only (numbers, bullets, actions). The limits themselves (3 numbers, 5 bullets, 1 action, then "Want the rest?") are enforced through the prompt.
9. **Offers in the response:**
   - `style_suggestion`: a style the person just asked for that isn't saved yet. Thread shows "Remember this?".
   - `language_suggestion`: `es` when the person writes in Spanish or asks for it. Thread offers to switch through the existing ledgered language path; it never switches by itself.

## Crisis (deterministic, `detectCrisis`)

- **Self-harm:** EN and ES phrases → the owner's 988/911 reply.
- **Can't get a life-sustaining medicine today:** a medicine word (insulin, inhaler, epinephrine, heart medicine, blood thinner, ...), plus "can't get / ran out", plus "today / now / tonight". The reply sends them to their pharmacist or prescriber now, and to urgent care, the ER or 911 if they're in danger.
- **No false alarms on everyday phrasing:** "this price is killing me", or a refill due next month, don't trigger. Add new phrases with a test in `scripts/test_persona.ts`.
- **The prompt still handles crisis too:** `chat_system_prompt.md` keeps its crisis instruction. The code-written reply guarantees the resources appear first, whatever the model does.

## Saved preferences (`db/027_user_style_prefs.sql`, `lib/stylePrefs.ts`)

- **Only `length` and `reply_order`,** and only when the person asked and tapped "Remember this?".
  - **Language** keeps its own consent-ledgered path (`/api/preferences`).
  - **The existing "simple" explanation style** counts as the explicit preference for plain, one-step answers.
- **Row security:** owner only. The service role writes through `/api/preferences/style` (GET, PUT, DELETE), session user only.
- **Ledgered:** every save and clear goes to the consent ledger (`style_preference`).
- **Visible and deletable** on the home screen ("Arik remembers: ... Forget this").
- **Fails soft:** reads degrade to "no preference" (style is cosmetic). Deleted with the account (`lib/privacy.ts`).

**Never stored, logged or sent to analytics:** dials, moods, personality
labels or any inferred trait. Dials are recomputed every turn from the
conversation.

## Tests

| Test | Covers |
|---|---|
| `scripts/test_persona.ts` | Crisis detection and replies, dials, precedence, intro, composition order, the style block's size, the load measurement |
| `scripts/test_style_neutrality.ts` | Style changes the wording only |
| `scripts/test_auth_guards.ts` | The style preference route |
| `scripts/smoke_style_prefs.mjs` | Row security on the local stack |
| `scripts/test_crisis.ts` | The crisis instruction and the off-topic gate |

The optional paid eval (four simulated patients) runs only with the owner's approval.
