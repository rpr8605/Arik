// DB side of the demo's sample patients (DEMO_DAY.md stage 1, db/028).
// The fixtures and every rule live in the pure lib/demo/samples.ts; this is
// the thin loader around them. Server-only (service-role client).
//
// A sample case belongs to the visitor's own (anonymous) user AND to one
// browser tab's sample session id, so two tabs get two independent copies
// and another visitor can never see either (canAccessCase still applies).

import { supabaseAdmin } from '../supabaseAdmin';
import { sampleByKey, type SampleKey } from './samples';

export interface SampleCaseRow {
  id: string;
  sample_key: string;
  sample_session_id: string;
}

// The sample fields of a case, or null for a real case. select('*') keeps
// this safe on a database where db/028 is not applied yet (no column means
// no sample).
export async function getCaseSample(caseId: string): Promise<SampleCaseRow | null> {
  const { data, error } = await supabaseAdmin().from('cases').select('*').eq('id', caseId).maybeSingle();
  if (error) throw error;
  if (!data?.is_sample) return null;
  return { id: data.id, sample_key: data.sample_key, sample_session_id: data.sample_session_id };
}

// Opening or chatting in a sample case restarts its 60-minute idle clock.
export async function touchSampleCase(caseId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('cases')
    .update({ sample_last_active_at: new Date().toISOString() })
    .eq('id', caseId)
    .eq('is_sample', true);
  if (error) throw error;
}

export async function listSampleCases(userId: string, sampleSessionId: string): Promise<SampleCaseRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('cases')
    .select('id, sample_key, sample_session_id')
    .eq('user_id', userId)
    .eq('is_sample', true)
    .eq('sample_session_id', sampleSessionId);
  if (error) throw error;
  return (data ?? []) as SampleCaseRow[];
}

// Opens this tab's copy of a sample patient, creating it on first open.
// Refreshing or coming back in the same tab returns the same case.
export async function openSampleCase(
  userId: string,
  sampleSessionId: string,
  key: SampleKey,
): Promise<{ caseId: string; sessionId: string }> {
  const sample = sampleByKey(key);
  if (!sample) throw new Error('unknown sample');
  const sb = supabaseAdmin();

  const existing = (await listSampleCases(userId, sampleSessionId)).find((c) => c.sample_key === key);
  let caseId = existing?.id ?? null;
  if (!caseId) {
    const now = new Date().toISOString();
    const { data: kase, error } = await sb
      .from('cases')
      .insert({
        user_id: userId,
        case_type: sample.caseType,
        status: 'gathering_evidence',
        is_sample: true,
        sample_key: key,
        sample_session_id: sampleSessionId,
        sample_last_active_at: now,
      })
      .select('id')
      .single();
    if (error) throw error;
    caseId = kase.id as string;
  } else {
    await touchSampleCase(caseId);
  }

  const { data: session, error: sErr } = await sb
    .from('chat_sessions')
    .select('id')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (sErr) throw sErr;
  if (session) return { caseId: caseId!, sessionId: session.id };
  const { data: created, error: cErr } = await sb
    .from('chat_sessions')
    .insert({ user_id: userId, case_id: caseId })
    .select('id')
    .single();
  if (cErr) throw cErr;
  return { caseId: caseId!, sessionId: created.id };
}

// Reset: deletes this tab's sample cases and every child row at once.
export async function resetSampleSession(userId: string, sampleSessionId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('reset_sample_session', {
    p_user: userId,
    p_sample_session: sampleSessionId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
