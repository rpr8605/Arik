-- Arik: consolidated schema (Supabase / Postgres)
-- Single source of truth. This supersedes the original schema.sql, which
-- had two real problems fixed here: (1) forward-reference errors (tables
-- referencing user_profiles before it was defined), and (2) several
-- tables that were specced in later docs (CASE_MODEL.md, CAREGIVER_MODE.md,
-- EMPLOYER_PLAN_DATABASE.md, REFERRAL_NETWORK.md, EXCEPTION_INTELLIGENCE_
-- ENGINE.md, EXPORT_AND_TRANSLATION.md) but never actually added here.
-- Same pattern throughout: nothing ships without a source_id, enforced at
-- the application layer (DB does not constrain this yet - see comment below).

-- ============================================================
-- IDENTITY AND MATCHING PROFILE (split per SECURITY.md correction)
-- ============================================================
-- Identity fields (name, DOB, address, member ID) are kept narrow and
-- separate from matching fields (state, insurance type, income bracket)
-- so the core matching engine never needs to touch sensitive data at all.
-- Column-level encryption via pgcrypto belongs on user_identity's
-- sensitive columns at the application layer - not expressed in raw DDL
-- here since it depends on the encryption approach chosen at build time.

create table user_identity (
  id uuid primary key references auth.users(id),
  full_name text,
  date_of_birth date,
  address text,
  phone text,
  email text,
  insurance_member_id text,
  insurance_group_number text,
  -- Deliberately no immigration/citizenship status column anywhere in this
  -- schema. Per IMMIGRATION_STATUS_HANDLING.md, that status is checked
  -- ephemerally at the moment a specific program's eligibility depends on
  -- it and is never persisted. Do not add this column.
  -- Deliberately no SSN column. Per SECURITY.md, SSN is left for the
  -- patient to enter directly on a form immediately before submission,
  -- never stored.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table user_matching_profile (
  id uuid primary key references auth.users(id),
  state text,
  zip_code text,                    -- per LOCATION_SERVICES.md; state can be derived from this
  insurance_type text,               -- 'employer', 'marketplace', 'medicare_part_d', 'medicaid', 'uninsured'
  insurance_plan_name text,          -- raw plan name as stated ("Cigna PPO"), per CONVERSATIONAL_ENTITY_EXTRACTION.md; informs accumulator_policies matching
  state_or_location_raw text,        -- raw location text as extracted ("Austin, TX"); zip_code/state are resolved from it deterministically in code
  preferred_language text default 'en', -- per UNIVERSAL_ACCESS.md: full-conversation language, generated directly not translated. Launch scope: 'en'/'es' only (non-English extraction quality unvalidated - launch decision, not technical)
  income_bracket text,               -- optional, only if patient wants PAP/charity-care matching
  household_size int,                -- optional, same opt-in pattern as income
  preferred_pharmacy text,
  employer_name text,                -- optional, for EMPLOYER_PLAN_DATABASE.md matching
  chronic_conditions text[],         -- optional, for REFERRAL_NETWORK.md's MTM eligibility matching
  -- Demographic eligibility fields per DEMOGRAPHIC_ELIGIBILITY.md: opt-in,
  -- additive only, never affects core pricing logic, independently
  -- deletable from the rest of the profile. Modeled as a separate jsonb
  -- blob rather than individual columns so any single category can be
  -- cleared without a schema migration.
  demographic_eligibility_flags jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- CAREGIVER MODE (per CAREGIVER_MODE.md - core infrastructure, not Phase 2)
-- ============================================================

create table managed_patients (
  id uuid primary key default gen_random_uuid(),
  caregiver_user_id uuid references auth.users(id),
  patient_name text not null,
  relationship text,                -- 'parent', 'spouse', 'child', etc
  zip_code text,                     -- managed patient's own location may differ from the caregiver's
  extended_retention boolean default false, -- per DATA_RETENTION.md: recurring-care opt-in that exempts this patient's cases from the post-resolution purge; every change is consent-ledgered
  created_at timestamptz default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,        -- 'manufacturer_program_terms', 'pbm_policy_doc', 'cms_data',
                                      -- 'state_statute', 'news', 'congressional_investigation', 'court_ruling'
  title text,
  url text,
  evidence_grade text,              -- 'A', 'B', 'C', 'D', 'unverified' - per METHODOLOGY.md/CASE_MODEL.md
  -- Evidence freshness fields, per CASE_MODEL.md - citations alone don't
  -- prove information is still current.
  effective_date date,
  expiration_date date,
  last_verified_at timestamptz,
  superseded_by uuid references sources(id),
  content_hash text,
  next_review_due date,
  retrieved_at timestamptz default now()
);

create table authorizations_on_file (
  id uuid primary key default gen_random_uuid(),
  managed_patient_id uuid references managed_patients(id),
  entity_name text not null,         -- 'Medicare', specific hospital, specific payer
  authorization_type text,           -- 'authorized_representative', 'hipaa_release', 'blue_button_oauth'
  status text default 'not_started', -- 'not_started', 'form_generated', 'submitted', 'on_file'
  document_id uuid,                  -- references uploaded_documents(id), added as FK below after that table exists
  created_at timestamptz default now()
);

-- ============================================================
-- THE CASE MODEL (per CASE_MODEL.md - the core unit of the product)
-- ============================================================

create table cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id), -- nullable
  case_type text not null,           -- 'bill_dispute', 'denial_appeal', 'prescription_savings', 'charity_care'
  amount_at_risk_usd numeric,
  estimated_recoverable_usd numeric,
  status text default 'gathering_evidence',
    -- 'gathering_evidence', 'action_ready', 'submitted', 'awaiting_response',
    -- 'resolved_won', 'resolved_lost', 'closed_by_patient', 'escalated'
  organizations_involved text[],
  institution_name text,              -- hospital/clinic named in conversation or documents, per CONVERSATIONAL_ENTITY_EXTRACTION.md; drives charity-care matching against hospital_financial_assistance_policies
  next_action text,
  next_action_due date,
  resolved_at timestamptz,            -- set when status enters resolved_won/resolved_lost/closed_by_patient; starts the retention clock (90d working default, pending Hunter/legal review)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table deadlines (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  rule_jurisdiction text,             -- 'federal', state code, or payer-specific
  plan_type text,
  notice_date date,
  presumed_receipt_date date,
  filing_deadline date not null,
  extension_available boolean default false,
  extension_conditions text,
  escalation_path text,
  required_attachments text[],
  source_id uuid references sources(id),
  last_verified_at timestamptz,
  created_at timestamptz default now()
);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  escalation_score int,
  reason text,
  reviewer_type text,                 -- 'billing_advocate', 'revcycle_specialist', 'pharmacist',
                                        -- 'medicare_specialist', 'attorney'
  status text default 'queued',       -- 'queued', 'in_review', 'reviewed', 'declined'
  created_at timestamptz default now()
);

-- Outcome verification, per CASE_MODEL.md point 12 - required before any
-- success fee, never a simple yes/no.
create table case_outcomes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  original_amount_owed_usd numeric,
  revised_amount_owed_usd numeric,
  refund_received_usd numeric,
  future_monthly_savings_usd numeric,
  savings_duration_months int,        -- null if ongoing/indefinite
  proof_document_id uuid,             -- references uploaded_documents(id), FK added below
  caused_by_arik boolean,
  is_recurring boolean,
  patient_confirmed boolean default false,
  arik_confidence text,               -- mirrors evidence_grade style: high/medium/low
  created_at timestamptz default now()
);

-- The aggregate that outlives the case (DATA_RETENTION.md): when the
-- post-resolution purge deletes a case's working detail, this small
-- "here's what happened" summary survives. case_outcomes alone was
-- checked and is NOT sufficient for this (no case_type, no final status,
-- no resolution date, and it doesn't always exist) - this is the smallest
-- table that satisfies the requirement. Written only by the purge job.
create table case_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id),
  case_type text not null,
  institution_name text,
  final_status text not null,          -- 'resolved_won', 'resolved_lost', 'closed_by_patient'
  original_amount_owed_usd numeric,    -- amounts carried from the latest case_outcomes row, when one exists
  revised_amount_owed_usd numeric,
  refund_received_usd numeric,
  future_monthly_savings_usd numeric,
  resolved_at timestamptz not null,
  created_at timestamptz default now()
);

-- ============================================================
-- DRUG PRICING (Phase 1 core)
-- ============================================================

create table drugs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_names text[],
  generic_available boolean default false,
  drug_class text,
  common_conditions text[],
  created_at timestamptz default now()
);

create table user_medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id),
  drug_id uuid references drugs(id),
  dose text,
  supply_days int default 30,
  current_monthly_cost_usd numeric,  -- what they're paying today, for savings-delta math
  prescriber_name text,              -- needed for PAP applications, per SCENARIOS.md Scenario 2
  prescriber_npi text,
  created_at timestamptz default now()
);

create table price_points (
  id uuid primary key default gen_random_uuid(),
  drug_id uuid references drugs(id),
  price_type text not null,           -- 'list', 'ira_negotiated', 'cash_pay', 'nadac', 'medicare_part_d', 'direct_to_patient' (db/013: manufacturer-run cash channel)
  dose text,
  supply_days int,
  unit_count int,                     -- db/013: tablets/capsules per fill; distinguishes same-day-supply tiers (e.g. Eliquis DTP 60 vs 74 tabs, both 30-day)
  price_usd numeric,
  effective_date date,
  source_id uuid references sources(id),
  created_at timestamptz default now()
);

create table exploits (
  id uuid primary key default gen_random_uuid(),
  drug_id uuid references drugs(id),
  exploit_type text not null,         -- see METHODOLOGY.md section 3 for the full 14-category taxonomy
  title text not null,
  description text not null,
  eligibility_criteria jsonb,         -- income, insurance type, state, and (per DEMOGRAPHIC_ELIGIBILITY.md) optionally demographic criteria
  estimated_savings_usd numeric,
  status text default 'active',       -- 'active', 'closed', 'under_review'
  closed_reason text,
  -- Discount-card-network-specific fields, per PHARMACIST_AND_REVCYCLE_
  -- FORMATS.md and BLUE_BUTTON_AND_DISCOUNT_GRAPH.md - required for
  -- pharmacist-card rendering and for collapsing duplicate networks.
  underlying_processor text,          -- the real PBM/processor behind a branded card (e.g. OptumRx behind AARP's card)
  bin_number text,
  pcn_number text,
  group_id text,
  source_id uuid references sources(id),
  last_verified_at timestamptz,
  -- db/011: do this program's terms reduce the card maximum when maximizer-
  -- program enrollment is detected? null = not yet checked (NOT "no clause").
  reduced_if_maximizer_detected boolean,
  created_at timestamptz default now()
);

create table accumulator_policies (
  id uuid primary key default gen_random_uuid(),
  pbm_name text not null,
  plan_type text,
  policy_type text,                   -- 'accumulator', 'maximizer'
  drug_class_affected text,
  copay_card_counts_toward_oop boolean,
  effective_date date,
  source_id uuid references sources(id),
  created_at timestamptz default now()
);

-- Nothing in `exploits` or `accumulator_policies` should be inserted
-- without a source_id. Enforce at the application layer until you're
-- ready for a DB constraint.

-- db/012: pharmacy counter-reality checklist (NCPDP field 308-C8 Other
-- Coverage Codes). Lets chat surface the legitimate resubmission path when
-- a copay card/coupon bounces at the counter. source_id is NOT NULL here,
-- unlike the older reference tables - new tables don't repeat the
-- app-layer-only gap.
create table counter_override_guidance (
  id uuid primary key default gen_random_uuid(),
  code_system text not null,           -- 'ncpdp_other_coverage_code' (field 308-C8)
  code_value text not null,            -- '0'..'8'
  official_definition text not null,   -- definition as published by the cited payer document
  plain_language text not null,        -- what it means at the counter, in patient terms
  counter_action text not null,        -- the legitimate verify/resubmit path for pharmacy staff
  source_id uuid not null references sources(id),
  created_at timestamptz default now(),
  unique (code_system, code_value)
);

-- ============================================================
-- BILL AUDITOR / DENIAL APPEALS / CHARITY CARE (Phase 1.5, parallel track)
-- ============================================================

create table uploaded_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),
  managed_patient_id uuid references managed_patients(id),
  doc_type text not null,             -- 'itemized_bill', 'eob', 'denial_letter', 'insurance_card', 'spd'; 'unclassified' when extraction failed
  source_format text,                 -- per MULTI_FORMAT_UPLOAD.md: 'camera_capture', 'pdf_native', 'pdf_scanned', 'image_upload' (how the file arrived - separate axis from doc_type's what-it-is)
  storage_path text,                  -- raw file in the private 'raw-uploads' Storage bucket; short-lived - deletion job runs per DATA_RETENTION.md
  raw_upload_expires_at timestamptz,  -- raw upload purge deadline (48h working default, pending Hunter/legal review)
  extraction_status text,             -- 'extracted', 'failed' (row kept either way; failed rows carry extraction_error)
  extraction_error text,
  extracted_data jsonb,
  created_at timestamptz default now()
);

-- Now that uploaded_documents exists, attach the deferred FKs:
alter table authorizations_on_file
  add constraint fk_auth_doc foreign key (document_id) references uploaded_documents(id);
alter table case_outcomes
  add constraint fk_outcome_proof_doc foreign key (proof_document_id) references uploaded_documents(id);

create table bill_audit_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),
  bill_document_id uuid references uploaded_documents(id),
  eob_document_id uuid references uploaded_documents(id),
  finding_type text not null,         -- 'duplicate_charge', 'upcoding', 'wrong_network', 'incorrect_oop_calc',
                                        -- 'missing_contractual_adjustment', 'coordination_of_benefits_error', etc
  cpt_hcpcs_code text,                -- per PHARMACIST_AND_REVCYCLE_FORMATS.md - needed for revcycle-format disputes
  description text not null,
  disputed_amount_usd numeric,
  confidence text,
  status text default 'flagged',      -- 'flagged', 'disputed', 'resolved', 'dismissed'
  created_at timestamptz default now()
);

create table denial_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),
  denial_document_id uuid references uploaded_documents(id),
  payer_name text,                    -- deadline varies by payer, not just the ERISA floor
  claim_type text,                    -- 'urgent', 'pre_service', 'post_service'
  appeal_deadline date,
  denial_reason text,
  coverage_criteria_cited text,
  draft_appeal_text text,
  status text default 'drafted',      -- 'drafted', 'submitted', 'won', 'lost', 'escalated'
  created_at timestamptz default now()
);

create table hospital_financial_assistance_policies (
  id uuid primary key default gen_random_uuid(),
  hospital_name text not null,
  fpl_income_threshold_pct int,
  covers_underinsured boolean default false,
  source_id uuid references sources(id),
  last_verified_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- EXCEPTION INTELLIGENCE ENGINE (per EXCEPTION_INTELLIGENCE_ENGINE.md)
-- ============================================================

create table exception_precedents (
  id uuid primary key default gen_random_uuid(),
  requested_item text not null,
  diagnosis_description text,
  insurer_name text,
  plan_type text,                     -- 'commercial', 'marketplace', 'medicare_advantage', 'self_funded'
  jurisdiction text,
  original_denial_reason text,
  policy_referenced text,
  evidence_submitted text,
  outcome text,                       -- 'upheld', 'overturned', 'plan_reversed'
  decisive_reasoning text,            -- the field that actually matters - what changed the result
  review_level text,                 -- 'internal', 'external', 'alj', 'court'
  decision_date date,
  source_id uuid references sources(id),
  reliability text,                  -- mirrors evidence_grade
  created_at timestamptz default now()
);

-- ============================================================
-- EMPLOYER PLAN KNOWLEDGE BASE (per EMPLOYER_PLAN_DATABASE.md)
-- ============================================================

create table employer_plans (
  id uuid primary key default gen_random_uuid(),
  employer_name text not null,
  region text,
  plan_year int,
  plan_tier_name text,
  extracted_plan_facts jsonb,          -- scrubbed of any uploader's identity before storage - see doc
  contributing_upload_count int default 1,
  confidence text,
  last_updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ============================================================
-- REFERRAL NETWORK (per REFERRAL_NETWORK.md and ATTORNEY_REFERRAL.md)
-- ============================================================

create table mtm_eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  chronic_conditions_count int,
  part_d_medication_count int,
  estimated_annual_drug_cost_usd numeric,
  meets_condition_criteria boolean,
  meets_medication_count_criteria boolean,
  meets_cost_threshold boolean,
  eligible boolean,
  checked_at timestamptz default now()
);

create table referral_resources (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,         -- 'mtm_pharmacist', 'billing_advocate', 'hospital_financial_counselor',
                                         -- 'disease_foundation_advocate', 'attorney', 'dietitian_care_coordinator'
  name text,
  organization text,
  region text,
  contact_info jsonb,
  cost_to_patient text,                -- 'free', 'sliding_scale', 'standard_fee' - set explicitly, never assumed
  -- Attorney-specific note: per ATTORNEY_REFERRAL.md, this table must
  -- never support pay-for-placement or ranking-by-payment. Any fee
  -- arrangement, if one exists, is a flat/non-contingent value stored
  -- here for disclosure only, never a ranking input.
  source_id uuid references sources(id),
  created_at timestamptz default now()
);

create table case_referrals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  referral_resource_id uuid references referral_resources(id),
  reason text,                         -- the specific factual trigger, e.g. 'mtm_eligible', 'active_collections_threat'
  status text default 'suggested',     -- 'suggested', 'contacted', 'in_progress', 'resolved'
  created_at timestamptz default now()
);

-- ============================================================
-- EXPORT / TRANSLATION / SHARING (per EXPORT_AND_TRANSLATION.md, CAREGIVER_MODE.md)
-- ============================================================

create table output_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),
  source_type text not null,           -- 'denial_appeal', 'bill_dispute', 'pap_application', 'phone_script'
  source_id uuid,                      -- points at denial_appeals.id, bill_audit_findings.id, etc - polymorphic, not an FK
  audience_format text not null,       -- 'phone_script', 'formal_letter', 'printable_handout', 'form_ready',
                                         -- 'pharmacist_card', 'revcycle_dispute'
  language text default 'en',
  rendered_content text not null,
  created_at timestamptz default now()
);

create table shared_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id),
  managed_patient_id uuid references managed_patients(id),
  source_type text not null,           -- 'bill_audit_finding', 'denial_appeal', 'uploaded_document'
  source_id uuid not null,
  permission text default 'view',      -- 'view', 'comment' - never able to trigger a Tier 2 action
  share_token text unique not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- CHAT (per BEHAVIOR.md, CASE_MODEL.md - chat is how the patient talks to a case)
-- ============================================================

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),   -- per CASE_MODEL.md's correction: chat is scoped to a case, not one long thread
  created_at timestamptz default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id),
  role text not null,                  -- 'user' or 'assistant'
  content text not null,
  retrieved_exploit_ids uuid[],        -- audit trail: which exploits/rows grounded this answer
  created_at timestamptz default now()
);

-- ============================================================
-- CONVERSATIONAL ENTITY EXTRACTION (per CONVERSATIONAL_ENTITY_EXTRACTION.md)
-- ============================================================

-- Case-scoped facts extracted before a case exists (pre-case chat), keyed
-- to the user. Migrated into the case record when one is created, then
-- deleted. Generic fact_type/fact_value so new extractable facts don't
-- need a migration.
create table pending_case_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  fact_type text not null,             -- 'institution_name', 'prescriber_name', ...
  fact_value text not null,
  created_at timestamptz default now()
);

-- The don't-silently-overwrite rule, made durable: when a new extraction
-- contradicts an existing non-null value, the new value waits here for a
-- one-tap patient confirm instead of being applied. A pending correction
-- never blocks use of the existing value.
create table pending_fact_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  case_id uuid references cases(id),   -- nullable: profile-field corrections aren't case-scoped
  target_table text not null,          -- 'user_matching_profile', 'user_medications', 'cases'
  target_id uuid not null,             -- row id in target_table
  field text not null,                 -- column name, whitelisted at the apply layer
  old_value text,
  new_value text not null,
  status text default 'pending',       -- 'pending', 'confirmed', 'dismissed'
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- ============================================================
-- CONSENT LEDGER (per SECURITY.md as cited by DATA_RETENTION.md)
-- ============================================================

-- Append-only audit of every consent-relevant choice: language preference,
-- extended-retention opt-ins, demographic eligibility opt-ins/clears.
-- Broader logging is the safer default for a compliance-sensitive ledger.
-- Rows are never updated or deleted; "revoking" a choice is a new row.
-- Written only by the service role; patients can read their own history.
create table consent_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  category text not null,              -- 'language', 'extended_retention', 'demographic_eligibility'
  action text not null,                -- 'set', 'opt_in', 'opt_out', 'clear'
  detail jsonb,                        -- e.g. {"language": "es"}, {"demographic_category": "race"}
  created_at timestamptz default now()
);
