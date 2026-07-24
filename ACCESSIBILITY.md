# Arik: Accessibility

## Why this matters more here than average

The population most likely to need Arik overlaps heavily with populations
already underserved by inaccessible healthcare software - older patients,
patients managing chronic conditions, patients already dealing with one
hard thing (a bill, a denial, a diagnosis) who don't have bandwidth left
to fight a bad interface too. This isn't a nice-to-have layered on later;
build it into the base UI from the start, since retrofitting accessibility
into a chat app after the fact is real rework, and doing it right the
first time costs almost nothing extra.

## Vision impaired: mostly free if built right from day one

The chat format is actually a good starting point for screen reader users
- text is inherently more accessible than a graphical dashboard - but only
if built correctly:

- **Semantic HTML and proper ARIA roles** on every interactive element
  (inputs, buttons, the chat thread itself) - this is a "build it this way
  the first time" cost, not an added feature
- **`aria-live="polite"` on the streaming chat response area** so a screen
  reader announces new content as it streams in, rather than staying
  silent or reading everything at once when it finally finishes
- **Full keyboard navigation** - every action (send message, confirm a
  Tier 2 action, review a filled form) reachable and operable without a
  mouse
- **Adjustable text size and a high-contrast mode** - a CSS variable-driven
  theme (already the plan per the frontend-design approach) makes this
  cheap to add as a toggle rather than a rebuild
- **Never rely on color alone** to convey meaning (e.g., a red "denied"
  vs. green "approved" status also needs a text label or icon, not just
  color) - required for WCAG AA compliance and costs nothing to do from
  the start
- **Target WCAG 2.1 AA** as the baseline, not AAA - AA is achievable
  without much extra engineering, AAA has real tradeoffs not worth making
  for a lean team right now

## Hard of hearing: already well-served by default

Text-based chat is inherently accessible to deaf and hard-of-hearing
users - the main risk is *adding* audio-dependent features without a
visual equivalent. Rule going forward: any audio cue, alert, or
notification added later needs a visual/text equivalent shipped alongside
it, never audio-only.

## Voice agent: cheap tier now, upgrade path later

**Cheapest possible option: the browser's native Web Speech API**
(`SpeechRecognition` for voice-to-text input, `SpeechSynthesis` for
text-to-speech output). Built into Chrome, Edge, and Safari already - zero
marginal API cost, no extra infrastructure, works entirely client-side.
This is the "doesn't need to be perfect" tier you're describing: a person
can speak their question instead of typing, and have Arik's response read
aloud, with no added backend cost at all.

Real limitations to know going in:
- Quality and browser support varies - Safari/iOS has some quirks, and
  recognition accuracy isn't as good as a dedicated speech API
- No server-side processing means you can't easily log/improve on voice
  interactions the way you could with a hosted STT service
- Works as an add-on to the existing chat UI, not a replacement -
  frame it as "you can also talk to Arik" rather than a separate voice
  product

**Upgrade path if/when it's worth the cost:** swap in a hosted STT (e.g.
Whisper API, cheap per-minute) for input and a proper TTS service for
output, once there's a reason to invest in it - better accuracy, ability
to log and improve, consistent quality across browsers. Not needed to
start; the free browser API tier is a legitimate v1.

## What this means for the build

- Frontend-design work should default to accessible component patterns
  from the start (this is a "build it right" cost, not new scope) -
  worth flagging explicitly to Kimi/OpenCode since accessibility is easy
  to skip silently if not called out in the handoff
- Add a voice toggle to the chat UI using the Web Speech API - small,
  cheap addition to the existing chat frontend, not a separate build
  track
- No schema changes needed for this - it's entirely a frontend/UI
  concern layered on top of the existing chat architecture
