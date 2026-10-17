# Phase 6 plan: agent actions, signing, sending and the tracker (2026-10-17)

Owner request 2026-10-17: Phase 6 with demo executors, real vendors stubbed
behind interfaces; plus (same day) signing with a one-time authorization,
fax and mail executors, the "Arik watches it" tracker with reply reading,
and tests on synthetic replies. Synthetic data only. DEMO_MODE unchanged
(the scripted walkthrough keeps its own send screen; every real-path route
is 403 in DEMO_MODE).

## Pieces (pure first, thin data layer after, same as the bill and denial paths)

1. **Action registry** (`lib/actions/registry.ts`): every action has a tier
   (BEHAVIOR.md 0 to 3), what only the patient may do (sign, approve,
   attest, pay, marketing opt-in), whether it leaves the system, what it
   requires (authorization on file, frozen letter, signed letter, patient
   approval) and whether it leaves a receipt. `canRun()` decides; tests
   prove sign/attest/pay/opt-in are impossible without the patient
   (M16-AC8) and nothing leaves the system without approval.
2. **Authorization and signing** (`lib/actions/authorization.ts`,
   `signature.ts`): a one-time authorization for Arik to prepare, send and
   track letters and receive replies for the patient. The text is a
   PLACEHOLDER, versioned and flagged for counsel
   (docs/legal_review_before_launch.md). Finger signature (PNG from the
   in-app pad), signed copy rendered as a PDF, sha256 stored, timestamp.
   A signed letter = the frozen letter's PDF plus the signature and a
   "Signed electronically" line; its own hash. No IP address or device
   data is stored anywhere in the trail.
3. **Senders** (`lib/actions/senders.ts`): `FaxSender` (outbound, delivery
   confirmation, per-case inbound number) and `MailSender` (print and
   mail, certified with tracking). Demo executors now: deterministic,
   labeled "Practice send", nothing leaves Arik. Real executors are stubs
   that refuse until a vendor that signed a BAA is configured
   (`SEND_EXECUTOR`). One contract suite for both.
4. **Tracker** (`lib/actions/tracker.ts`): each send is a job with events
   (queued, sent, delivered, failed, reply received, overdue). The response
   deadline comes only from verified rules, counted from the delivery date
   (the plan's receipt): plan decisions on appeals reuse the Phase 5
   decision limits; external review 45 days. Letters with no verified rule
   (bill disputes, records requests, claim file, specific reason) get no
   deadline, said plainly. Overdue = past due with no reply.
5. **Replies** (`lib/actions/replies.ts`): inbound fax (demo: a synthetic
   reply delivered to the case's practice number) or patient upload; the
   text is read and classified (approved, denied again, info requested,
   collections notice, corrected bill, or unknown). Arik proposes the next
   step; the patient approves or dismisses it. Approving a proposal drafts
   a letter at most; sending it is its own approval.
6. **Notifications** (`lib/actions/notify.ts`): fixed words, no names,
   amounts, dates, plan names or health details. Built and tested; no
   delivery channel yet (email/SMS vendor is a later decision).

## Data (db/042)

`agent_authorizations`, `letter_signatures`, `send_jobs`, `send_job_events`
(append-only), `case_inbound_numbers`, `replies`. Consent ledger rows for
the authorization and every approval. RLS owner or caregiver. Privacy
cascade covers every table.

## Screens

After a letter is frozen (bill or denial): authorization once, sign,
choose fax or mail, one-screen review, one tap to approve, receipt. A
"Tracking" card on the case: jobs with their timelines, due dates,
overdue, replies and proposals.

## Tests

test_actions (registry, authorization text and signed copies, senders
contract on both demo executors and the refusing stubs, notifications),
test_tracker (each deadline rule and overdue at its edges), test_replies
(a synthetic reply for each classification, plus next-step proposals),
auth guards for every new route, a live smoke.

## Gated (not built)

Real fax/mail/e-sign vendors (each must sign a BAA), counsel's
authorization text, a notification delivery channel, inbound fax webhooks.
