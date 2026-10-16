-- db/036_policy_documents.sql
-- Free data loaders, Part B (docs/kimi/free_data_loaders.md, 2026-10-16):
-- Medicare coverage rules from the CMS Medicare Coverage Database (V1):
-- NCDs, LCDs and billing Articles, one row per document (the current
-- version), loaded weekly (MCD publishes on Thursdays). M13-AC1.
-- Text is HTML-stripped and cut to a short citation excerpt; code lists
-- are numbers only (CPT/HCPCS descriptions are never stored); ICD-10 lists
-- are counted, not stored, to keep the demo database small.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

create table if not exists policy_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('NCD', 'LCD', 'Article')),
  doc_id text not null,                 -- MCD system id (LCD/Article) or NCD id
  version int not null,
  display_id text not null,             -- L33252, A52369, DL..., DA..., NCD 310.1
  title text not null,
  status text not null,                 -- 'A' approved, 'P'/'R' as MCD writes it
  is_draft boolean not null default false,
  national boolean not null default false,
  contractors text[] not null default '{}',     -- "Name (number)"
  jurisdictions text[] not null default '{}',   -- state abbreviations
  effective_date date,
  retirement_date date,
  hcpcs_codes text[] not null default '{}',     -- numbers only
  icd10_codes_count int not null default 0,
  citation_excerpt text,                -- plain text, a few sentences
  related_documents text[] not null default '{}', -- e.g. the LCD an Article belongs to
  source_url text not null,             -- the document's MCD page
  retrieved_date date not null,
  next_check_date date not null,
  source_id uuid not null references sources(id),
  unique (doc_type, doc_id)
);
create index if not exists policy_documents_hcpcs on policy_documents using gin (hcpcs_codes);
create index if not exists policy_documents_states on policy_documents using gin (jurisdictions);

alter table policy_documents enable row level security;
drop policy if exists "policy_documents authenticated read" on policy_documents;
create policy "policy_documents authenticated read" on policy_documents for select to authenticated using (true);
drop policy if exists "policy_documents service-role all" on policy_documents;
create policy "policy_documents service-role all" on policy_documents for all to service_role using (true) with check (true);
grant select on policy_documents to authenticated;
grant select, insert, update, delete on policy_documents to service_role;
