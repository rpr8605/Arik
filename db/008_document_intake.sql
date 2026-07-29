-- 008: Feature C - multi-format document intake (MULTI_FORMAT_UPLOAD.md,
-- GUIDED_DOCUMENT_SCANNING.md). Apply AFTER 007. Idempotent.
--
-- - source_format: how the file arrived ('camera_capture', 'pdf_native',
--   'pdf_scanned', 'image_upload') - a separate axis from doc_type
--   (what the document IS). pdf_native vs pdf_scanned records which of
--   the two PDF paths ran (text-first, vision fallback), which is also
--   the cost-tracking signal MULTI_FORMAT_UPLOAD.md asks for.
-- - extraction_status / extraction_error: extraction failures are kept
--   as first-class rows ('failed'), never silently dropped - the raw
--   file is still purged on schedule.
-- - raw_upload_expires_at: purge deadline for the raw Storage object.
--   48h is a WORKING DEFAULT pending Hunter/legal review before the
--   number is published in the Privacy Policy - not final.
-- - raw-uploads bucket: private; service-role only (no authenticated
--   object policies - the client never reads raw files back, extraction
--   is server-side). Feature D's storage-deleting purge runs through an
--   Edge Function for exactly this reason.

alter table uploaded_documents add column if not exists source_format text;
alter table uploaded_documents add column if not exists raw_upload_expires_at timestamptz;
alter table uploaded_documents add column if not exists extraction_status text;
alter table uploaded_documents add column if not exists extraction_error text;

insert into storage.buckets (id, name, public)
values ('raw-uploads', 'raw-uploads', false)
on conflict (id) do nothing;
