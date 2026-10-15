-- db/026_rate_limits.sql
-- Abuse and cost protection for the public demo (RUN_ORDER item 0,
-- M01-AC7 moved up from S4, 2026-10-14). Fixed-window counters behind one
-- atomic function; the limit table itself lives in lib/rateLimit.ts.
-- Applies to: local dev + Supabase project. Idempotent: yes.
-- Deploy order: apply this BEFORE deploying the code that calls it. The
-- limiter fails closed (503), so code without this function stops chat,
-- uploads and case creation.

-- 1. Counters. subject is a user id, a keyed hash of the client IP (never
-- the raw IP), or 'all' for the combined anonymous cap. Rows older than
-- two days are purged hourly (section 3).
create table if not exists rate_limit_counters (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, subject, window_start)
);

alter table rate_limit_counters enable row level security;
drop policy if exists "rate_limit_counters service-role all" on rate_limit_counters;
create policy "rate_limit_counters service-role all" on rate_limit_counters
  for all to service_role using (true) with check (true);
grant select, insert, update, delete on rate_limit_counters to service_role;

-- 2. consume_rate_limits(user, checks): all-or-nothing. Every window is
-- checked first; counts are incremented only when ALL checks pass, so a
-- blocked request never burns budget in another window (in particular the
-- combined anonymous cap). Rows are locked in a fixed order, so concurrent
-- calls serialize instead of deadlocking.
--
-- p_checks: jsonb array of
--   { bucket, subject, window_seconds, limit_authed, limit_anon }
-- A null limit for the caller's kind skips that check (e.g. the combined
-- anonymous cap has limit_authed null).
--
-- Anonymous-ness comes from auth.users.is_anonymous, not from the app. A
-- user id with no auth.users row is treated as anonymous (the stricter
-- limits).
--
-- Returns { allowed, bucket, retry_after_seconds } - bucket and
-- retry_after_seconds only when blocked.
create or replace function consume_rate_limits(p_user uuid, p_checks jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  is_anon boolean;
  resolved jsonb;
  c record;
begin
  select coalesce(u.is_anonymous, false) into is_anon from auth.users u where u.id = p_user;
  if not found then
    is_anon := true;
  end if;

  -- Resolve each check to a concrete window start and the caller's limit
  -- (a jsonb value, not a temp table: no objects are created inside this
  -- security definer function).
  select coalesce(jsonb_agg(jsonb_build_object(
           'bucket', x.bucket,
           'subject', x.subject,
           'window_seconds', x.window_seconds,
           'window_start', to_timestamp(floor(extract(epoch from now()) / x.window_seconds) * x.window_seconds),
           'lim', case when is_anon then x.limit_anon else x.limit_authed end)), '[]'::jsonb)
    into resolved
    from jsonb_to_recordset(p_checks)
      as x(bucket text, subject text, window_seconds integer, limit_authed integer, limit_anon integer)
   where (case when is_anon then x.limit_anon else x.limit_authed end) is not null;

  -- Make sure every counter row exists, then lock them in key order.
  insert into rate_limit_counters (bucket, subject, window_start, count)
    select k.bucket, k.subject, k.window_start, 0
      from jsonb_to_recordset(resolved) as k(bucket text, subject text, window_start timestamptz)
    on conflict do nothing;

  for c in
    select k.bucket, k.window_start, k.window_seconds, k.lim, r.count
      from jsonb_to_recordset(resolved)
             as k(bucket text, subject text, window_start timestamptz, window_seconds integer, lim integer)
      join rate_limit_counters r
        on r.bucket = k.bucket and r.subject = k.subject and r.window_start = k.window_start
     order by k.bucket, k.subject, k.window_start
       for update of r
  loop
    if c.count + 1 > c.lim then
      return jsonb_build_object(
        'allowed', false,
        'bucket', c.bucket,
        'retry_after_seconds',
          greatest(1, ceil(extract(epoch from (c.window_start + make_interval(secs => c.window_seconds) - now())))::integer)
      );
    end if;
  end loop;

  update rate_limit_counters r
     set count = r.count + 1
    from jsonb_to_recordset(resolved) as k(bucket text, subject text, window_start timestamptz)
   where r.bucket = k.bucket and r.subject = k.subject and r.window_start = k.window_start;

  return jsonb_build_object('allowed', true);
end;
$$;

-- Server-only. A security definer function is callable through the REST
-- API by any role that has EXECUTE, so it is revoked from everyone except
-- the service role.
revoke all on function consume_rate_limits(uuid, jsonb) from public;
revoke all on function consume_rate_limits(uuid, jsonb) from anon, authenticated;
grant execute on function consume_rate_limits(uuid, jsonb) to service_role;

-- 3. Hourly purge of windows older than two days (the longest window is
-- one day).
create or replace function purge_rate_limit_counters() returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  n integer;
begin
  delete from rate_limit_counters where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function purge_rate_limit_counters() from public;
revoke all on function purge_rate_limit_counters() from anon, authenticated;
grant execute on function purge_rate_limit_counters() to service_role;

-- cron.job rejects direct DML on Supabase - unschedule()/schedule() only.
select cron.unschedule('purge-rate-limit-counters') where exists
  (select 1 from cron.job where jobname = 'purge-rate-limit-counters');
select cron.schedule('purge-rate-limit-counters', '20 * * * *', $job$select purge_rate_limit_counters();$job$);
