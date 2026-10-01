-- LOCAL DEVELOPMENT ONLY - never applied to any remote/Supabase project.
-- Emulates the Supabase primitives Arik's migrations assume, so
-- schema.sql + db/002.. can run against a bare local Postgres (docker
-- postgres:16, no Supabase stack):
--   * roles anon / authenticated / service_role (db/003 policies, db/004 grants)
--   * auth.users + auth.uid() (schema FKs, RLS predicates, db/005)
--   * cron schema + job table + schedule/unschedule stubs (db/009, db/022)
-- pg_cron and pg_net themselves CANNOT exist here (no extension packages
-- in the stock image); the apply script filters those two
-- `create extension` lines out of db/009 and says so loudly. pgcrypto is
-- real (contrib ships in the postgres:16 image). Everything else runs
-- exactly as written.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  raw_app_meta_data jsonb default '{}',
  raw_user_meta_data jsonb default '{}'
);
-- Service-role-only app: RLS predicates evaluate auth.uid() = null for
-- direct-SQL access, so policies deny by default (the app reads/writes
-- through the postgres role, which bypasses RLS as table owner - same
-- posture as Supabase's service role).
create or replace function auth.uid() returns uuid
  language sql stable as $$ select null::uuid $$;

-- db/008 registers the raw-uploads bucket in Supabase Storage's catalog.
-- Bare Postgres has no Storage API; only the catalog row is needed for
-- the migration to apply (file I/O itself never touches this stub).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  created_at timestamptz default now()
);

create schema if not exists cron;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique,
  schedule text,
  command text
);
-- Stubs record the schedule in cron.job so migrations behave identically
-- and tests can assert a job was registered; nothing actually runs.
create or replace function cron.schedule(job_name text, schedule text, command text)
  returns bigint language plpgsql as $$
declare
  new_id bigint;
begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid into new_id;
  return new_id;
end $$;
create or replace function cron.unschedule(job_name text) returns boolean
  language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  return found;
end $$;
