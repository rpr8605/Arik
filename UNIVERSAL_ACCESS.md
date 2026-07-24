# Arik: Universal Access

This is the cross-cutting principle underneath ACCESSIBILITY.md,
EXPORT_AND_TRANSLATION.md, and CRISIS_AWARE_DESIGN.md, not a replacement
for any of them - it names the gaps between those docs and adds the
pieces none of them fully cover: talking to Arik in another language
throughout the whole conversation (not just translating a finished
document), designing for cognitive and neurodivergent difference, and
defaults that actually work for an elderly patient without requiring
them to find a settings menu first.

## Why this is the same principle as everything else in this build

"Always a tool for the patient" has been the throughline since the very
first conversation about this product - no PBM money, no pharma money,
no attorney pay-for-placement, because anyone else's interest in the
room compromises whose side Arik is actually on. Accessibility is the
same idea pointed at a different kind of exclusion: a product that's
hard to use if you don't read English fluently, or don't process
information the way most software assumes, or can't see a screen well,
or find gestures confusing, is *also* not actually working for the
patient - just a narrower definition of "the patient" than the one this
product is supposed to serve.

## Conversational language, not just document translation

EXPORT_AND_TRANSLATION.md covers translating a finished letter or
pharmacist card. That's not the same thing as a patient being able to
**talk to Arik in their own language for the entire conversation**, not
just receive a translated document at the end. This needs to be a
first-class onboarding choice:

- A language preference set at the very start (or changeable any time,
  not locked in once chosen)
- Arik's own messages - the questions it asks, the answers it gives, the
  trust receipt - generated in that language directly, not translated
  after the fact from an English original
- The extraction layer (Task 1) needs to work correctly regardless of
  what language the patient writes in - a bill or denial letter is
  usually in English regardless of the patient's own preferred language,
  so extraction has to handle a patient describing an English document
  in Spanish (or any other language) without losing accuracy
- This is a real scope difference from EXPORT_AND_TRANSLATION.md's
  translate-the-output-document feature, which still matters separately
  (the document handed to a hospital billing office needs to be in
  whatever language that office operates in, which may differ from the
  patient's own preferred language - both can be true at once)

## Designing for cognitive and neurodivergent difference

This is a distinct category from physical accessibility (screen readers,
keyboard navigation, voice input - already in ACCESSIBILITY.md) and
needs its own explicit design commitments:

- **Plain language by default, genuinely** - not just "no corporate
  hedging" as already established for tone, but actively avoiding idiom,
  sarcasm, and ambiguous phrasing that can be genuinely hard to parse for
  autistic patients and for anyone with a cognitive difference affecting
  language processing. "That's a lot of money" is fine; "that'll cost you
  an arm and a leg" is not, even as a throwaway line.
- **Predictable, consistent interaction patterns** - the same action
  always looks and behaves the same way everywhere in the app. No
  surprising layout shifts, no auto-advancing content, no interface
  elements that move or change without the patient initiating it.
  Predictability is itself an accessibility feature, not just good UX.
- **One thing at a time, always** - already true of BEHAVIOR.md's "ask
  for exactly one missing field" principle; worth naming explicitly here
  as serving this population specifically, not just as an efficiency
  choice
- **An explicit, easy-to-find "reduce motion and stimulation" toggle in
  the app itself** - not just relying on the OS-level
  `prefers-reduced-motion` setting, since many patients (especially
  elderly patients) won't know that setting exists or how to find it.
  Same underlying CSS behavior already built for the marketing site's
  reveal animations, just exposed as a real in-app control too.
- **No forced pacing or pressure from the interface itself** - real
  external deadlines (an appeal window, a submission date) still need to
  be communicated clearly, but the app's own pacing should never rush a
  patient through a decision. Tier 2 confirmations wait as long as the
  patient needs.

## Elderly-specific defaults, not just an accessibility menu

A lot of standard accessibility advice treats large text, high contrast,
and simple gestures as opt-in toggles. For a population that includes a
meaningful share of elderly patients who may never find or think to look
for a settings menu, some of this needs to be the **default experience**,
not a toggle:

- Generous default touch target sizes and text size, not the smallest
  defensible WCAG minimum
- Avoid relying on gestures a less tech-familiar user might not know
  (swipe-to-dismiss, pinch-to-zoom, long-press menus) - every action
  should have an obvious, visible button as the primary path, with
  gestures as an optional shortcut at most
- Given CAREGIVER_MODE.md already exists for when an adult child is
  managing things, this doesn't replace the goal of an elderly patient
  being able to use Arik independently without needing someone else to
  drive - caregiver mode is for when family involvement is wanted or
  needed, not a substitute for the base product being usable alone

## Mental health and cognitive load

Broader than the acute-crisis handling already in CRISIS_AWARE_DESIGN.md
- ordinary anxiety, depression, and executive function difficulty affect
a lot of patients dealing with a scary bill, without rising to crisis
language:

- **Pause and resume without penalty** - a patient who can't finish a
  task in one sitting should be able to leave and come back with zero
  loss of progress and zero implied judgment. This is already naturally
  true given cases persist rather than being session-based, worth
  calling out explicitly as an accessibility benefit of that
  architecture choice, not just a convenience
- **The automation-first philosophy (BEHAVIOR.md) directly serves this
  population** - a patient with executive function difficulty benefits
  enormously from Arik doing the actual work (drafting, filling,
  submitting-ready) rather than handing back a multi-step task list they
  have to self-direct through. This is worth stating as a deliberate
  accessibility rationale for behavior that was originally justified on
  different grounds (efficiency, trust) - it turns out to serve this goal
  too, and both reasons are real
- Non-judgmental tone about delay, incomplete information, or having to
  ask the same thing twice from the patient's own side (as opposed to
  Arik asking twice, which CONVERSATIONAL_ENTITY_EXTRACTION.md already
  prevents)

## What this means for the build

- Language preference becomes a first-class field
  (`user_matching_profile.preferred_language`), checked at the start of
  every response generation, not just at export time
- The extraction-tier model needs testing specifically on non-English
  input describing English-language source documents, not assumed to
  work by default
- A "reduce motion and stimulation" setting needs to exist as a visible,
  discoverable in-app control, not just inherited from OS preferences
- Default touch target and text sizing should be revisited against a
  more generous baseline than minimum WCAG compliance, especially on the
  primary action buttons and Tier 2 confirmation screens
- This doc doesn't introduce new schema beyond the language preference
  field - it's mostly a set of design commitments that should shape how
  every other already-built feature actually gets implemented
