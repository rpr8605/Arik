# First-run experience and brand

**Owner:** Ryan Russell
**Date:** 2026-10-14
**Put this file at:** `docs/kimi/FIRST_RUN_AND_BRAND.md`
**Use:** "Follow docs/kimi/FIRST_RUN_AND_BRAND.md."

## Before you start

1. Phase 0 check: `git status`, `git log --oneline -10`. If the persona work isn't committed yet, finish and commit it first, then do this file.
2. Order after this file: program call card (item 4), then demo 5a (with the bills and denials walkthrough), then patient home P1 to P3.
3. Work locally. Commit locally. **Don't push** until Ryan says so.

---

## Part 1: Logo and brand

- Look in `public/` for the existing Arik logo files: app icon, favicon, A mark, "Arik Health" wordmark, OG share image. Copy any Ryan adds into `public/brand/`.
- Brand colors, taken from the logo: **navy #325773** and **teal #109890**. Make these the app's main colors (CSS variables), replacing any generic grays used as accents.
- **Clean SVGs:** trace the A mark and the wordmark from the largest PNGs (potrace or similar, run from the scratchpad and not added to the project).
  - Match the colors exactly.
  - Drop the faint light-blue fringe inside the A.
  - Keep the shapes identical.
  - Show Ryan the SVG next to the original before using it. If it doesn't match, use the PNGs.
- Use the SVG for the splash and the header. Keep the PNGs for the favicon, app icon and share image.
- Never recolor or redesign the logo.

## Part 2: First-run experience

Goal: opening the demo should feel like opening the Arik app for the first time, not a page of buttons.

1. **Splash:** on first load per session, show the logo centered on the brand background. Fade in about 0.8s, hold briefly, about 1.2s total, then fade to home. Skip it on later page changes and when reduced motion is on.
2. **Header:** the logo top left, about 28px tall. Language as a tiny "EN | ES" pill top right. **English is the default.** Remove the big language card. Language changes still go through the existing consent path.
3. **Demo bar:** replace the yellow block with one thin bar (about 28px) at the very top, deep coral-red with white text, scrolling like a ticker:
   "Demo, sample data only. Nothing you enter is saved. Close the tab and it resets."
   Pause it on tap or hover. Show static text when reduced motion is on. Use real text with good contrast, not an image.
4. **Welcome screen:**
   - An Arik greeting bubble using the persona intro line, then: "Tell me what's going on, or tap one to start."
   - Four big starter buttons with simple, consistent icons: **Lower my prescription cost**, **Check a medical bill**, **Fight a denial**, **Try a sample patient**. Until the bill and denial walkthroughs (5a) exist, those two show a short "coming in this demo soon" note.
   - A **"Try it with a real drug"** row with the Eliquis, Dupixent and Zepbound buttons, compact or as a scroll strip.
   - The chat box pinned at the bottom.
5. **Polish:** a subtle entrance animation on the cards (off with reduced motion), a consistent icon style, navy and teal throughout, no generic gray boxes. It should feel warm, calm and modern.
6. **Copy:** no em dashes anywhere in the UI. Replace the existing ones (for example "Demo build —" and "right now — start") with periods, commas or colons. Add a validator check that fails on any em dash in user-facing strings in `app/` and `lib/`.

## Part 3: Demo decisions to record (apply if not already in the plans)

Add these to the 5a and patient-home plan docs so they aren't lost:

**Temporary sample accounts**
- The sample session id lives in sessionStorage only. Closing the tab or leaving the site ends it, and reopening gives a fresh copy. Moving between pages and refreshing keep changes.
- A pg_cron job deletes sample cases and their child rows after 60 minutes idle, and Reset deletes them right away.
- Samples never get the "Save your results" upgrade, never use patient-home retention, and are excluded from outcomes and savings totals.
- Test: rows are gone after the idle purge, and no session sees another visitor's changes.

**Canned history in sample accounts**
- Each sample patient has 1 to 3 past jobs with a full timeline: documents received, letters Arik prepared, a "sent" receipt, a reply from the other side, and the outcome.
- Letters "from Arik" are real output: generate them once with the actual letter engine from the fictional facts and store them as fixtures.
- Bills, EOBs and replies are fictional, with made-up company, hospital and doctor names. No real insurer, hospital or PBM names, logos or letterhead.
- Every document carries a subtle "SAMPLE" watermark, and the PDF download works.
- Outcomes show an "Illustrative example" tag.

**Patient home decisions (approved)**
1. Anonymous users get a "Save your results" upgrade with an email magic link, offered right after a useful result.
2. Chats purge on the current rule. Receipts, sent letters and confirmed savings are kept until the patient deletes them. Update AGENTS.md and the retention docs.
3. Member ID and card photo are gated until after S4. The demo sample patient can show fictional, labeled versions.
4. pdf-lib approved, exact-pinned.
5. Employer rollup: minimum group size 11.

---

## Test

- The mobile emulator runs again: WebKit and Chromium on iPhone 15, iPhone SE, Pixel 7 and Galaxy S8, plus landscape.
- Check: the splash shows once; the ticker scrolls and pauses on tap; the EN | ES toggle works; starter buttons are 44px or larger; there's no sideways scroll; the logo is crisp at 1x and 3x.
- `npm test`, typecheck and the validator all pass, including the new em dash check.

## Report (under 12 lines)

- Commits (hashes)
- Screenshots of the splash, welcome screen and a chat at 390 wide, plus the SVG-vs-original comparison
- Tests: pass/fail counts
- Anything UNVERIFIED
- Then STOP and wait for "push"
