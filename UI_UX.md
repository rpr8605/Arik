# Arik: UI/UX Spec

Drafted 2026-07-24 from CASE_MODEL.md, BEHAVIOR.md, CAREGIVER_MODE.md,
ACCESSIBILITY.md, and EXPORT_AND_TRANSLATION.md. Review before build.

## Structure: the case list is the product surface

- **Home screen = case list**, not a profile wall (CRISIS_AWARE_DESIGN.md).
  Each case card shows: case type, amount at risk, current status, next
  action and its due date, and a deadline countdown where a filing
  deadline exists.
- **One chat thread per case.** Chat is case-scoped (CASE_MODEL.md's
  correction) - there is no single continuous history across a patient's
  whole account. A conversation belongs to exactly one case, and the case
  view is where the patient always lands.

## Case view

The persistent case view answers three things at a glance, always, not
just in the chat turn where they first came up:

1. Where the case stands in the status workflow (`gathering_evidence` →
   `action_ready` → `submitted` → `awaiting_response` → resolved).
2. The deadline countdown ("Your appeal is due in 23 days") with what's
   still missing attached to it ("the letter's ready - you still need the
   physician's supporting note").
3. The next action, with the work already done behind it.

## Chat patterns (per BEHAVIOR.md)

- Resolved answers only - never a conditional "if you do X, Y, Z" menu.
  One ranked recommendation (the Money Map), with alternatives mentioned
  only when genuinely close.
- Every recommendation carries the **trust receipt**: a collapsible "why
  Arik believes this" block (facts extracted from the patient's documents,
  patient-supplied facts, external evidence used, calculations,
  assumptions, missing information, confidence score, what could change
  the conclusion, source verification dates - per CASE_MODEL.md).
  Collapsed by default, one tap to expand.
- **Tier 2 confirmations** (anything leaving the system) render the
  *completed* thing - the filled form, the finished letter - with a
  one-tap confirm. The tap is legal consent, not labor: a 5-second review,
  not a 20-minute form session.
- **Tier 3 actions are never offered in the UI at all** (no "sign for the
  patient" control, no clinical-suggestion affordance). Their absence is
  the enforcement mechanism.
- When exactly one thing blocks full automation, the UI asks for that one
  thing - never a generic "tell me more."

## Sharing and caregiver surfaces (per CAREGIVER_MODE.md)

- Reviewer sharing creates an expiring, revocable link; the share sheet
  states plainly that the reviewer has no authority to act and that the
  share grants no standing with any hospital or payer. Revocation is
  one-tap and immediate.
- Caregiver mode keeps each managed patient's data visually and
  structurally separate from the caregiver's own - no merged views that
  could blur which person's record is being acted on.

## Accessibility baseline (per ACCESSIBILITY.md, all Phase 1)

WCAG 2.1 AA from the first commit: semantic HTML/ARIA on every interactive
element, `aria-live="polite"` on the streaming chat area, full keyboard
navigation, adjustable text size and high-contrast toggle, never
color-alone status indicators. Voice input/output via the browser's Web
Speech API as an optional toggle on the chat UI.

## Export surfaces (Phase 2, per EXPORT_AND_TRANSLATION.md)

Print via browser-native print CSS, save-as-image client-side, translation
toggle distinguishing "translate for the patient" from "translate for the
recipient." No backend PDF service.

## What this means for the build

Phase 1 UI is exactly: magic-link login, case list, case view (status +
deadline countdown + documents), case-scoped chat with trust receipts and
Tier 2 confirm, and the accessibility baseline. Anything past that list is
a later phase - do not add it because it looks cheap.
