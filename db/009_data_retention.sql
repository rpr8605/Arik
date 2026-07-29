-- 009: Feature D - data retention automation (DATA_RETENTION.md). Apply
-- AFTER 008. Idempotent.
--
-- Retention windows are WORKING DEFAULTS pending Hunter/legal review
-- before the numbers are published in the Privacy Policy - not final:
--   raw uploads: 48h post-extraction-confirmed (set at upload in
--     Feature C's route; purge runs via the HTTP job, not SQL, because
--     SQL cannot delete Storage objects)
--   case data:   90 days post-resolution (this file's purge function,
--     run by pg_cron below)
--   identity:    tied to the account, delete-on-request only (unchanged)
--
-- Caregiver tension (DATA_RETENTION.md): managed_patients.extended_
-- retention is the recurring-care opt-in that exempts a patient's cases
-- from the purge; case_summaries is the aggregate that outlives the
-- case's working detail either way. case_outcomes alone was checked and
-- is NOT sufficient as the summary (no case_type, no final status, no
-- resolution date, and it doesn't always exist).

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table cases add column if not exists resolved_at timestamptz;
alter table managed_patients add column if not exists extended_retention boolean default false;

create table if not exists case_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id),
  case_type text not null,
  institution_name text,
  final_status text not null,
  original_amount_owed_usd numeric,
  revised_amount_owed_usd numeric,
  refund_received_usd numeric,
  future_monthly_savings_usd numeric,
  resolved_at timestamptz not null,
  created_at timestamptz default now()
);

-- Read-only for the owner/caregiver; written only by the purge function
-- (runs as postgres via pg_cron, which bypasses RLS).
alter table case_summaries enable row level security;
drop policy if exists "owner or caregiver" on case_summaries;
create policy "owner or caregiver" on case_summaries for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from managed_patients mp
                    where mp.id = managed_patient_id
                      and mp.caregiver_user_id = (select auth.uid())));

-- Row-only purge (pg_cron calls this directly - no Storage objects are
-- touched here; raw uploads were already purged at 48h by the HTTP job,
-- and SQL cannot delete Storage objects). Snapshots case_summaries
-- BEFORE deleting so the aggregate outlives the detail.
create or replace function purge_expired_cases() returns integer
  language plpgsql
  set search_path = public
as $$
declare
  expired uuid[];
begin
  select coalesce(array_agg(c.id), '{}') into expired
  from cases c
  where c.resolved_at is not null
    and c.resolved_at < now() - interval '90 days'  -- working default, pending Hunter/legal review
    and not exists (
      select 1 from managed_patients mp
      where mp.id = c.managed_patient_id
        and mp.extended_retention
    );

  if coalesce(array_length(expired, 1), 0) = 0 then
    return 0;
  end if;

  insert into case_summaries (
    user_id, managed_patient_id, case_type, institution_name, final_status,
    original_amount_owed_usd, revised_amount_owed_usd, refund_received_usd,
    future_monthly_savings_usd, resolved_at
  )
  select
    c.user_id, c.managed_patient_id, c.case_type, c.institution_name, c.status,
    o.original_amount_owed_usd, o.revised_amount_owed_usd, o.refund_received_usd,
    o.future_monthly_savings_usd, c.resolved_at
  from cases c
  left join lateral (
    select o.*
    from case_outcomes o
    where o.case_id = c.id
    order by o.created_at desc
    limit 1
  ) o on true
  where c.id = any(expired);

  delete from chat_messages
    where session_id in (select id from chat_sessions where case_id = any(expired));
  delete from chat_sessions where case_id = any(expired);
  delete from pending_fact_corrections where case_id = any(expired);
  delete from case_referrals where case_id = any(expired);
  delete from deadlines where case_id = any(expired);
  delete from escalations where case_id = any(expired);
  delete from case_outcomes where case_id = any(expired);
  delete from bill_audit_findings where case_id = any(expired);
  delete from denial_appeals where case_id = any(expired);
  delete from output_documents where case_id = any(expired);
  update authorizations_on_file set document_id = null
    where document_id in (select id from uploaded_documents where case_id = any(expired));
  delete from uploaded_documents where case_id = any(expired);
  delete from cases where id = any(expired);

  return array_length(expired, 1);
end;
$$;

-- Scheduled deletion (DATA_RETENTION.md: "needs to actually run on a
-- schedule, not just exist as a capability"). Daily at 04:15 UTC.
-- cron.job rejects direct DML on Supabase (writes are denied even to
-- postgres; reads are fine) - use the supported unschedule/schedule API.
select cron.unschedule('purge-expired-cases') where exists
  (select 1 from cron.job where jobname = 'purge-expired-cases');
select cron.schedule('purge-expired-cases', '15 4 * * *', $job$select purge_expired_cases();$job$);

-- The raw-upload purge CANNOT be a SQL statement (Storage objects), so it
-- runs hourly via pg_net -> Edge Function. The function source lives at
-- supabase/functions/purge-expired-uploads/ and its deploy is PENDING:
-- the MCP session is bound to the wrong Supabase project and the CLI
-- account does not include the Arik project (found 2026-07-28). The Next
-- route /api/jobs/purge-expired-uploads implements the identical purge
-- against the app today (same bearer-auth contract the cron uses).
-- Once the Edge Function is deployed (or the app has a public origin),
-- enable the schedule:
--   delete from cron.job where jobname = 'purge-expired-raw-uploads';
--   select cron.schedule('purge-expired-raw-uploads', '45 * * * *', $job$
--     select net.http_post(
--       url := 'https://iwayoxmpbueneagdkpzj.supabase.co/functions/v1/purge-expired-uploads',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     );
--   $job$);
-- (key via Supabase Vault, never inline - see Supabase docs on vault)
