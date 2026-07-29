// Raw-upload purge (DATA_RETENTION.md rule 1): deletes the Storage
// object for every uploaded_document whose raw_upload_expires_at has
// passed, keeping the row + extracted_data (that's rule-2 case data with
// its own lifecycle). 48h is a WORKING DEFAULT pending Hunter/legal
// review before the number is published in the Privacy Policy.
//
// Why an HTTP job and not the pg_cron SQL function: SQL cannot delete
// Storage objects. This route is the invocable unit the schedule calls
// (pg_cron -> pg_net -> here, or an external cron while the app has no
// public origin). The Supabase Edge Function at
// supabase/functions/purge-expired-uploads/ mirrors this exact contract
// for when its deploy is unblocked (MCP/CLI access - see db/009).
//
// Auth: the service-role key as bearer, i.e. the same secret the cron
// caller holds. No user context exists for a system job.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const BATCH_LIMIT = 500;

export async function POST(req: NextRequest) {
  const expected = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
  if ((req.headers.get('authorization') ?? '') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: docs, error } = await sb
    .from('uploaded_documents')
    .select('id, storage_path')
    .not('storage_path', 'is', null)
    .lt('raw_upload_expires_at', new Date().toISOString())
    .limit(BATCH_LIMIT);
  if (error) throw error;

  if ((docs ?? []).length === 0) {
    return NextResponse.json({ purged: 0 });
  }

  const paths = docs!.map((d) => d.storage_path as string);
  // Fail loud on the storage delete: rows keep their storage_path and are
  // retried next run instead of being marked purged while the object
  // actually lingers.
  const { error: removeError } = await sb.storage.from('raw-uploads').remove(paths);
  if (removeError) throw removeError;

  const { error: updateError } = await sb
    .from('uploaded_documents')
    .update({ storage_path: null })
    .in('id', docs!.map((d) => d.id));
  if (updateError) throw updateError;

  return NextResponse.json({ purged: docs!.length });
}
