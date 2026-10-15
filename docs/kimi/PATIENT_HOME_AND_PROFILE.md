# Patient home, jobs, documents and profile

**Owner:** Ryan Russell
**Date:** 2026-10-14
**Put this file at:** `docs/kimi/PATIENT_HOME_AND_PROFILE.md`
**Use:** "Follow docs/kimi/PATIENT_HOME_AND_PROFILE.md. Design and plan only, then STOP."
**Run after:** persona, call card and demo 5a are planned. This is a design pass first; building comes later in phases.

## The idea

People open Arik to talk to Arik. But the reason they **keep** it is seeing what Arik did for them: the money saved, the letters sent, the jobs still open. Chat is the front door; the patient's record of results is what keeps them coming back. It's also what an employer's ROI report gets built from.

**Everything Arik does becomes a "job," and every job leaves a paper trail the patient owns.**

---

## 1. Screens

### Home (opens here every time)
Top to bottom:
1. **"Talk to Arik"**: the chat box, front and center. One tap and you're in the AI.
2. **Needs you**: anything waiting on the patient, such as an approval, a signature, a "Looks right?" confirm or an upload, with the soonest deadline first. If nothing is waiting, show "You're all caught up."
3. **Saved so far**: one big number. **Only confirmed savings count** (the patient confirms "I paid $X"). Estimated savings show smaller, labeled "possible."
4. **Active jobs**: cards with a status chip and the next step.
5. **Coming up**: deadlines, refill dates, appeal windows.

### Jobs (list + detail)
- Kinds: Rx savings, bill review, denial appeal, call or connect, and more later.
- Status chips, in plain words: **Needs you**, **Arik is working**, **Waiting on them**, **Won**, **Closed**.
- **Job detail is a timeline**, newest first:
  - what Arik found, with its sources
  - what the patient approved, and when
  - what was sent: to whom, how, when, and the confirmation (fax receipt, tracking number, portal reference)
  - replies received (uploaded by the patient or arriving later through a connector)
  - money: estimated, then confirmed
  - next step and deadline
  - "Continue with Arik" opens the chat already in this job's context

### Documents
- Two tabs: **From you** (uploads: bills, EOBs, denial letters, insurance cards) and **From Arik** (letters, request forms, summaries).
- Each letter shows its status: **Draft**, **Approved**, **Sent** (with the receipt attached) or **Demo, not sent**.
- **Download as PDF.** A sent letter downloads exactly as sent: a frozen copy with a hash, never re-generated.
- Filter by job, by type and by person (for caregivers).

### Profile
- **About me:** name, and date of birth only when a letter needs it. State. Language.
- **Coverage:** plan type, insurer, insurance card photo (front and back), member ID (encrypted), plan year and deductible if known.
- **My care team:** pharmacies, prescribers, providers Arik has written to.
- **My medications:** the list Arik works from, each item marked confirmed or pending.
- **People I help** (caregiver mode): switch between people; each person's jobs and documents stay separate.
- **How Arik talks to me:** the saved style preferences from the persona work (length, order), plus language.
- **Notifications:** what, how (push, email, text) and quiet hours. Push messages never include health details.

### Privacy center
- **What Arik keeps about me:** a plain-language list generated from the actual data, not hand-written.
- **Permissions I've given:** signed authorizations (for example, letting Arik act for me with an insurer), each with its date and a **Revoke** button.
- **Who can see my stuff:** caregivers and their access level.
- **My activity log:** every action, send, sign-in and data access on this account, read-only.
- **Download all my data** (one zip: documents, letters, receipts, profile as JSON) and **Delete my account**.

---

## 2. What's saved, what's logged, what's never kept

| Kind | Examples | Who sees it | How long |
|---|---|---|---|
| **Saved (the patient's record)** | Confirmed profile facts, uploads, letters, receipts, jobs, savings | Patient, plus caregivers they allow | Until they delete it, or the account retention rule |
| **Logged (audit trail)** | Every Arik action, approval, send, sign-in, data access, consent change | Patient (their own log), plus Arik admins under access rules | Append-only; follow the existing retention rule; never editable |
| **Short-lived** | Chat transcripts | Patient | Kept with the job for a set window, then summarized; the patient can delete sooner. Use the existing case retention and purge rules. |
| **Never kept** | Personality or mood inferences, full card or bank numbers, SSN, anything for advertising | Nobody | Never stored, never logged |

Rules:
- Use what already exists (cases, `output_documents`, deadlines, outcomes, the consent ledger, caregivers, `identityCrypto`, the retention and purge jobs, `agent_actions` from the call card) and say what's new.
- Sensitive identifiers (member ID, date of birth) are encrypted at rest and shown masked.
- Anything that goes into an employer report is **aggregate and de-identified only**: savings totals and counts, never names, drugs or diagnoses. Employers never see an individual's jobs.
- Design as if HIPAA applies: minimum necessary, access logging, BAAs with vendors. Flag which federal and state rules actually apply to Arik as an open question for counsel rather than guessing.

## 3. Design direction

- Same look as the chat and the phone frame. Mobile-first; desktop gets the phone frame for the demo.
- Calm, plain, roomy: big tap targets, one main action per screen, status in words plus color (never color alone).
- Empty states teach. For example, Jobs with nothing in it says "Snap a bill or ask Arik about a prescription to start your first job."
- The demo gets a filled-in sample profile, marked "Sample patient, fictional," so investors see a lived-in account.

## Deliverables for this pass (no code yet)

1. **Screen map and wireframes**: a simple page per screen in `docs/design/` (an annotated text layout is fine), plus the bottom navigation: Home, Jobs, Arik (chat), Documents, Profile.
2. **Data map**: every field, which existing table holds it or what new table and migration it needs, whether it's encrypted, and its retention.
3. **Gap list**: what the current schema and API already support vs what's new.
4. **Phased build plan**, roughly:
   - P1: Home, jobs list and detail from existing cases, the documents list with frozen PDFs
   - P2: Profile and privacy center, including data download
   - P3: Savings confirmation and the de-identified employer rollup
5. **Open questions** for Ryan, each with a recommendation.

STOP after the plan.
