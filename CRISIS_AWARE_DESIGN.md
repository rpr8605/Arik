# Arik: Crisis-Aware Design

Drafted 2026-07-24 from the constraints already embedded in HANDOFF.md,
BEHAVIOR.md, LOCATION_SERVICES.md, and ACCESSIBILITY.md. Review before build.

## Why onboarding is chat-first, not a form wall

Patients arrive mid-crisis: a bill they can't pay, a denial letter with a
clock running, a medication they need to afford *this week*. A wall of form
fields at that moment is abandonment - the exact population Arik exists for
is the one least able to push through administrative friction (see
ACCESSIBILITY.md on the population overlap).

So the first interaction is a conversation about the problem, not a profile
form. "What happened?" comes before "what's your date of birth?" - and the
answer to the first question creates the case (CASE_MODEL.md) that
everything else hangs off of.

## The incremental-profile principle

This doc is the reconciliation of two requirements that look like they
conflict:

- BEHAVIOR.md requires **deep** onboarding ("answer once, Arik acts from
  here on") - because pre-filling forms is impossible without name, DOB,
  address, insurance details, and income.
- This doc requires **minimal-friction** onboarding - because a form wall
  loses the patient before depth is ever reached.

Both are true at once. Depth is the destination; conversation is the path.
The rules:

- Profile fields are collected **incrementally, ordered by what the current
  task actually needs** - never demanded up front as a block. Zip code is
  asked when a location-dependent feature needs it (per
  LOCATION_SERVICES.md), income bracket when PAP/charity-care matching
  needs it, member ID when a form is about to be pre-filled.
- Every ask is justified in-line before it's asked ("this unlocks
  income-matched assistance programs" - the BEHAVIOR.md pattern), so the
  patient is trading information for a specific outcome, not feeding a
  database.
- Nothing gets asked twice. Once a field exists, it pre-fills everywhere,
  forever.
- Over the life of the first few cases, the profile asymptotically reaches
  the full depth BEHAVIOR.md specifies - without ever presenting a form
  wall.

## Home screen = case list, not a profile wall

After first login, the patient lands on their case list (one case per real
problem, per CASE_MODEL.md), not on a settings/profile page. Profile
completion is a byproduct of working cases, never a prerequisite gate.

## The standing instruction: recognize real crisis, drop task mode

This is a hard rule, enforced in `chat_system_prompt.md` above the task
rules: when the patient shows signs of an acute crisis, Arik **drops task
mode** and responds to the human first.

- **Medical emergency or self-harm language**: stop all task flow. State
  plainly that Arik handles money and coverage, not emergencies. Route to
  real help - 911 for medical emergencies, 988 (Suicide & Crisis Lifeline)
  for mental-health crises. Do not continue the previous task in the same
  message. Resume the case only when the patient signals they're ready.
- **Crisis-adjacent financial distress** (rationing or skipping medications
  because of cost *today*, utilities/shutoff or eviction language): this is
  exactly Arik's territory - respond with urgency, not process. Lead with
  the fastest savings path that exists in the data (manufacturer copay
  card, cash price, bridge supply) before slower mechanisms (PAP
  applications, appeals). No onboarding detours; ask only what the fastest
  path strictly requires.
- Never route crisis language into a form flow, a survey, or a
  "let me finish setting up your profile" detour.

## What this means for the build

- Onboarding is implemented as a guided chat flow with per-field,
  just-in-time justification - there is no form-wall UI anywhere in
  Phase 1.
- First message of a new user creates a case; the case list is the home
  screen from then on (UI_UX.md).
- The crisis-recognition instruction lives in `chat_system_prompt.md` as a
  standing rule; it is not optional and not a per-feature toggle.
