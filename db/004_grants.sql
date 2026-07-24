-- 004: table-level GRANTs. RLS gates ROWS; roles still need operation
-- grants on the tables. This project did not auto-grant new public tables
-- to authenticated/service_role (found by smoke test 2026-07-24), so the
-- grants are explicit here. Apply AFTER 003.
--
-- Posture: authenticated gets full DML on user-scoped tables (RLS limits
-- which rows), SELECT on reference data (no write policies exist for it).
-- service_role gets DML on everything (server routes). anon gets nothing
-- beyond what it already has (login flow only).

-- Reference data: read-only for authenticated users
grant select on
  drugs, price_points, exploits, accumulator_policies, sources,
  hospital_financial_assistance_policies, exception_precedents,
  employer_plans, referral_resources
to authenticated;

-- User-scoped tables: DML for authenticated (row access still RLS-gated)
grant select, insert, update, delete on
  user_identity, user_matching_profile,
  managed_patients, authorizations_on_file,
  cases, deadlines, escalations, case_outcomes,
  user_medications,
  uploaded_documents, bill_audit_findings, denial_appeals,
  mtm_eligibility_checks, case_referrals,
  output_documents, shared_reviews,
  chat_sessions, chat_messages
to authenticated;

-- Server role: DML on everything
grant select, insert, update, delete on all tables in schema public to service_role;

-- Match Supabase's usual posture for any FUTURE tables as well.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
