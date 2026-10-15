-- db/028_demo_samples.sql: sample patients for the demo (DEMO_DAY.md stage 1,
-- docs/design/demo_5a_decisions.md "Temporary sample accounts").
--
-- Sample patients are fixtures in code (lib/demo/samples.ts), never rows
-- here. "Try a sample patient" copies one into the visitor's own account as
-- a case marked is_sample, keyed by a per-tab sample session id that lives
-- only in the browser's sessionStorage. Closing the tab ends the session;
-- the rows are deleted after 60 minutes idle, or at once on Reset.
--
-- Samples never count: the 90-day purge skips them (so no case_summaries
-- row is ever written for one), and outcomes refuse them in code.
--
-- Idempotent. Apply to a database BEFORE deploying code that reads these
-- columns with DEMO_MODE on.

alter table cases add column if not exists is_sample boolean not null default false;
alter table cases add column if not exists sample_key text;
alter table cases add column if not exists sample_session_id text;
alter table cases add column if not exists sample_last_active_at timestamptz;

create index if not exists cases_sample_session_idx
  on cases (user_id, sample_session_id) where is_sample;
create index if not exists cases_sample_idle_idx
  on cases (sample_last_active_at) where is_sample;

-- Deletes sample cases and every child row. Refuses non-sample ids, so a
-- caller bug can never delete a real case through this path.
create or replace function delete_sample_cases(ids uuid[]) returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  doomed uuid[];
begin
  select coalesce(array_agg(id), '{}') into doomed
  from cases where id = any(ids) and is_sample;

  if coalesce(array_length(doomed, 1), 0) = 0 then
    return 0;
  end if;

  delete from chat_messages
    where session_id in (select id from chat_sessions where case_id = any(doomed));
  delete from chat_sessions where case_id = any(doomed);
  delete from pending_fact_corrections where case_id = any(doomed);
  delete from case_referrals where case_id = any(doomed);
  delete from deadlines where case_id = any(doomed);
  delete from escalations where case_id = any(doomed);
  delete from case_outcomes where case_id = any(doomed);
  delete from bill_audit_findings where case_id = any(doomed);
  delete from denial_appeals where case_id = any(doomed);
  delete from output_documents where case_id = any(doomed);
  update authorizations_on_file set document_id = null
    where document_id in (select id from uploaded_documents where case_id = any(doomed));
  delete from uploaded_documents where case_id = any(doomed);
  delete from cases where id = any(doomed);

  return array_length(doomed, 1);
end;
$$;

-- Reset: one visitor's sample cases for one tab's sample session.
create or replace function reset_sample_session(p_user uuid, p_sample_session text) returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return delete_sample_cases(array(
    select id from cases
    where is_sample and user_id = p_user and sample_session_id = p_sample_session
  ));
end;
$$;

-- Idle purge: 60 minutes since the last open or chat turn.
create or replace function purge_idle_sample_cases() returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return delete_sample_cases(array(
    select id from cases
    where is_sample
      and coalesce(sample_last_active_at, created_at) < now() - interval '60 minutes'
  ));
end;
$$;

-- Server-only, like consume_rate_limits (db/026): a security definer
-- function is callable through the REST API by any role with EXECUTE.
revoke all on function delete_sample_cases(uuid[]) from public;
revoke all on function delete_sample_cases(uuid[]) from anon, authenticated;
grant execute on function delete_sample_cases(uuid[]) to service_role;
revoke all on function reset_sample_session(uuid, text) from public;
revoke all on function reset_sample_session(uuid, text) from anon, authenticated;
grant execute on function reset_sample_session(uuid, text) to service_role;
revoke all on function purge_idle_sample_cases() from public;
revoke all on function purge_idle_sample_cases() from anon, authenticated;
grant execute on function purge_idle_sample_cases() to service_role;

-- The 90-day purge (db/009) now skips samples, so a sample never writes a
-- case_summaries row. Body unchanged apart from the is_sample filter.
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
    and not c.is_sample
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

-- Every 5 minutes, so nothing outlives 60 minutes idle by much.
-- cron.job rejects direct DML on Supabase: use unschedule/schedule only.
select cron.unschedule('purge-idle-sample-cases') where exists
  (select 1 from cron.job where jobname = 'purge-idle-sample-cases');
select cron.schedule('purge-idle-sample-cases', '*/5 * * * *', $job$select purge_idle_sample_cases();$job$);
