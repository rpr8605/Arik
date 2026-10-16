-- db/034_routing_partners.sql
-- Prescription routing, Part B (docs/kimi/rx_routing_build.md, 2026-10-16).
-- Mock only: no real partner is registered here, and none may be named in
-- this repo. A real partner row is added after the data use agreement.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

-- 1. Partners. Neutral by construction:
--    - compensation_to_arik accepts exactly one value, 'none' (no fee,
--      revenue share, referral payment, data fee or favor, ever);
--    - display and AI processing default to false;
--    - a partner can't be enabled without a data use agreement date.
create table if not exists routing_partners (
  id uuid primary key default gen_random_uuid(),
  partner_label text not null unique,          -- public label; never a company name in this repo
  enabled boolean not null default false,
  allow_patient_display boolean not null default false,
  allow_ai_processing boolean not null default false,
  compensation_to_arik text not null default 'none',
  data_use_agreement_date date,
  created_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'routing_partners_no_compensation') then
    alter table routing_partners add constraint routing_partners_no_compensation check (compensation_to_arik = 'none');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routing_partners_enabled_needs_dua') then
    alter table routing_partners add constraint routing_partners_enabled_needs_dua
      check (not enabled or data_use_agreement_date is not null);
  end if;
end $$;

-- 2. Routing intents. The partner sees only `reference` (opaque, random)
--    and the destination; never patient identifiers.
create table if not exists routing_intents (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references routing_partners(id),
  case_id uuid references cases(id) on delete cascade,
  reference text not null unique,
  external_intent_id text,
  destination jsonb not null,                  -- pharmacy name, NPI, NCPDP, address: public pharmacy facts only
  status text not null default 'created'
    check (status in ('created', 'sent_to_prescriber', 'received', 'filled', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routing_intents_case on routing_intents (case_id);

-- 3. Kill switch / purge audit (counts only).
create table if not exists routing_partner_events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references routing_partners(id) on delete set null,
  action text not null check (action in ('disable', 'enable', 'purge')),
  detail jsonb,
  created_at timestamptz not null default now()
);

-- RLS: internal tables (service role only). The public /how-we-route page
-- reads enabled partner labels server-side with the service role.
alter table routing_partners enable row level security;
drop policy if exists "routing_partners service-role all" on routing_partners;
create policy "routing_partners service-role all" on routing_partners for all to service_role using (true) with check (true);
alter table routing_intents enable row level security;
drop policy if exists "routing_intents service-role all" on routing_intents;
create policy "routing_intents service-role all" on routing_intents for all to service_role using (true) with check (true);
alter table routing_partner_events enable row level security;
drop policy if exists "routing_partner_events service-role all" on routing_partner_events;
create policy "routing_partner_events service-role all" on routing_partner_events for all to service_role using (true) with check (true);
grant select, insert, update, delete on routing_partners, routing_intents, routing_partner_events to service_role;
