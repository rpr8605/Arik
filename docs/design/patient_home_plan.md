# Patient home: phased build plan and open questions

Companion to `patient_home_screens.md` and `patient_home_data_map.md`.

**Queue position** (agreed 2026-10-14): after the persona, call card and
demo 5a builds, including the bills and denials walkthrough. P1 depends on
`agent_actions` (call card) and the letters and confirms from 5a.

## Owner decisions (approved 2026-10-14, recorded from FIRST_RUN_AND_BRAND.md Part 3)

These settle open questions 1, 2, 3, 5 and 6 below.

1. **Save your results:** anonymous users get a "Save your results" upgrade
   (email magic link, same user id), offered right after a useful result.
   Sample accounts never get it.
2. **Retention:** chats keep purging on the current rule. Receipts, sent
   letters and confirmed savings are kept until the patient deletes them.
   (Decided, not built: the purge still removes them today. AGENTS.md and
   DATA_RETENTION.md note the change.)
3. **Member ID and card photo:** gated until after S4. The demo sample
   patient can show fictional, labeled versions.
4. **PDF library:** pdf-lib approved, exact-pinned.
5. **Employer rollup:** minimum group size 11 before any number shows.

## Phases

| Phase | Builds | Main pieces | Size |
|---|---|---|---|
| **P1: Home, jobs, documents** | Bottom nav; Home (Talk to Arik, Needs you, Saved so far, Active jobs, Coming up); Jobs list and detail timeline from existing cases; Documents with frozen PDFs and hashes | Jobs API (read-only composition plus ownership), `output_documents` status/PDF/hash columns (030), PDF generation, "Needs you" aggregator, status chip mapping, empty states, sample profile for the demo | L (2-3 sessions) |
| **P2: Profile and privacy center** | About me (masked identity), coverage (plan type, insurer, plan year, deductible; managed patients' coverage), care team, medications with confirmed/pending, people I help switcher, how Arik talks to me, notifications; privacy center with "what Arik keeps", permissions plus revoke, activity log, data download | New columns and tables listed in the data map (031+), `account_activity`, export zip, push subscriptions | L (2-3 sessions) |
| **P3: Savings confirmation and employer rollup** | "I paid $X" confirmation flow on every won job; Saved so far from confirmed outcomes only; de-identified employer rollup (totals and counts only) | Confirmation UI on existing `case_outcomes`; an aggregate view with minimum cell sizes; no individual rows ever exposed | M |

**Tests each phase adds:**
- **Ownership and caregiver separation** for every new route, using the `apiDeps` pattern.
- **Frozen documents:** a sent letter's PDF hash never changes, and re-download is byte-identical.
- **Confirmed-only totals:** "Saved so far" never counts unconfirmed money.
- **Private push and logs:** push text and the activity log never contain health details.
- **Employer rollup:** no output with a cell under the minimum size, and no names, drugs or diagnoses.

## Open questions (each with a recommendation)

1. **Anonymous accounts vs a lasting record.** Visitors are anonymous by default, and anonymous data is purged. A "record you own" needs a real sign-in.
   *Recommendation:* when the first job reaches "Needs you" or a letter is drafted, offer "Save your record: add your email" (Supabase anonymous-to-email upgrade, same user id, nothing lost). Never block the chat on it.

2. **Retention vs "the patient owns it."** Today a case and its chat are purged 90 days after resolution; only `case_summaries` survives. A results record implies keeping letters, receipts and confirmed savings longer.
   *Recommendation:*
   - Keep confirmed outcomes, receipts and sent-letter PDFs until the patient deletes them. They are the patient's record.
   - Keep purging chat transcripts and raw uploads on the current schedule.
   - Update DATA_RETENTION.md to say so, with counsel review.

3. **Member ID and insurance card photo.** AGENTS.md says member ID and group number are deliberately not collected today. The upload placeholder says never to capture a card photo until the PHI document-vault decisions are made. The prompt wants both.
   *Recommendation:* design them in, but build them only after the S4 gate (AWS hosting under a BAA, malware scanning, the encrypted vault). Until then, P2 coverage is plan type, insurer, plan year and deductible.

4. **Letter retention and "sent exactly as sent."**
   *Recommendation:* freeze the PDF at approval (not at send), store it with a SHA-256 hash, and link the send receipt to that frozen copy. Drafts can be re-generated; approved copies can't.

5. **PDF generation.**
   *Recommendation:* a small server-side library (pdf-lib, exact-pinned) with Arik's own text layout. Avoid a headless browser on the server: it's heavier, slower and another moving part on AWS. Decide before P1.

6. **Employer rollup rules.**
   *Recommendation:*
   - Aggregate only, never individual jobs.
   - A minimum cell size before any number shows (for example 11 people, the CMS small-cell convention).
   - No drug names or diagnoses.
   - Built only from patient-confirmed savings.
   - The employer agreement and counsel set the final rules.

7. **Which privacy laws actually apply to Arik** (HIPAA as a business associate or not, the FTC Health Breach Notification Rule, Washington's My Health My Data Act, state consumer health laws).
   *Recommendation:* design to the strictest (minimum necessary, access logging, BAAs with vendors, opt-in consent before health data). Flag the actual applicability to counsel, as spec section 7.2 already lists. Don't decide it in code.

8. **Notification channels.** Push is planned (M23-AC2). Email and text need vendors under a BAA.
   *Recommendation:* push first, with no health details. Add email and text only after a BAA vendor is chosen (spec 7.2 already lists the mail/fax vendor).

9. **Chat tab vs case-scoped chat.**
   *Recommendation:* keep one thread per job (CASE_MODEL.md). The center Arik tab opens the guided entry and recent job threads, so there's never one endless general chat.

10. **Activity-log scope.**
    *Recommendation:* log actions, sends, approvals, consent changes, sign-ins, identity reads, document downloads, exports and caregiver views. Don't log every page view. Store no contents, only what happened, to what, and when.
