# Arik: Conversational Entity Extraction (Never Ask Twice)

## The actual mechanism, not just "listen for it"

Noticing a drug name or an employer mentioned in passing isn't enough by
itself - if that extracted fact only lives inside that one turn's model
call and disappears once the conversation moves on, Arik will still ask
for it again three messages later. The fix has two parts, both required:

1. **Broaden what gets extracted** every turn, not just the narrow
   drug-name/question-type schema `route.ts` currently uses
2. **Write every extracted fact back to the durable profile/case record
   immediately** - not held only in that turn's context, so it persists
   and is checkable on every subsequent turn regardless of how far back
   in the conversation it was mentioned

## Broadened extraction schema

`extractIntent()` in `route.ts` currently pulls `drug_name`,
`question_type`, `dose`. Extend it to catch anything relevant that gets
mentioned naturally, not just what's directly asked about:

```typescript
{
  drug_name: string | null,
  dose: string | null,
  question_type: "price_check" | "why_did_price_change" | "find_savings" | "bill_dispute" | "denial_appeal" | "other",
  employer_name: string | null,        // "I work at Apple" mentioned in passing
  institution_name: string | null,     // hospital/clinic named anywhere in the message
  insurance_plan_name: string | null,  // "I have a Cigna PPO" mentioned incidentally
  prescriber_name: string | null,      // doctor's name mentioned, even off-hand
  state_or_location: string | null,    // "I live in Austin" mentioned conversationally
}
```

This still runs on the cheap extraction tier (Haiku 4.5) - it's pattern
matching against a slightly larger schema, not a more expensive call.

## The merge step - this is the part that actually prevents re-asking

Immediately after extraction, before the response model ever runs, merge
any non-null extracted fields into the durable record:

- `employer_name` → `user_matching_profile.employer_name` (enables
  EMPLOYER_PLAN_DATABASE.md matching the same as if it had been asked
  directly)
- `institution_name` → tied to the current case (relevant for bill
  disputes, charity care matching against `hospital_financial_
  assistance_policies`)
- `insurance_plan_name` → `user_matching_profile.insurance_type` /
  informs downstream `accumulator_policies` matching
- `prescriber_name` → `user_medications.prescriber_name` (the exact
  field flagged as needed for PAP applications in SCENARIOS.md's
  Scenario 2)
- `state_or_location` → `user_matching_profile.zip_code`/`state`, per
  LOCATION_SERVICES.md

**Never overwrite an existing non-null value with a new extraction
without flagging it as a correction** - if the patient already said they
work at Apple and a later message extracts "Google," that's either a
mistake in extraction or the patient actually switched jobs; either way
it should surface as "did you mean to update this?" rather than silently
overwriting, since a silent overwrite could corrupt a case that depended
on the original value.

## The rule for the response model: check before asking

Add to `chat_system_prompt.md`'s hard rules: before asking the patient
for any piece of information, check USER_PROFILE, USER_MEDICATIONS, and
the full CONVERSATION_HISTORY for whether it's already been stated -
including in passing, not just in direct answer to a prior question.
Never ask for something already mentioned anywhere in this conversation
or already present in the durable profile. If Arik is about to generate
a clarifying question, that question generation step itself needs to
check the current known-facts state first, not just react to the latest
message in isolation.

## What this means for the build

- `extractIntent()`'s schema expands as above - same cheap model tier,
  same cost profile, no architecture change
- A merge/upsert function runs after extraction, before
  `retrieveContext()` - writes non-null extracted fields to
  `user_matching_profile`/`user_medications`, with the
  don't-silently-overwrite rule above
- `chat_system_prompt.md` gets the explicit "check before asking" rule
  added to its hard rules section, not left as an implicit expectation
- This is genuinely Phase 1 scope, not a later addition - it directly
  strengthens BEHAVIOR.md's core "ask for exactly one thing, never
  twice" principle that's already supposed to be true from the start
