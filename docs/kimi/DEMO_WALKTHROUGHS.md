# Demo walkthroughs: all four starters, fully scripted

**Owner:** Ryan Russell
**Date:** 2026-10-15
**Put this file at:** `docs/kimi/DEMO_WALKTHROUGHS.md`
**Use:** "Follow docs/kimi/DEMO_WALKTHROUGHS.md."
**Changes DEMO_DAY.md:** this replaces the bill and denial work in stages 3 and 4 with fully scripted walkthroughs. **No CMS data loading and no live letter drafting today.** The real features get built later and swap in behind the same screens.

## The idea

Every starter button works end to end. The flows are **scripted**: fixed documents, fixed findings, fixed letters. They're there to show investors exactly how Arik will work. The visitor taps through it like the real app.

- Only in DEMO_MODE.
- No model calls in the walkthroughs (fast, free, never fails mid-pitch).
- Nothing is uploaded, nothing is sent.
- Every screen keeps the small "Sample case" tag. The last screen of each walkthrough says: "This is a demo walkthrough with sample documents. Here's how Arik will handle yours."

## Shared building blocks (build once, used by every flow)

1. **Walkthrough engine:** each flow is a script (JSON or TS fixture) of steps: Arik message, document view, highlights, choice chips, letter, send, receipt. The chat screen plays it.
2. **Choice chips drive the flow.** If the visitor types instead, Arik replies once: "In this walkthrough, tap one of the options below. For a real conversation, start a chat from the home screen." The typed text is never sent to a model.
3. **Sample document picker** (already planned): a photo-library style sheet showing only sample documents, plus the fake camera view.
4. **Reading animation:** a scanning line over the document, with rotating lines (about 1 second each, 4 to 6 seconds total). For example:
   - Bills: "Reading every line so you don't have to...", "Hunting for double charges...", "Checking codes against the billing rules...", "Comparing charges to what's typical..."
   - Denials: "Reading the fine print...", "Finding the reason they gave...", "Checking your appeal rights and deadlines..."
   - Prescriptions: "Checking manufacturer programs...", "Comparing cash and insurance...", "Looking for the lowest legal price..."
5. **Highlighted document view:** the sample document image with highlight boxes from the fixture (coordinates as percentages, so it scales). Coral = "looks wrong," amber = "worth asking about." Each box has a number badge. Tapping a box scrolls the chat to that finding, and tapping a finding pulses its box. Pinch to zoom on phones.
6. **Letter view:** shows the letter on a paper-style page, with buttons for Edit (scripted fields only, like adding a phone number), Download PDF (pdf-lib), and Attach.
7. **Send screen:**
   - Recipient: the fictional billing office or insurer appeals department, with a fictional fax number in the 555-01xx range.
   - Method: fax, mail, email or portal.
   - Attachments listed: the letter plus supporting documents.
   - A "Sign once to let Arik send for you" step: draw a signature with a finger, scripted.
   - "Send": a sending animation, then a receipt marked **"Demo, not sent"** with a reference number, the date, the method, and "We'll watch for a reply. Typical response: 30 days."
   - The job goes into the patient's Past jobs with the full timeline.
8. **Fictional only:** every person, hospital, insurer, doctor, address and phone number is made up. No real company names or logos.

---

## Flow 1: Lower my prescription cost (Maria, uninsured, Eliquis)

1. Arik: "Which medicine?" Chips: Eliquis, Zepbound, Dupixent, plus "Snap my prescription label" (opens the picker with a sample label).
2. Reading animation (prescription lines).
3. A results card: options ranked, each with its price, source and date.
   - **Prices are the one thing that isn't scripted.** They come from the real sourced rows in the database at runtime, with the trust receipt. If a price isn't loaded, the card says so.
4. Arik explains the best path in plain words, then shows the **call card**: Call now, "Before you call" script, "Have Arik connect me", and a receipt.
5. Ends with a Past jobs entry.

## Flow 2: Check a medical bill (Luis, ER visit)

1. Arik: "Let's look at it. Snap a photo or pick the bill." Opens the picker: Luis hospital bill, Luis doctor bill.
2. Reading animation (bill lines).
3. "Here's what I read": a short summary (visit date, facility, total billed $X), then a **"Looks right"** confirm chip.
4. The bill with highlights. Then Arik's findings in chat, one message each, numbered to match the boxes. For example:
   - "1. You were billed twice for the same blood test on the same day. That looks like a duplicate."
   - "2. These two codes are normally billed as one. Billing them separately raises the cost."
   - "3. You were charged for 3 days in the room, but your visit was 2 days."
   - "4. This charge is far above what's typical for this service. Worth asking about."
   Then: "That's $X in charges worth questioning." The total equals the sum of the findings.
   - Use plain words. Only name a specific public rule if it's real and verified. Otherwise describe it ("normally billed as one").
5. Arik: "Want me to challenge these?" Chips: **Dispute with the hospital billing office**, **Ask for a fully itemized bill first**, **Ask a question**.
6. Letter: the dispute letter (scripted, fictional names, lists each finding, asks to hold the account from collections while it's reviewed, includes the required footer), shown in the letter view. Then attach, then send screen, then receipt.
7. Past jobs: "ER bill dispute · Sent · Waiting on the hospital."

## Flow 3: Fight a denial (Tasha, MRI denied)

1. Picker: Tasha denial letter, Tasha EOB.
2. Reading animation (denial lines).
3. The denial letter with the denial reason, the date and the appeal deadline highlighted.
4. Arik in chat:
   - what the reason means, in plain words
   - "You have until DATE to appeal." Show the date only if the timeframe is verified; otherwise say "Your letter lists the appeal deadline here" and point to the highlight.
   - "Most people never appeal. Here's what I'd argue:" followed by 2 or 3 short points (the plan's reason, what's missing such as a doctor's letter, and the patient's right to an internal appeal and then an outside review).
5. Chips: **Appeal to the insurer**, **Ask my doctor for a letter of medical necessity**, **Do both**.
6. "Do both" makes two letters: the appeal to the insurer, and a request to the doctor's office. Each gets the letter view, attach, send screen and receipt. The deadline tracker shows the appeal date.
7. Past jobs: "MRI denial appeal · Sent · Decision due by DATE."

## Flow 4: Try a sample patient

1. A picker with the five patients (Maria, James, Dana, Luis, Tasha): photo-free avatar initials, one line each.
2. Opening one shows that patient's home: Needs you, Saved so far (tagged "Illustrative example"), Active jobs, and Past jobs with full canned history (documents, letters, receipts, replies, outcomes).
3. Each job can be replayed, and "Start" on a job runs its walkthrough.
4. James shows caregiver mode, with the Medicare copay-card block visible on his mom's case.

---

## Content

- Make the sample documents as realistic images (SVG or HTML rendered to PNG): a hospital bill, a doctor's bill, a denial letter, an EOB, a pharmacy label, an insurance card. Fictional names, a "SAMPLE" watermark, and real-looking code numbers with no CPT descriptor text.
- Letters: write them once (the model can draft them during the build), then store them as fixtures and read them through for accuracy and tone. Persona voice, no legal-advice wording, the required footer.
- All dollar amounts on fictional bills are fictional and labeled sample. The only real prices anywhere are in Flow 1, from the database.

## Rules that still apply

The grounding guard on real chat, no invented real-world prices, fictional names only, nothing sent, no em dashes, no partner names, mobile-first with 44px taps and reduced-motion support.

## Tests

- Each flow plays start to finish from its script (a Playwright click-through on iPhone 15 and Pixel 7).
- Highlights line up at 390 and 768 wide (screenshot check).
- The findings total equals the sum of the findings.
- Typing during a walkthrough never calls the model.
- Send creates a "Demo, not sent" receipt and makes no network call.
- Real uploads are rejected in DEMO_MODE.

## Order

Stage 1 (sample patients, picker, sessions, copy fixes, chat bubbles), then this file: shared blocks, then Flow 2 (the showpiece), Flow 3, Flow 1, Flow 4. Ask "push?" after each flow so the live demo improves as you go.
