-- db/039_bill_reference_data.sql
-- Medicare reference data for the bill checks (lib/rules/bills/checks.ts).
-- Code numbers and numbers only: CPT descriptions are AMA copyright and are
-- never stored. Loaded by scripts/load_bill_refs.ts (local database only);
-- the demo database gets a trimmed set through the reviewed export flow.
-- - bill_ref_mue: Medicare unit limits per code per day (or per line),
--   CMS NCCI MUE tables, quarterly. Direct CMS downloads.
-- - bill_ref_pfs: Physician Fee Schedule national amounts (total RVUs x
--   conversion factor), RVU file, quarterly. Direct CMS download.
-- - bill_ref_ptp: procedure-to-procedure pairs. The CMS files sit behind
--   the AMA license page; the table stays EMPTY until the owner accepts
--   that license. The check finds nothing without it (no guessing).
-- - bill_ref_datasets: which version of each is loaded, from where.
-- Applies to: local dev + Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

create table if not exists bill_ref_datasets (
  name text primary key check (name in ('mue_practitioner', 'mue_outpatient_hospital', 'pfs', 'ptp_practitioner', 'ptp_outpatient_hospital')),
  version text not null,                -- e.g. 'mue-2026q4-oph'
  source_url text not null,
  effective_date date,
  retrieved_date date not null,
  row_count int not null,
  source_id uuid not null references sources(id)
);

create table if not exists bill_ref_mue (
  setting text not null check (setting in ('practitioner', 'outpatient_hospital')),
  code text not null,
  unit_limit int not null check (unit_limit >= 0),
  adjudication smallint not null check (adjudication in (1, 2, 3)),  -- 1 per line, 2 per day (policy), 3 per day (clinical)
  primary key (setting, code)
);

create table if not exists bill_ref_pfs (
  code text primary key,
  facility_usd numeric(10, 2) not null,
  non_facility_usd numeric(10, 2) not null
);

create table if not exists bill_ref_ptp (
  setting text not null check (setting in ('practitioner', 'outpatient_hospital')),
  col1 text not null,
  col2 text not null,
  modifier smallint not null check (modifier in (0, 1, 9)),
  effective_date date not null,
  deletion_date date,
  primary key (setting, col1, col2, effective_date)
);
create index if not exists bill_ref_ptp_col2 on bill_ref_ptp (setting, col2);

do $$
declare t text;
begin
  foreach t in array array['bill_ref_datasets', 'bill_ref_mue', 'bill_ref_pfs', 'bill_ref_ptp'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s authenticated read" on %I', t, t);
    execute format('create policy "%s authenticated read" on %I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists "%s service-role all" on %I', t, t);
    execute format('create policy "%s service-role all" on %I for all to service_role using (true) with check (true)', t, t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end $$;
