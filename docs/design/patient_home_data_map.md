# Patient home: data map and gap list

Companion to `patient_home_screens.md`. Columns are from `schema.sql` and
`db/` as of commit 6afc35e (2026-10-14).

**Legend**
- **Exists:** the table and column are there today.
- **Exists, unused:** the column is in the schema, but no code reads or writes it.
- **New:** needs a migration.

Migration numbers are tentative. 027 is persona, 028 the call card, 029 the
bills and denials walkthrough, so this work starts at 030.

## 1. Data map

| Screen field | Where it lives | Status | Encrypted | Retention |
|---|---|---|---|---|
| Job (kind, status, next step, due) | `cases` (case_type, status, next_action, next_action_due) | Exists | No | 90 days after resolution, then purged; `case_summaries` survives (DATA_RETENTION.md). Extended-retention opt-in exists for managed patients. |
| Job person | `cases.managed_patient_id` | Exists | No | With the case |
| Needs you: fact corrections | `pending_fact_corrections` | Exists | No | Until resolved |
| Needs you: "Looks right?" confirms | bills and denials walkthrough (029) | New in 029 | No | With the case |
| Needs you: approvals, signatures | `agent_actions` (028) with status `requested` | New in 028 | No | With the case |
| Timeline: findings | `bill_audit_findings` (exists, unused), `denial_appeals` (exists, unused), plus the 029 findings tables | Partly exists | No | With the case |
| Timeline: sends and receipts | `agent_actions` + `agent_action_events` (028) | New in 028 | No | Receipts kept with the job; events append-only |
| Timeline: replies received | `uploaded_documents` with doc_type `reply` | Exists (new doc_type value) | No | Raw image 48h; extracted data with the case |
| Money: possible | `cases.estimated_recoverable_usd` | Exists | No | With the case |
| Money: confirmed | `case_outcomes` (refund_received_usd, revised_amount_owed_usd, future_monthly_savings_usd, savings_duration_months, `patient_confirmed`) | Exists | No | Outcome and summary survive the case purge via `case_summaries` |
| Saved so far (total) | Sum of patient-confirmed `case_outcomes`, then `case_summaries` once purged | Exists (computed) | No | As above |
| Coming up: deadlines | `deadlines` | Exists | No | With the case |
| Coming up: refill dates | `user_medications` (supply_days) plus a last-fill date | **New column** `last_fill_date` | No | With the medication |
| Documents from Arik | `output_documents` (rendered_content) | Exists | No | See the open question on letter retention |
| Letter status, frozen PDF, hash, link to send receipt | `output_documents` | **New columns** (030): `status` (draft/approved/sent/demo_not_sent), `approved_at`, `pdf_storage_path`, `pdf_sha256`, `sent_action_id` (references `agent_actions`) | PDF in Storage (encrypted at rest by the provider) | Sent copies kept until the patient deletes them (open question 4) |
| Documents from you | `uploaded_documents` | Exists | Storage | Raw 48h purge (exists); extracted data with the case |
| About me: name, DOB, address, phone, email | `user_identity` via `lib/identityCrypto.ts` | Exists | **Yes** (pgcrypto); shown masked | Until account deletion |
| State, language | `user_matching_profile` (state, preferred_language) | Exists | No | Until changed or deleted |
| Coverage: plan type | `user_matching_profile.insurance_type` | Exists | No | Until changed |
| Coverage: insurer, plan year, deductible | `insurance_plan_name` exists; insurer, plan year and deductible are **new columns** | Partly new | No | Until changed |
| Coverage: member ID, group number | `user_identity.insurance_member_id`, `insurance_group_number` | Exists, unused (deliberately not collected today) | **Yes** | Gated (open question 3) |
| Coverage: card photo (front and back) | `uploaded_documents` doc_type `insurance_card` | Designed, gated | Storage | Gated (open question 3) |
| Managed patient's coverage | `managed_patients`: **new columns** `insurance_type`, `state` | New (030) | No | With the managed patient |
| Care team: pharmacies | `pharmacies` (025) plus a **new link table** `user_pharmacies` | New | No | Until removed |
| Care team: prescribers | `user_medications.prescriber_name` and `prescriber_npi` | Exists | No | With the medication |
| Care team: providers written to | Derived from `agent_actions` recipients | Computed | No | With the actions |
| Medications (confirmed / pending) | `user_medications` plus a **new column** `confirmed_at` | Partly new | No | Until removed |
| People I help | `managed_patients`, `authorizations_on_file` | Exists | No | Until removed |
| How Arik talks to me | `user_style_prefs` (027, persona: length, order) plus `preferred_language` | New in 027 | No | Until deleted (opt-in) |
| Notifications: channels, quiet hours | **New table** `notification_prefs` | New | No | Until changed |
| Push subscriptions | **New table** `push_subscriptions` (M23-AC2) | New | No | Until revoked |
| Privacy: permissions | `authorizations_on_file` plus **new columns** `signed_at`, `revoked_at`; consent ledger for the event | Partly new | No | Append-only history; revocation never deletes the record |
| Privacy: activity log | **New append-only table** `account_activity` (actor, action, target type, target id, timestamp; no contents). Arik actions come from `agent_action_events`; consent from `consent_ledger` | New | No | Follows the existing retention rule; never editable (M21-AC4) |
| Privacy: sign-ins | Supabase `auth.audit_log_entries` (read through a server view) | Exists (platform) | No | Platform retention |
| Data download | Server-built zip from the tables above | New code, no new table (M18-AC5) | Zip built on demand, not stored | Not kept |
| Employer rollup | **New**: aggregate-only view or materialized table over confirmed outcomes | New (P3) | No identifiers | See open question 6 |
| Never kept | Personality or mood inferences, full card or bank numbers, SSN, immigration status, advertising data | Enforced by design (persona: dials never stored; NN-8) | n/a | Never |

**What "data access" means in the activity log:**
- identity reads (`decryptIdentityForForm`)
- document downloads
- data exports
- caregiver views of another person's job

Every page view is not logged. That keeps the log meaningful and avoids
logging health content.

## 2. Gap list

**Already supported (schema and API):**
- Jobs from `cases`, with status workflow, ownership and caregiver access (`canAccessCase`).
- Deadlines (engine plus table).
- Patient-confirmed outcomes (`case_outcomes.patient_confirmed`, the outcome prompt).
- Uploads with the 48-hour raw purge.
- Encrypted identity with masked reads.
- Consent ledger.
- Caregivers and managed patients.
- Full account deletion.
- Language and "simple" preferences.
- Case retention plus surviving summaries.

**Planned elsewhere (dependencies):**
- `agent_actions` and receipts (call card, 028).
- "Looks right?" confirms, findings and letters (bills and denials walkthrough, 029).
- Style preferences (persona, 027).

**New for this work:**
1. A jobs API: list, detail and timeline assembled from the rows above, ownership-checked. No new table; the timeline is composed at read time.
2. `output_documents` status, frozen PDF, hash and send link, plus PDF generation. This needs a PDF library (open question 5).
3. Coverage fields, including the managed patient's coverage (closes the C1 follow-up).
4. Medication `confirmed_at`, `last_fill_date`, and the `user_pharmacies` link table.
5. The "Needs you" aggregator: pending corrections, confirms and approvals, sorted by deadline.
6. Notification preferences, push subscriptions and the delivery job (M23-AC2). Push text never includes health details.
7. The `account_activity` audit log and its read view.
8. Data download (M18-AC5).
9. Authorization signed and revoked dates, plus a Revoke action (ledgered).
10. The employer de-identified rollup (P3).
11. Account upgrade from anonymous to email sign-in, so a record survives (open question 1).
