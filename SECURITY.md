# Arik: PHI/PII Handling and Security Approach

## Regulatory scope, by track

- **Consumer-direct Arik** (patient signs up themselves, no employer/payer
  relationship): very likely NOT a HIPAA-covered entity or business
  associate. HIPAA binds covered entities (providers, payers,
  clearinghouses) and their business associates - a direct-to-consumer app
  outside that relationship isn't automatically covered, same reason
  period-tracking and consumer genetic-testing apps aren't HIPAA-regulated.
- **Employer/union B2B track**: different. A self-insured employer's
  health plan is itself a HIPAA-covered group health plan. Arik likely
  becomes a business associate for that relationship specifically and
  needs a BAA plus real HIPAA-grade controls for that data. Do not treat
  consumer-track architecture as sufficient the moment an employer
  contract exists.
- **Not HIPAA-covered does not mean unregulated.** FTC Health Breach
  Notification Rule and state health-data laws (Washington's My Health My
  Data Act is the strictest currently) apply to consumer health apps
  regardless of HIPAA status. Lighter rulebook, not no rulebook.
- Revisit this section with an actual attorney (Hunter) before the
  employer/union track goes live, and before any real PHI enters the
  consumer track at scale - this is architectural guidance, not legal
  sign-off.

## Architecture: split identity from everything else

1. **Identity vault, separate and minimal.** Name, DOB, address, insurance
   member ID live in their own tightly-scoped table(s), never joined into
   the same tables as drug/exploit/price data. The core matching engine
   (drug, dose, state, insurance type, income bracket) never needs to
   touch this table - meaning the bulk of Arik's actual logic runs on data
   that isn't sensitive at all.

2. **Column-level encryption via pgcrypto, not a paid vendor vault.**
   Supabase/Postgres has `pgcrypto` built in at no extra cost. Encrypt
   identity-vault columns at the application layer before they're written;
   decrypt only at the moment of generating a filled form. Revisit a
   dedicated PII-vault service (Skyflow, Basis Theory) later if volume
   justifies it - not needed to start, and not needed for the MVP pilot.

3. **Don't collect SSN.** It's the single riskiest field on any of these
   forms. Leave it blank for the patient to fill in themselves right
   before they submit - this is the same "one field Arik couldn't fill in"
   pattern from BEHAVIOR.md, and it means the single most dangerous
   number in the whole system never touches the database at all.

4. **Don't retain raw uploaded documents past extraction.** A bill or
   denial letter gets processed by the extraction model, the structured
   findings get kept in `bill_audit_findings`/`denial_appeals`, and the
   raw document itself gets deleted or moved to encrypted cold storage
   rather than persisting as a live file. Less stored, less blast radius.

5. **Scope what each model call actually sees.** The chat response model
   answering "what's the cheapest legal price for this drug" never needs
   name, address, or SSN - only drug/dose/state/insurance/income. Only the
   final form-generation step should ever read from the identity vault,
   and that read should be as narrow as the specific form requires.

## What this means for the schema

`user_profiles` in the original schema mixed identity fields (state,
insurance_type) with matching fields. The split (now in schema.sql):
- `user_identity` (name, DOB, address, member ID, phone, email - encrypted
  columns, narrowly scoped access)
- `user_matching_profile` (state, insurance_type, income_bracket,
  household_size - the fields the matching engine actually needs, safe to
  query freely)

`uploaded_documents.storage_path` should point at short-lived storage with
an explicit deletion job, not permanent storage, once `extracted_data` has
been populated and verified.

## Cost implication (why this is the affordable path)

Paying for BAA-covered infrastructure and a dedicated PII vault across the
entire app from day one is the expensive way to do this, and mostly
unnecessary on the consumer track. Scoping encryption and access tightly
around a small identity vault, while running the actual matching/savings
logic on non-sensitive data, gets most of the real protection without
paying for compliance overhead the consumer track likely doesn't legally
require yet. Harden to full HIPAA-grade BAA compliance specifically when
the employer/union track goes live, not before.
