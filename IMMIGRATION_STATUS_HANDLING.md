# Arik: Immigration Status Handling

Drafted 2026-07-24 from HANDOFF.md's non-negotiable constraints and the
`user_identity` schema comment. Review before build.

## The rule

**No immigration or citizenship status is ever persisted. Anywhere. Ever.**
No column, no table, no log line, no analytics event, no chat-history
echo, no export, no cached extraction. The `user_identity` schema comment
("Deliberately no immigration/citizenship status column anywhere in this
schema... Do not add this column") is the enforcement anchor - any change
adding such a field is rejected on sight, the same class of rule as the
no-SSN rule in SECURITY.md.

## Why an ephemeral check exists at all

A small number of real programs - some state pharmaceutical assistance
programs, some hospital charity-care policies - have lawful-presence or
residency-related eligibility criteria. Arik's job is matching patients to
every legal savings mechanism, and some of those mechanisms cannot be
evaluated without the answer. The population this touches (mixed-status
families, immigrant communities) is also exactly the population that
cannot afford a data trail. So the answer is used and immediately
discarded - never retained.

## How the ephemeral check works

1. The question is asked **only** when a specific, already-matched
   program's `eligibility_criteria` genuinely depends on it - never
   collected during onboarding, never "just in case."
2. It's asked in plain language with the reason stated first, and with an
   explicit promise shown before the patient answers: **this answer is
   never stored.** That promise must be literally true in code, not
   marketing copy.
3. The answer is used **in application code, in memory**, for that single
   eligibility evaluation. It is not passed to any model provider, not
   included in any model's context, not written to any table, and not
   present in any request/application log.
4. The resulting recommendation states the eligibility outcome ("you
   qualify for X" / "X isn't available in this case") without restating
   the status itself. The trust receipt shows the program criteria and
   source - never the patient's answer.

## Implementation enforcement points

- **Schema review**: no column exists; keep it that way (the comment in
  `user_identity` says so explicitly).
- **Model-context builders**: the value is never an input to extraction or
  response model calls - eligibility math needing it happens in code.
- **Logging/middleware**: request and application logging must not capture
  the field; treat an appearance in a log as an incident, not a bug.
- **Chat history**: the assistant's stored `chat_messages` content must
  never echo the answer back.

## What this means for the build

Phase 1 ships no such field and no such question in any flow. The first
`exploits` row whose eligibility criteria require it triggers the
ephemeral-check implementation above - and a human review of that specific
flow before it ships.
