-- 003: RLS for every public table (Supabase exposes public via the Data
-- API, so every table gets RLS - no exceptions). Apply AFTER 002.
--
-- Access model:
-- - Reference data (drugs, prices, exploits, policies, sources, referral
--   resources, FAP policies, precedents, employer plans): readable by any
--   authenticated user; writes happen server-side via the service role
--   (which bypasses RLS), so no write policies exist here.
-- - User-owned rows: owner (and caregiver, via managed_patients) only.
-- Server routes using the service role bypass RLS entirely; these
-- policies govern any future client-direct (anon/authenticated) access.

-- Reference data: authenticated read-only
alter table drugs enable row level security;
create policy "read" on drugs for select to authenticated using (true);
alter table price_points enable row level security;
create policy "read" on price_points for select to authenticated using (true);
alter table exploits enable row level security;
create policy "read" on exploits for select to authenticated using (true);
alter table accumulator_policies enable row level security;
create policy "read" on accumulator_policies for select to authenticated using (true);
alter table sources enable row level security;
create policy "read" on sources for select to authenticated using (true);
alter table hospital_financial_assistance_policies enable row level security;
create policy "read" on hospital_financial_assistance_policies for select to authenticated using (true);
alter table exception_precedents enable row level security;
create policy "read" on exception_precedents for select to authenticated using (true);
alter table employer_plans enable row level security;
create policy "read" on employer_plans for select to authenticated using (true);
alter table referral_resources enable row level security;
create policy "read" on referral_resources for select to authenticated using (true);

-- Identity + matching profile: owner only
alter table user_identity enable row level security;
create policy "own" on user_identity for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
alter table user_matching_profile enable row level security;
create policy "own" on user_matching_profile for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Caregiver mode
alter table managed_patients enable row level security;
create policy "caregiver" on managed_patients for all to authenticated
  using ((select auth.uid()) = caregiver_user_id)
  with check ((select auth.uid()) = caregiver_user_id);
alter table authorizations_on_file enable row level security;
create policy "caregiver" on authorizations_on_file for all to authenticated
  using (exists (select 1 from managed_patients mp
                 where mp.id = managed_patient_id
                   and mp.caregiver_user_id = (select auth.uid())))
  with check (exists (select 1 from managed_patients mp
                      where mp.id = managed_patient_id
                        and mp.caregiver_user_id = (select auth.uid())));

-- Case access shared by the case owner and the caregiver of the managed
-- patient the case belongs to. Security invoker: caller's RLS still applies.
create or replace function can_access_case(p_case_id uuid) returns boolean
  language sql security invoker stable as $$
  select exists (
    select 1 from cases c
    where c.id = p_case_id
      and (c.user_id = (select auth.uid())
           or exists (select 1 from managed_patients mp
                      where mp.id = c.managed_patient_id
                        and mp.caregiver_user_id = (select auth.uid()))))
$$;

alter table cases enable row level security;
create policy "owner or caregiver" on cases for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(id))
  with check (user_id = (select auth.uid()) or can_access_case(id));
alter table deadlines enable row level security;
create policy "via case" on deadlines for all to authenticated
  using (can_access_case(case_id)) with check (can_access_case(case_id));
alter table escalations enable row level security;
create policy "via case" on escalations for all to authenticated
  using (can_access_case(case_id)) with check (can_access_case(case_id));
alter table case_outcomes enable row level security;
create policy "via case" on case_outcomes for all to authenticated
  using (can_access_case(case_id)) with check (can_access_case(case_id));
alter table case_referrals enable row level security;
create policy "via case" on case_referrals for all to authenticated
  using (can_access_case(case_id)) with check (can_access_case(case_id));

-- User-scoped working tables (owner or caregiver of the managed patient)
alter table user_medications enable row level security;
create policy "owner or caregiver" on user_medications for all to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from managed_patients mp
                    where mp.id = managed_patient_id
                      and mp.caregiver_user_id = (select auth.uid())))
  with check (user_id = (select auth.uid())
              or exists (select 1 from managed_patients mp
                         where mp.id = managed_patient_id
                           and mp.caregiver_user_id = (select auth.uid())));
alter table uploaded_documents enable row level security;
create policy "owner or caregiver" on uploaded_documents for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
alter table bill_audit_findings enable row level security;
create policy "owner or caregiver" on bill_audit_findings for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
alter table denial_appeals enable row level security;
create policy "owner or caregiver" on denial_appeals for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
alter table output_documents enable row level security;
create policy "owner or caregiver" on output_documents for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
alter table mtm_eligibility_checks enable row level security;
create policy "own" on mtm_eligibility_checks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Sharing: owner manages their shares; reviewer token-based read is
-- enforced at the application layer when Phase 2 builds it.
alter table shared_reviews enable row level security;
create policy "owner" on shared_reviews for all to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

-- Chat: session owner or caregiver of the session's case
alter table chat_sessions enable row level security;
create policy "owner or caregiver" on chat_sessions for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
alter table chat_messages enable row level security;
create policy "via session" on chat_messages for all to authenticated
  using (exists (select 1 from chat_sessions s
                 where s.id = session_id
                   and (s.user_id = (select auth.uid()) or can_access_case(s.case_id))))
  with check (exists (select 1 from chat_sessions s
                      where s.id = session_id
                        and (s.user_id = (select auth.uid()) or can_access_case(s.case_id))));
