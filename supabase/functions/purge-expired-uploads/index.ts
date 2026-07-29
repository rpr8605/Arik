// Raw-upload purge, Edge Function form of /api/jobs/purge-expired-uploads
// (identical contract: bearer = service-role key, deletes expired Storage
// objects, nulls storage_path, keeps rows + extracted_data).
//
// DEPLOY PENDING (found 2026-07-28): the MCP session is bound to the
// wrong Supabase project and the CLI account does not include the Arik
// project. Deploy when either is fixed:
//   supabase functions deploy purge-expired-uploads --project-ref iwayoxmpbueneagdkpzj
// then enable the pg_cron -> pg_net schedule commented in
// db/009_data_retention.sql. 48h is a working default pending
// Hunter/legal review before publishing in the Privacy Policy.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BATCH_LIMIT = 500;

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${serviceKey}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
  const { data: docs, error } = await sb
    .from('uploaded_documents')
    .select('id, storage_path')
    .not('storage_path', 'is', null)
    .lt('raw_upload_expires_at', new Date().toISOString())
    .limit(BATCH_LIMIT);
  if (error) throw error;

  if (!docs || docs.length === 0) {
    return Response.json({ purged: 0 });
  }

  // Fail loud: rows keep storage_path and are retried next run.
  const paths = docs.map((d) => d.storage_path as string);
  const { error: removeError } = await sb.storage.from('raw-uploads').remove(paths);
  if (removeError) throw removeError;

  const { error: updateError } = await sb
    .from('uploaded_documents')
    .update({ storage_path: null })
    .in('id', docs.map((d) => d.id));
  if (updateError) throw updateError;

  return Response.json({ purged: docs.length });
});
