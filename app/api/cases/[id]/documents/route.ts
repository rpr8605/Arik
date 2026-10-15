// Document intake (MULTI_FORMAT_UPLOAD.md): one endpoint behind both UI
// entry points ("Take a photo" and "Choose a file" - same pipeline).
// Stores the raw file in the private raw-uploads bucket, runs the
// format-appropriate preprocessing + extraction, persists the row, and
// merges any institution it finds into the case via Feature A's
// never-silent-overwrite path.
//
// Raw uploads are short-lived: raw_upload_expires_at is set at upload
// time (extraction runs synchronously right after, so upload-time and
// extraction-confirmed-time are seconds apart). 48h is a WORKING DEFAULT
// pending Hunter/legal review before the number is published in the
// Privacy Policy - not final. The purge job itself is Feature D.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { mergeExtractedFacts } from '@/lib/extractedFacts';
import {
  detectKind,
  processUpload,
  MAX_FILE_BYTES,
  type SourceFormat,
} from '@/lib/documentIntake';

const RAW_UPLOAD_TTL_HOURS = 48; // pending Hunter/legal review - see header

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();

  // Rate limits and the demo model budget, before any work (fails closed).
  const limit = await apiDeps.consumeRateLimit('documents', userId, req);
  if (!limit.allowed) return rateLimitResponse(limit, req);

  const { id: caseId } = await params;

  // Owner or caregiver of the managed patient the case belongs to
  // (mirrors RLS can_access_case), via the apiDeps seam.
  if (!(await apiDeps.canAccessCase(userId, caseId))) return notFound();

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart form field "file")' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'file too large (25MB max)' }, { status: 413 });
  }
  const kind = detectKind(file.name, file.type);
  if (!kind) {
    return NextResponse.json(
      { error: 'unsupported file type - PDF, PNG, JPEG, or HEIC only' },
      { status: 415 },
    );
  }

  const sb = supabaseAdmin();
  const docId = crypto.randomUUID();
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  const storagePath = `${userId}/${caseId}/${docId}-${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const expiresAt = new Date(Date.now() + RAW_UPLOAD_TTL_HOURS * 3600_000).toISOString();

  const { error: uploadError } = await sb.storage
    .from('raw-uploads')
    .upload(storagePath, buf, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;

  // Preprocess + extract. Failures are first-class: the row is kept with
  // extraction_status 'failed' (and still purged on schedule), never
  // silently dropped, and the caller gets a clean 502 to retry against.
  let sourceFormat: SourceFormat | null = null;
  let extraction: any = null;
  let extractionError: string | null = null;
  try {
    const result = await processUpload(kind, buf);
    sourceFormat = result.sourceFormat;
    extraction = result.extraction;
  } catch (e) {
    extractionError = (e as Error).message.slice(0, 500);
  }

  const { error: insertError } = await sb.from('uploaded_documents').insert({
    id: docId,
    user_id: userId,
    case_id: caseId,
    doc_type: extraction?.doc_type ?? 'unclassified',
    source_format: sourceFormat,
    storage_path: storagePath,
    raw_upload_expires_at: expiresAt,
    extraction_status: extraction ? 'extracted' : 'failed',
    extraction_error: extractionError,
    extracted_data: extraction,
  });
  if (insertError) throw insertError;

  if (!extraction) {
    return NextResponse.json(
      { document_id: docId, extraction_status: 'failed', error: extractionError },
      { status: 502 },
    );
  }

  // An institution named in the document is a case fact like any other -
  // same merge, same don't-silently-overwrite rule.
  const corrections = await mergeExtractedFacts(sb, userId, caseId, {
    drug_name: null,
    dose: null,
    employer_name: null,
    institution_name: extraction.institution_name,
    insurance_plan_name: null,
    prescriber_name: null,
    state_or_location: null,
  });

  return NextResponse.json(
    {
      document: {
        id: docId,
        doc_type: extraction.doc_type,
        source_format: sourceFormat,
        extraction_status: 'extracted',
      },
      extraction,
      corrections,
    },
    { status: 201 },
  );
}
