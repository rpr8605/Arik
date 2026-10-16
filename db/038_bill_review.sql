-- db/038_bill_review.sql
-- Phases 2 to 4 (docs/kimi/PLAN_PHASES_2_4.md): real bill intake, review
-- and letters. Reuses the tables schema.sql already has:
-- - uploaded_documents.extracted_data holds what the reader produced; the
--   patient's "Looks right" copy goes in confirmed_data (nothing
--   downstream runs on unconfirmed data, M09-AC4).
-- - bill_audit_findings holds the findings, one row per finding, now with
--   the lines it points at, its tone and the reference data version.
-- New: letters (drafts, versions, the frozen copy and its hash).
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.
-- Deploy order: apply before the code that writes these columns.

alter table uploaded_documents add column if not exists reader text;              -- which Extractor read it
alter table uploaded_documents add column if not exists confirmed_data jsonb;     -- ConfirmedBill after "Looks right"
alter table uploaded_documents add column if not exists confirmed_at timestamptz;

alter table bill_audit_findings add column if not exists finding_key text;        -- Finding.id, stable per document
alter table bill_audit_findings add column if not exists line_indexes int[];      -- into confirmed_data.lines
alter table bill_audit_findings add column if not exists tone text;
alter table bill_audit_findings add column if not exists data_version text;       -- 'builtin-v1', 'mue-2026q4-...', 'pfs-rvu26d'
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bill_audit_findings_tone') then
    alter table bill_audit_findings add constraint bill_audit_findings_tone check (tone is null or tone in ('wrong', 'ask'));
  end if;
end $$;
create unique index if not exists bill_audit_findings_doc_key on bill_audit_findings (bill_document_id, finding_key) where finding_key is not null;

create table if not exists letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  bill_document_id uuid references uploaded_documents(id) on delete set null,
  letter_type text not null check (letter_type in ('itemized_bill_request', 'billing_dispute', 'hold_collections', 'insurer_appeal', 'medical_necessity_request', 'financial_assistance_cover')),
  version int not null default 1,
  subject text not null,
  body text not null,
  footer text not null,
  drafter text not null,                -- which LetterDrafter wrote it
  used_fallback boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'frozen')),
  frozen_at timestamptz,
  content_sha256 text,                  -- hash of subject + body + footer when frozen
  created_at timestamptz not null default now(),
  unique (case_id, letter_type, version),
  check ((status = 'frozen') = (frozen_at is not null and content_sha256 is not null))
);

alter table letters enable row level security;
drop policy if exists "owner or caregiver" on letters;
create policy "owner or caregiver" on letters for all to authenticated
  using (user_id = (select auth.uid()) or can_access_case(case_id))
  with check (user_id = (select auth.uid()) or can_access_case(case_id));
drop policy if exists "letters service-role all" on letters;
create policy "letters service-role all" on letters for all to service_role using (true) with check (true);
grant select, insert, update, delete on letters to authenticated;
grant select, insert, update, delete on letters to service_role;

-- A frozen letter's content never changes: it downloads exactly as frozen.
-- Only the link columns (bill_document_id set null when a document goes)
-- may still change. Letters go with their case (cascade) today; keeping
-- sent letters past the 90-day purge is the 2026-10-14 decision, not built.
create or replace function letters_frozen_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'frozen' and (new.subject, new.body, new.footer, new.status, new.frozen_at, new.content_sha256, new.letter_type, new.version, new.drafter, new.used_fallback)
     is distinct from (old.subject, old.body, old.footer, old.status, old.frozen_at, old.content_sha256, old.letter_type, old.version, old.drafter, old.used_fallback) then
    raise exception 'letter % is frozen; write a new version instead', old.id;
  end if;
  return new;
end $$;
drop trigger if exists letters_frozen_guard on letters;
create trigger letters_frozen_guard before update on letters for each row execute function letters_frozen_guard();
