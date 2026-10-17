-- db/042_agent_actions.sql
-- Phase 6 (docs/kimi/PLAN_PHASE_6.md): the one-time authorization, letter
-- signatures, tracked sends with their events, per-case return numbers and
-- replies. No IP address, user agent or device detail is stored anywhere
-- in this trail. Approvals also go to the consent ledger (lib/consent.ts).
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.
-- Deploy order: apply before the code that writes these tables (the
-- privacy cascade deletes from them, so "Delete everything" needs them).

create table if not exists agent_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text_version text not null,                 -- AUTHORIZATION_VERSION the patient saw
  text_sha256 text not null,                  -- hash of that exact text
  signer_name text not null,
  signature_png text not null,                -- data:image/png;base64,...
  signed_at timestamptz not null,
  signed_copy_sha256 text not null,           -- hash of the signed PDF
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists agent_authorizations_active on agent_authorizations (user_id) where revoked_at is null;

create table if not exists letter_signatures (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null unique references letters(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  signer_name text not null,
  signature_png text not null,
  signed_at timestamptz not null,
  signed_pdf_sha256 text not null,
  created_at timestamptz not null default now()
);

create table if not exists send_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  letter_id uuid not null references letters(id) on delete cascade,
  channel text not null check (channel in ('fax', 'mail')),
  executor text not null,                     -- which sender ran it ('demo-fax', ...)
  practice boolean not null default true,     -- true: simulated, nothing left Arik
  recipient jsonb not null,                   -- { name, fax } or { name, address }
  return_address jsonb,
  certified boolean not null default false,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval', 'queued', 'sent', 'delivered', 'failed', 'replied', 'closed', 'cancelled')),
  approved_at timestamptz,
  confirmation text,
  tracking text,
  delivered_at timestamptz,
  response_due date,
  response_rule_id text,
  response_certain boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists send_jobs_case on send_jobs (case_id);

create table if not exists send_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references send_jobs(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  kind text not null,                         -- queued, sent, delivered, failed, printed, mailed, in_transit, approved, cancelled, reply_received, overdue
  at timestamptz not null,
  detail text,                                -- plain words, no patient data
  created_at timestamptz not null default now()
);
create index if not exists send_job_events_job on send_job_events (job_id, at);

-- The trail is append-only: events are never edited.
create or replace function send_job_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'send_job_events is append-only';
end $$;
drop trigger if exists send_job_events_append_only on send_job_events;
create trigger send_job_events_append_only before update on send_job_events for each row execute function send_job_events_append_only();

create table if not exists case_inbound_numbers (
  case_id uuid primary key references cases(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  number text not null unique,
  executor text not null,
  created_at timestamptz not null default now()
);

create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  job_id uuid references send_jobs(id) on delete set null,
  document_id uuid references uploaded_documents(id) on delete set null,
  source text not null check (source in ('inbound_fax', 'upload')),
  practice_text text,                         -- the synthetic text of a practice inbound fax (never a real reply)
  classification text not null check (classification in ('approved', 'denied_again', 'info_requested', 'collections_notice', 'corrected_bill', 'unknown')),
  signals text[] not null default '{}',
  proposal jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'dismissed')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists replies_case on replies (case_id);

-- Row security: the patient or their caregiver.
alter table agent_authorizations enable row level security;
alter table letter_signatures enable row level security;
alter table send_jobs enable row level security;
alter table send_job_events enable row level security;
alter table case_inbound_numbers enable row level security;
alter table replies enable row level security;

drop policy if exists "own" on agent_authorizations;
create policy "own" on agent_authorizations for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "agent_authorizations service-role all" on agent_authorizations;
create policy "agent_authorizations service-role all" on agent_authorizations for all to service_role using (true) with check (true);

do $$
declare t text;
begin
  foreach t in array array['letter_signatures', 'send_jobs', 'send_job_events', 'case_inbound_numbers', 'replies'] loop
    execute format('drop policy if exists "owner or caregiver" on %I', t);
    execute format('create policy "owner or caregiver" on %I for select to authenticated using (can_access_case(case_id))', t);
    execute format('drop policy if exists "%s service-role all" on %I', t, t);
    execute format('create policy "%s service-role all" on %I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- Patients read their trail; every write goes through the server (service role).
grant select on agent_authorizations, letter_signatures, send_jobs, send_job_events, case_inbound_numbers, replies to authenticated;
grant select, insert, update, delete on agent_authorizations, letter_signatures, send_jobs, send_job_events, case_inbound_numbers, replies to service_role;
