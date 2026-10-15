// DB loader for the plain-words case cards (lib/caseCard.ts holds the
// words). Server-only. Batched: a handful of queries for the whole list.

import { supabaseAdmin } from './supabaseAdmin';
import { caseCardText, type CaseCardText } from './caseCard';
import { sampleByKey } from './demo/samples';

interface CaseLike {
  id: string;
  case_type: string;
  status: string;
  is_sample?: boolean;
  sample_key?: string | null;
}

export async function loadCaseCards(cases: CaseLike[]): Promise<Record<string, CaseCardText>> {
  const out: Record<string, CaseCardText> = {};
  if (cases.length === 0) return out;
  const sb = supabaseAdmin();
  const ids = cases.map((c) => c.id);

  const [{ data: sessions }, { data: pending }] = await Promise.all([
    sb.from('chat_sessions').select('id, case_id').in('case_id', ids),
    sb
      .from('pending_fact_corrections')
      .select('case_id, field, created_at')
      .in('case_id', ids)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ]);
  const caseBySession = new Map((sessions ?? []).map((s) => [s.id as string, s.case_id as string]));

  // Latest assistant reply per case: whether Arik has answered, and which
  // drug it looked up (the first retrieved program's drug).
  const { data: replies } = caseBySession.size
    ? await sb
        .from('chat_messages')
        .select('session_id, retrieved_exploit_ids, created_at')
        .in('session_id', [...caseBySession.keys()])
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
    : { data: [] as { session_id: string; retrieved_exploit_ids: string[] | null }[] };
  const latestExploit = new Map<string, string | null>();
  for (const r of replies ?? []) {
    const caseId = caseBySession.get(r.session_id);
    if (!caseId) continue;
    const firstExploit = (r.retrieved_exploit_ids ?? [])[0] ?? null;
    if (!latestExploit.has(caseId)) latestExploit.set(caseId, firstExploit);
    else if (latestExploit.get(caseId) === null && firstExploit) latestExploit.set(caseId, firstExploit);
  }

  const exploitIds = [...new Set([...latestExploit.values()].filter((x): x is string => !!x))];
  const drugByExploit = new Map<string, string>();
  if (exploitIds.length) {
    const { data: exploits } = await sb.from('exploits').select('id, drugs(name)').in('id', exploitIds);
    for (const e of exploits ?? []) {
      const name = (e as { drugs?: { name?: string } | null }).drugs?.name;
      if (name) drugByExploit.set(e.id as string, name);
    }
  }

  for (const c of cases) {
    const sample = c.is_sample ? sampleByKey(c.sample_key) : null;
    const exploit = latestExploit.get(c.id) ?? null;
    out[c.id] = caseCardText({
      caseType: c.case_type,
      status: c.status,
      drugName: sample?.medications[0]?.drug ?? (exploit ? drugByExploit.get(exploit) ?? null : null),
      hasReply: latestExploit.has(c.id),
      pendingFields: (pending ?? []).filter((p) => p.case_id === c.id).map((p) => p.field as string),
    });
  }
  return out;
}
