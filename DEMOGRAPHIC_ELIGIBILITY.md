# Arik: Demographic Eligibility Fields

Drafted 2026-07-24 from HANDOFF.md's non-negotiable constraints and the
`user_matching_profile.demographic_eligibility_flags` schema comment.
Review before build.

## Why these fields exist at all

Some legitimate savings programs are demographic-specific: disease
foundations serving particular communities, veteran and tribal health
programs, condition-specific funds with eligibility tied to attributes
beyond income and insurance. If the patient never volunteers the attribute,
Arik cannot surface those programs - that is the **only** reason these
fields exist. They are a matching unlock, nothing more.

## Hard rules

1. **Opt-in, per category.** Each category (race/ethnicity, sexual
   orientation/gender identity, veteran status, etc.) is volunteered
   independently, with the reason explained before it's asked - the same
   "why I'm asking" pattern BEHAVIOR.md requires for income.
2. **Additive-only.** A demographic flag can only *add* candidate programs
   to a patient's match list. It can never remove, reprice, demote, or
   reorder anything the core matching already produced. A patient who
   volunteers nothing gets the identical core result as a patient who
   volunteers everything.
3. **Never affects core pricing.** The core matching engine
   (drug/dose/state/insurance/income against `drugs`, `price_points`,
   `exploits`, `accumulator_policies`) does not read
   `demographic_eligibility_flags` at all. Only the program-eligibility
   layer may read it, and only to add rows.
4. **Independently deletable.** Modeled as a single jsonb blob precisely so
   any one category can be cleared without a schema migration (see the
   `user_matching_profile` comment in schema.sql). Deleting a category
   takes effect for future matching immediately.
5. **Same citation rules as everything else.** A program surfaced via
   demographic matching still needs a `sources` row and still appears in
   the trust receipt like any other recommendation. The attribute itself
   is never restated in the recommendation - the patient sees "you qualify
   for X program," not their own data echoed back.
6. **Never shared, never in analytics, never in the identity vault.**
   These flags live only in `user_matching_profile.demographic_eligibility_flags`
   and are excluded from `employer_plans` extraction caching, shared
   review links, and any export.

## What this does NOT cover

Immigration/citizenship status is not part of this framework and never
will be - it has dedicated handling in IMMIGRATION_STATUS_HANDLING.md
(ephemeral check only, nothing persisted anywhere, ever). Do not fold it
in here.

## What this means for the build

- The core pricing/matching code path must physically not read
  `demographic_eligibility_flags` - enforce by keeping it out of the core
  query/match functions' inputs, not by convention.
- The additive program-eligibility layer reads it and can only union
  results, never filter.
- Profile deletion controls expose per-category clearing of this blob
  independently of the rest of the profile (SECURITY.md's deletion list).
