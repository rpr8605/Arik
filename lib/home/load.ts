// Patient home loader (Phase 7 P1). Server-only. Fetches the rows for the
// cases this user may see (their own and their managed patients', never
// demo samples: lib/cases.ts listCases) and hands them to the pure
// composition in lib/home/compose.ts. Read-only: no new tables.

import { supabaseAdmin } from '../supabaseAdmin';
import { listCases } from '../cases';
import { isOverdue } from '../actions/tracker';
import { comingUp, documentCards, jobCards, needsYou, savedSoFar, timeline, type HomeRows } from './compose';

const today = () => new Date().toISOString().slice(0, 10);

// Tables a database may not have yet (a migration not applied there) read as empty.
async function rows<T>(q: PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error && (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703')) return [];
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadRows(userId: string, onlyCaseId?: string): Promise<HomeRows> {
  const all = await listCases(userId);
  const cases = (onlyCaseId ? all.filter((c) => c.id === onlyCaseId) : all) as any[];
  const ids = cases.map((c) => c.id);
  if (!ids.length) return { cases: [], corrections: [], documents: [], letters: [], jobs: [], events: [], replies: [], deadlines: [], outcomes: [], findings: [], denials: [] };
  const sb = supabaseAdmin();
  const [corrections, docs, letters, signatures, jobs, events, replies, deadlines, outcomes, findings, denials] = await Promise.all([
    rows<any>(sb.from('pending_fact_corrections').select('id, case_id, field, created_at').in('case_id', ids).eq('status', 'pending')),
    rows<any>(sb.from('uploaded_documents').select('id, case_id, doc_type, created_at, extraction_status, confirmed_at, raw_upload_expires_at, extracted_data').in('case_id', ids)),
    rows<any>(sb.from('letters').select('id, case_id, letter_type, subject, version, status, created_at, frozen_at, content_sha256').in('case_id', ids)),
    rows<any>(sb.from('letter_signatures').select('letter_id, signed_pdf_sha256').in('case_id', ids)),
    rows<any>(sb.from('send_jobs').select('id, case_id, letter_id, channel, status, practice, created_at, delivered_at, response_due, confirmation, tracking').in('case_id', ids)),
    rows<any>(sb.from('send_job_events').select('job_id, kind, at, detail').in('case_id', ids)),
    rows<any>(sb.from('replies').select('id, case_id, job_id, classification, status, created_at, proposal').in('case_id', ids)),
    rows<any>(sb.from('deadlines').select('id, case_id, filing_deadline, step, escalation_path, denial_id').in('case_id', ids)),
    rows<any>(sb.from('case_outcomes').select('case_id, patient_confirmed, original_amount_owed_usd, revised_amount_owed_usd, refund_received_usd, future_monthly_savings_usd, created_at').in('case_id', ids)),
    rows<any>(sb.from('bill_audit_findings').select('case_id, bill_document_id, disputed_amount_usd, created_at, status').in('case_id', ids)),
    rows<any>(sb.from('denials').select('id, case_id, document_id, confirmed_at, denial_category, notice_date').in('case_id', ids)),
  ]);
  const signed = new Map(signatures.map((s) => [s.letter_id, s.signed_pdf_sha256]));
  const deniedDocs = new Set(denials.map((d) => d.document_id));
  const t = today();
  return {
    cases: cases.map((c) => ({ id: c.id, case_type: c.case_type, status: c.status, created_at: c.created_at, updated_at: c.updated_at, estimated_recoverable_usd: c.estimated_recoverable_usd, next_action: c.next_action, managed_patient_id: c.managed_patient_id })),
    corrections,
    documents: docs.map((d) => ({ id: d.id, case_id: d.case_id, doc_type: d.doc_type, created_at: d.created_at, extraction_status: d.extraction_status, confirmed_at: d.confirmed_at, raw_upload_expires_at: d.raw_upload_expires_at, layout_doc_type: d.extracted_data?.layout?.docType ?? null, layout_lines: d.extracted_data?.layout?.lines?.length ?? 0, has_denial: deniedDocs.has(d.id) })),
    letters: letters.map((l) => ({ ...l, signed: signed.has(l.id), signed_pdf_sha256: signed.get(l.id) ?? null })),
    jobs: jobs.map((j) => ({ ...j, overdue: isOverdue({ status: j.status, responseDue: j.response_due }, t) })),
    events,
    replies,
    deadlines,
    outcomes,
    findings: findings.filter((f) => f.status !== 'dismissed'),
    denials,
  };
}

export async function loadHome(userId: string) {
  const r = await loadRows(userId);
  const t = today();
  const jobs = jobCards(r, t);
  return { needsYou: needsYou(r, t), saved: savedSoFar(r), activeJobs: jobs.filter((j) => j.chip !== 'won' && j.chip !== 'closed').slice(0, 4), comingUp: comingUp(r, t), jobCount: jobs.length };
}

export async function loadJobs(userId: string) {
  return { jobs: jobCards(await loadRows(userId), today()) };
}

// One job, or null when this user may not see it (same 404 as everywhere).
export async function loadJob(userId: string, caseId: string) {
  const r = await loadRows(userId, caseId);
  if (!r.cases.length) return null;
  const t = today();
  const card = jobCards(r, t)[0];
  return { job: card, needsYou: needsYou(r, t), timeline: timeline(r, caseId), money: savedSoFar(r), documents: documentCards(r, new Date()) };
}

export async function loadDocuments(userId: string) {
  return { documents: documentCards(await loadRows(userId), new Date()) };
}
