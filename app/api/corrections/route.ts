// Resolves pending fact corrections (CONVERSATIONAL_ENTITY_EXTRACTION.md's
// don't-silently-overwrite rule). The Thread UI surfaces each correction
// as a one-tap confirm; nothing is applied until the patient says so.
//
// POST { id, action: 'confirm' | 'dismiss' }
//   confirm -> write new_value onto the target row (whitelisted targets
//              only - target_table/field come from our own merge code, but
//              the row id crosses the wire, so validate anyway)
//   dismiss -> keep the existing value, close the correction

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ALLOWED_TARGETS: Record<string, string[]> = {
  user_matching_profile: ['employer_name', 'insurance_plan_name', 'state_or_location_raw', 'zip_code', 'state'],
  user_medications: ['prescriber_name'],
  cases: ['institution_name'],
};

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const id = typeof body.id === 'string' ? body.id : '';
  const action = body.action;
  if (!id || (action !== 'confirm' && action !== 'dismiss')) {
    return NextResponse.json({ error: "id and action ('confirm'|'dismiss') are required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: correction } = await sb
    .from('pending_fact_corrections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  // Owner only - a correction is meaningless (and a write vector) for
  // anyone else, caregiver included.
  if (!correction || correction.user_id !== userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (correction.status !== 'pending') {
    return NextResponse.json({ error: `already ${correction.status}` }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (action === 'dismiss') {
    const { error } = await sb
      .from('pending_fact_corrections')
      .update({ status: 'dismissed', resolved_at: now })
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ status: 'dismissed', field: correction.field });
  }

  if (!ALLOWED_TARGETS[correction.target_table]?.includes(correction.field)) {
    return NextResponse.json({ error: 'target is not writable via corrections' }, { status: 400 });
  }

  const { error: applyError } = await sb
    .from(correction.target_table)
    .update({ [correction.field]: correction.new_value })
    .eq('id', correction.target_id);
  if (applyError) throw applyError;

  const { error } = await sb
    .from('pending_fact_corrections')
    .update({ status: 'confirmed', resolved_at: now })
    .eq('id', id);
  if (error) throw error;

  return NextResponse.json({
    status: 'confirmed',
    field: correction.field,
    value: correction.new_value,
  });
}
