# Patient home: screen map and wireframes

Design pass for the patient home, jobs, documents and profile prompt in
`docs/kimi/` (2026-10-14). No code yet. Data behind each screen:
`patient_home_data_map.md`; phases and open questions:
`patient_home_plan.md` (both in this folder).

**Principles**
- Chat is the front door; the record of results is why people come back.
- Every screen has one main action and big tap targets (48px or more; the
  mobile pass already enforces 44px).
- Status always appears in words plus color, never color alone.
- Empty states teach the next step.
- Mobile-first. On desktop the demo shows the same screens in the phone
  frame.

**A "job" is a case.** `cases` already has the four job kinds (Rx savings,
bill review, denial appeal, charity care), a status workflow and its
deadlines. Calls, letters and sends are **actions inside a job**
(`agent_actions` from the call card work), not separate jobs.

---

## Bottom navigation (every screen)

```
┌──────────────────────────────────────────┐
│   Home    Jobs    [ Arik ]   Docs   Me    │   5 tabs, icon + label, 56px tall,
└──────────────────────────────────────────┘   safe-area padding under it
```
- **Arik**, in the center, is the chat. Chat stays case-scoped (CASE_MODEL.md). The tab opens the guided entry ("What's going on?") with your recent job threads underneath. Picking one continues that job's thread; typing something new starts a new job.
- The tab bar hides while the keyboard is open, so the chat box keeps its space.
- The tab labeled **Me** is the Profile screen.

## Home (opens here every time)

```
┌ Sample patient, fictional ┐   (demo only)
Hi Maria.                                  [?]
┌────────────────────────────────────────┐
│  Talk to Arik                           │
│  ┌──────────────────────────────┐ [▶]  │   one tap into chat
│  │ What's going on?             │      │
│  └──────────────────────────────┘      │
└────────────────────────────────────────┘
NEEDS YOU (2)                     soonest first
┌────────────────────────────────────────┐
│ ● Looks right?  Hospital bill lines    │
│   Due today · Bill review              │
├────────────────────────────────────────┤
│ ● Approve letter  Appeal to insurer    │
│   Due Nov 3 · Denial appeal            │
└────────────────────────────────────────┘
SAVED SO FAR
┌────────────────────────────────────────┐
│   $412                                 │   confirmed only ("I paid $X")
│   confirmed savings                    │
│   + $1,180 possible, not confirmed yet │   smaller, labeled
└────────────────────────────────────────┘
ACTIVE JOBS                        See all ›
[ Rx savings · Eliquis   Arik is working ]
[ Denial appeal          Waiting on them ]
COMING UP
  Nov 3   Appeal window closes (Denial appeal)
  Nov 9   Eliquis refill
```
- **Needs you** empty state: "You're all caught up."
- **Saved so far** empty state: "When Arik saves you money and you confirm it, it adds up here."
- Never shows a dollar figure that isn't confirmed, except in the "possible" line, which is labeled as such.

## Jobs list

```
Jobs                              [ + New ]
[ All ] [ Needs you ] [ Open ] [ Done ]     filter chips
┌────────────────────────────────────────┐
│ Denial appeal · BlueShield (sample)    │
│ ◆ Needs you    Approve the appeal      │   status chip + next step
│ Appeal due Nov 3                       │
└────────────────────────────────────────┘
┌────────────────────────────────────────┐
│ Rx savings · Eliquis                   │
│ ◆ Arik is working   Finding cheapest   │
└────────────────────────────────────────┘
```

**Status chips** (plain words), mapped from the existing case statuses and pending items:

| Chip | When |
|---|---|
| **Needs you** | Any pending item for the patient (confirm, approve, sign, upload, pending fact correction), whatever the case status |
| **Arik is working** | `gathering_evidence`, `action_ready` |
| **Waiting on them** | `submitted`, `awaiting_response`, `escalated` |
| **Won** | `resolved_won` |
| **Closed** | `resolved_lost`, `closed_by_patient` (a lost job reads "Closed, not won" with its outcome) |

Empty state: "Snap a bill or ask Arik about a prescription to start your first job."

## Job detail (a timeline, newest first)

```
‹ Jobs        Denial appeal               ⋯
◆ Needs you · Appeal due Nov 3 (19 days)
NEXT: Approve the appeal letter   [ Review ]
────────────── Timeline ──────────────
Oct 14  ✉ Letter drafted: Appeal to insurer        Draft
        Sources: plan denial reason, 29 CFR 2560.503-1
Oct 14  🔎 What Arik found
        Denial code CO-50 · Appeal window 180 days
Oct 13  ⬆ You uploaded: Denial letter (EOB)
Oct 13  ✓ You confirmed: "Looks right"
────────────────────────────────────────
Money:  possible $2,340 · confirmed none yet
[ Continue with Arik ]      opens this job's chat
```

**Timeline entries come from rows that already exist, plus the new ones:**
- findings with their sources
- approvals and confirmations (consent ledger, confirmations)
- sends (`agent_actions` with receipt: to whom, channel, confirmation number)
- replies (uploads of type "reply")
- money (estimate, then the patient-confirmed outcome)
- deadlines

Every send shows "Demo, not sent" until real sending exists.

## Documents

```
Documents
[ From you ] [ From Arik ]          [ Filter: job · type · person ]
┌────────────────────────────────────────┐
│ 📄 Appeal to insurer        Approved   │
│    Denial appeal · Oct 14   [ PDF ]    │
├────────────────────────────────────────┤
│ 📄 Billing dispute          Sent ✓     │
│    Bill review · Oct 12     [ PDF ]    │   receipt attached
├────────────────────────────────────────┤
│ 📄 Itemized bill request    Demo, not sent │
└────────────────────────────────────────┘
```
- **Statuses:** Draft, Approved, Sent (with the receipt), or Demo, not sent.
- **Frozen copies:** a Sent or Approved letter downloads exactly as approved. The PDF is frozen at approval, stored, and checked against its SHA-256 hash. It is never re-generated.
- **"From you":** bills, EOBs, denial letters, card photos. Raw uploads follow the existing 48-hour purge. The extracted data stays, and the list says "Original image removed after 48 hours (privacy)."

## Me (Profile)

```
Me
About me            Maria Example · Missouri · English      ›
Coverage            Employer plan · Plan year 2026          ›
My care team        2 pharmacies · 1 prescriber            ›
My medications      Eliquis 5 mg ✓ confirmed · 1 pending   ›
People I help       Mom (Rosa) ›  [ + Add ]                  caregiver mode
How Arik talks to me  Short answers · Answer first · English ›
Notifications       Push on · Quiet 9pm-8am                 ›
Privacy center                                              ›
```
- **People I help:** one switcher at the top of Home, Jobs and Docs ("Showing: Me ▾"). Each person's jobs and documents stay separate (`managed_patient_id`). This is also where a managed patient's coverage gets set, closing the review fix C1 follow-up.
- **About me:** date of birth is asked only when a letter needs it. It's stored encrypted (`user_identity`) and shown masked ("•• /•• /1958").
- **Coverage:** card photo and member ID are designed in but gated; see the plan's open question 3.

## Privacy center

```
Privacy center
What Arik keeps about me      generated from your actual data   ›
Permissions I've given        1 active authorization  [Revoke]  ›
Who can see my stuff          Caregiver: none                   ›
My activity log               read-only                          ›
[ Download all my data ]      zip: documents, letters, receipts, profile.json
[ Delete my account ]         (existing full deletion)
```
- **"What Arik keeps"** is generated from the actual data: one line per category with a count and its retention ("3 letters, kept until you delete them"), never hand-written.
- **Activity log:** Arik actions, sends, approvals, consent changes, sign-ins, and access to identity data. The list of what counts as data access is in the data map.

## Demo

- **Sample patient:** "Maria Example, Sample patient, fictional", with:
  - one won Rx job (confirmed savings)
  - the bill and denial jobs from the bills and denials walkthrough
  - one call-card action receipt
  - a managed parent
- **Labels:** the "Sample case" tag shows on every screen, as in that walkthrough.
- **Real prices only:** savings figures come only from that sample's confirmed outcomes. Drug prices are never invented: the case shows real sourced prices or says the price isn't loaded.
