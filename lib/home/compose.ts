// Patient home, Phase 7 P1 (docs/design/patient_home_screens.md). Pure:
// rows in, what each screen shows out. The loader (lib/home/load.ts) only
// fetches rows. Rules from the design:
// - Status in plain words, from the case status plus anything waiting on
//   the patient ("Needs you" wins).
// - "Saved so far" counts patient-confirmed outcomes only; anything else is
//   a separate, labeled "possible" line.
// - The timeline is composed from rows that already exist, newest first.
// - A frozen letter downloads exactly as frozen; sends say "Practice send"
//   until real sending exists.

import { caseTopic, fieldLabel } from '../caseCard';

export type Chip = 'needs_you' | 'arik_working' | 'waiting_on_them' | 'won' | 'closed';
export const CHIP_WORDS: Record<Chip, string> = { needs_you: 'Needs you', arik_working: 'Arik is working', waiting_on_them: 'Waiting on them', won: 'Won', closed: 'Closed' };

export function chipFor(status: string, needsYou: number): Chip {
  if (needsYou > 0 && !['resolved_won', 'resolved_lost', 'closed_by_patient'].includes(status)) return 'needs_you';
  if (status === 'resolved_won') return 'won';
  if (status === 'resolved_lost' || status === 'closed_by_patient') return 'closed';
  if (['submitted', 'awaiting_response', 'escalated'].includes(status)) return 'waiting_on_them';
  return 'arik_working';
}

// ---------- Rows the loader passes in ----------

export interface CaseRow { id: string; case_type: string; status: string; created_at: string; updated_at: string | null; estimated_recoverable_usd: number | null; next_action: string | null; managed_patient_id: string | null }
export interface CorrectionRow { id: string; case_id: string; field: string; created_at: string }
export interface DocRow { id: string; case_id: string; doc_type: string; created_at: string; extraction_status: string | null; confirmed_at: string | null; raw_upload_expires_at: string | null; layout_doc_type: string | null; layout_lines: number; has_denial: boolean }
export interface LetterRow { id: string; case_id: string; letter_type: string; subject: string; version: number; status: 'draft' | 'frozen'; created_at: string; frozen_at: string | null; content_sha256: string | null; signed: boolean; signed_pdf_sha256: string | null }
export interface JobRow { id: string; case_id: string; letter_id: string; channel: 'fax' | 'mail'; status: string; practice: boolean; created_at: string; delivered_at: string | null; response_due: string | null; confirmation: string | null; tracking: string | null; overdue: boolean }
export interface EventRow { job_id: string; kind: string; at: string; detail: string | null }
export interface ReplyRow { id: string; case_id: string; job_id: string | null; classification: string; status: string; created_at: string; proposal: { title: string } }
export interface DeadlineRow { id: string; case_id: string; filing_deadline: string; step: string | null; escalation_path: string | null; denial_id: string | null }
export interface OutcomeRow { case_id: string; patient_confirmed: boolean; original_amount_owed_usd: number | null; revised_amount_owed_usd: number | null; refund_received_usd: number | null; future_monthly_savings_usd: number | null; created_at: string }
export interface FindingRow { case_id: string; bill_document_id: string; disputed_amount_usd: number | null; created_at: string }
export interface DenialRow { id: string; case_id: string; document_id: string | null; confirmed_at: string; denial_category: string; notice_date: string }

export interface HomeRows {
  cases: CaseRow[];
  corrections: CorrectionRow[];
  documents: DocRow[];
  letters: LetterRow[];
  jobs: JobRow[];
  events: EventRow[];
  replies: ReplyRow[];
  deadlines: DeadlineRow[];
  outcomes: OutcomeRow[];
  findings: FindingRow[];
  denials: DenialRow[];
}

// ---------- Needs you ----------

export interface NeedsYouItem { caseId: string; kind: 'confirm_fact' | 'looks_right' | 'finish_letter' | 'approve_send' | 'decide_step' | 'no_reply' | 'deadline_soon'; title: string; job: string; due: string | null; at: string }

const STEP_WORDS: Record<string, string> = {
  internal_appeal: 'Appeal deadline', external_review: 'External review deadline', part_d_redetermination: 'Redetermination deadline', part_d_ire: 'Independent review deadline',
  ma_reconsideration: 'Reconsideration deadline', medicaid_plan_appeal: 'Plan appeal deadline', medicaid_fair_hearing: 'Fair hearing deadline',
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const OPEN = (status: string) => !['resolved_won', 'resolved_lost', 'closed_by_patient'].includes(status);

export function needsYou(r: HomeRows, today: string): NeedsYouItem[] {
  const open = new Map(r.cases.filter((c) => OPEN(c.status)).map((c) => [c.id, c]));
  const job = (caseId: string) => caseTopic(open.get(caseId)?.case_type ?? '');
  const items: NeedsYouItem[] = [];
  for (const c of r.corrections) if (open.has(c.case_id)) items.push({ caseId: c.case_id, kind: 'confirm_fact', title: `Confirm your ${fieldLabel(c.field)}`, job: job(c.case_id), due: null, at: c.created_at });
  for (const d of r.documents) {
    if (!open.has(d.case_id) || d.extraction_status !== 'extracted') continue;
    if (d.layout_doc_type === 'itemized_bill' && d.layout_lines > 0 && !d.confirmed_at) items.push({ caseId: d.case_id, kind: 'looks_right', title: 'Looks right? Check what Arik read from your bill', job: job(d.case_id), due: null, at: d.created_at });
    if (d.layout_doc_type === 'denial_letter' && !d.has_denial) items.push({ caseId: d.case_id, kind: 'looks_right', title: 'Looks right? Check what Arik read from your denial letter', job: job(d.case_id), due: null, at: d.created_at });
  }
  for (const l of r.letters) if (open.has(l.case_id) && l.status === 'draft') items.push({ caseId: l.case_id, kind: 'finish_letter', title: `Review your letter: ${l.subject}`, job: job(l.case_id), due: null, at: l.created_at });
  for (const j of r.jobs) {
    if (!open.has(j.case_id)) continue;
    if (j.status === 'awaiting_approval') items.push({ caseId: j.case_id, kind: 'approve_send', title: 'Approve sending your letter', job: job(j.case_id), due: null, at: j.created_at });
    if (j.overdue) items.push({ caseId: j.case_id, kind: 'no_reply', title: 'No reply yet. Check in or follow up', job: job(j.case_id), due: j.response_due, at: j.created_at });
  }
  for (const p of r.replies) if (open.has(p.case_id) && p.status === 'proposed') items.push({ caseId: p.case_id, kind: 'decide_step', title: `Next step: ${p.proposal.title}`, job: job(p.case_id), due: null, at: p.created_at });
  for (const d of r.deadlines) {
    const left = daysBetween(today, d.filing_deadline);
    if (open.has(d.case_id) && left >= 0 && left <= 14) items.push({ caseId: d.case_id, kind: 'deadline_soon', title: `${STEP_WORDS[d.step ?? ''] ?? 'Deadline'} in ${left} day${left === 1 ? '' : 's'}`, job: job(d.case_id), due: d.filing_deadline, at: d.filing_deadline });
  }
  // Soonest first: dated items by date, then undated ones oldest first.
  return items.sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : a.at.localeCompare(b.at)));
}

// ---------- Money ----------

const n = (x: number | string | null | undefined) => (x == null ? 0 : Number(x));
const round2 = (x: number) => Math.round(x * 100) / 100;

// One outcome's money: what the patient no longer owes plus any refund.
// Monthly savings are reported separately (no assumed duration).
export function outcomeSaved(o: OutcomeRow): { now: number; monthly: number } {
  const lowered = o.original_amount_owed_usd != null && o.revised_amount_owed_usd != null ? Math.max(0, n(o.original_amount_owed_usd) - n(o.revised_amount_owed_usd)) : 0;
  return { now: round2(lowered + n(o.refund_received_usd)), monthly: round2(n(o.future_monthly_savings_usd)) };
}

export function savedSoFar(r: Pick<HomeRows, 'outcomes' | 'cases' | 'findings'>): { confirmedUsd: number; monthlyUsd: number; possibleUsd: number } {
  // Latest outcome per case, confirmed by the patient only.
  const latest = new Map<string, OutcomeRow>();
  for (const o of [...r.outcomes].sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(o.case_id, o);
  let confirmed = 0;
  let monthly = 0;
  const confirmedCases = new Set<string>();
  for (const o of latest.values()) {
    if (!o.patient_confirmed) continue;
    const s = outcomeSaved(o);
    confirmed += s.now;
    monthly += s.monthly;
    confirmedCases.add(o.case_id);
  }
  // "Possible": open jobs' estimates, else the bill findings in question; never a confirmed job.
  let possible = 0;
  for (const c of r.cases) {
    if (confirmedCases.has(c.id) || !OPEN(c.status)) continue;
    const est = c.estimated_recoverable_usd != null ? n(c.estimated_recoverable_usd) : r.findings.filter((f) => f.case_id === c.id).reduce((t, f) => t + n(f.disputed_amount_usd), 0);
    possible += est;
  }
  return { confirmedUsd: round2(confirmed), monthlyUsd: round2(monthly), possibleUsd: round2(possible) };
}

// ---------- Coming up ----------

export interface ComingUpItem { date: string; title: string; job: string; caseId: string }

export function comingUp(r: HomeRows, today: string, limit = 6): ComingUpItem[] {
  const open = new Map(r.cases.filter((c) => OPEN(c.status)).map((c) => [c.id, c]));
  const out: ComingUpItem[] = [];
  for (const d of r.deadlines) if (open.has(d.case_id) && d.filing_deadline >= today) out.push({ date: d.filing_deadline, title: STEP_WORDS[d.step ?? ''] ?? 'Deadline', job: caseTopic(open.get(d.case_id)!.case_type), caseId: d.case_id });
  for (const j of r.jobs) if (open.has(j.case_id) && j.response_due && j.response_due >= today && j.status === 'delivered') out.push({ date: j.response_due, title: 'Answer due from them', job: caseTopic(open.get(j.case_id)!.case_type), caseId: j.case_id });
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}

// ---------- Jobs ----------

export interface JobCard { caseId: string; topic: string; chip: Chip; chipWords: string; next: string | null; due: string | null; forSomeoneElse: boolean; updatedAt: string }

export function jobCards(r: HomeRows, today: string): JobCard[] {
  const ny = needsYou(r, today);
  return r.cases
    .map((c) => {
      const mine = ny.filter((i) => i.caseId === c.id);
      const chip = chipFor(c.status, mine.length);
      const due = [...r.deadlines.filter((d) => d.case_id === c.id && d.filing_deadline >= today).map((d) => d.filing_deadline)].sort()[0] ?? null;
      return { caseId: c.id, topic: caseTopic(c.case_type), chip, chipWords: CHIP_WORDS[chip], next: mine[0]?.title ?? null, due, forSomeoneElse: !!c.managed_patient_id, updatedAt: c.updated_at ?? c.created_at };
    })
    .sort((a, b) => (a.chip === 'needs_you') !== (b.chip === 'needs_you') ? (a.chip === 'needs_you' ? -1 : 1) : b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- Job detail timeline ----------

export interface TimelineEntry { at: string; kind: string; title: string; detail: string | null }

const DOC_WORDS: Record<string, string> = { itemized_bill: 'an itemized bill', eob: 'an explanation of benefits', denial_letter: 'a denial letter', insurance_card: 'an insurance card', spd: 'a plan document', other: 'a document', unclassified: 'a document' };
const REPLY_WORDS: Record<string, string> = { approved: 'Approved', denied_again: 'Denied again', info_requested: 'They asked for more information', collections_notice: 'A collection notice', corrected_bill: 'A corrected bill', unknown: 'A reply' };
const EVENT_WORDS: Record<string, string> = { approved: 'You approved sending', queued: 'Queued', sent: 'Sent', printed: 'Printed', mailed: 'Mailed', in_transit: 'In transit', delivered: 'Delivered', failed: 'Not sent', cancelled: 'Send cancelled', reply_received: 'Reply received' };
const money = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function timeline(r: HomeRows, caseId: string): TimelineEntry[] {
  const t: TimelineEntry[] = [];
  const letterById = new Map(r.letters.map((l) => [l.id, l]));
  for (const d of r.documents.filter((x) => x.case_id === caseId)) {
    t.push({ at: d.created_at, kind: 'upload', title: `You added ${DOC_WORDS[d.doc_type] ?? 'a document'}`, detail: d.extraction_status === 'failed' ? 'Arik could not read it.' : null });
    if (d.confirmed_at) t.push({ at: d.confirmed_at, kind: 'confirmed', title: 'You confirmed: "Looks right"', detail: null });
  }
  for (const doc of new Set(r.findings.filter((f) => f.case_id === caseId).map((f) => f.bill_document_id))) {
    const fs = r.findings.filter((f) => f.bill_document_id === doc);
    const total = fs.reduce((s, f) => s + n(f.disputed_amount_usd), 0);
    t.push({ at: fs[0].created_at, kind: 'findings', title: `What Arik found: ${fs.length} item${fs.length === 1 ? '' : 's'} to question`, detail: total > 0 ? `${money(round2(total))} in charges worth questioning` : null });
  }
  for (const d of r.denials.filter((x) => x.case_id === caseId)) t.push({ at: d.confirmed_at, kind: 'confirmed', title: 'You confirmed the denial letter', detail: null });
  for (const d of r.deadlines.filter((x) => x.case_id === caseId)) t.push({ at: `${d.filing_deadline}T23:59:00Z`, kind: 'deadline', title: `${STEP_WORDS[d.step ?? ''] ?? 'Deadline'}`, detail: d.escalation_path });
  for (const l of r.letters.filter((x) => x.case_id === caseId)) {
    t.push({ at: l.created_at, kind: 'letter', title: `Letter drafted: ${l.subject}`, detail: l.version > 1 ? `Version ${l.version}` : null });
    if (l.frozen_at) t.push({ at: l.frozen_at, kind: 'letter', title: `Final copy saved: ${l.subject}`, detail: l.signed ? 'Signed by you' : null });
  }
  for (const j of r.jobs.filter((x) => x.case_id === caseId)) {
    const subject = letterById.get(j.letter_id)?.subject ?? 'your letter';
    for (const e of r.events.filter((x) => x.job_id === j.id)) {
      t.push({ at: e.at, kind: 'send', title: `${EVENT_WORDS[e.kind] ?? e.kind}: ${subject} (${j.channel === 'fax' ? 'fax' : 'mail'}${j.practice ? ', practice send' : ''})`, detail: e.kind === 'delivered' && j.confirmation ? `Confirmation ${j.confirmation}${j.tracking ? `, tracking ${j.tracking}` : ''}` : null });
    }
  }
  for (const p of r.replies.filter((x) => x.case_id === caseId)) t.push({ at: p.created_at, kind: 'reply', title: `${REPLY_WORDS[p.classification] ?? 'A reply'}`, detail: `Suggested next step: ${p.proposal.title}` });
  for (const o of r.outcomes.filter((x) => x.case_id === caseId)) {
    const s = outcomeSaved(o);
    t.push({ at: o.created_at, kind: 'money', title: o.patient_confirmed ? 'You confirmed what you saved' : 'Outcome recorded, not confirmed yet', detail: s.now > 0 || s.monthly > 0 ? `${s.now > 0 ? money(s.now) : ''}${s.now > 0 && s.monthly > 0 ? ' and ' : ''}${s.monthly > 0 ? `${money(s.monthly)} a month` : ''}` : null });
  }
  return t.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- Documents ----------

export interface DocumentCard { id: string; caseId: string; from: 'you' | 'arik'; title: string; job: string; at: string; status: string; pdf: 'letter' | 'signed' | null; sha256: string | null; note: string | null }

const LETTER_STATUS = (l: LetterRow, sends: JobRow[]) => {
  const delivered = sends.find((j) => j.status === 'delivered' || j.status === 'replied');
  if (delivered) return delivered.practice ? 'Practice send, not really sent' : 'Sent';
  if (l.status === 'frozen') return l.signed ? 'Final, signed' : 'Final copy';
  return 'Draft';
};

export function documentCards(r: HomeRows, now: Date): DocumentCard[] {
  const topic = new Map(r.cases.map((c) => [c.id, caseTopic(c.case_type)]));
  const out: DocumentCard[] = [];
  for (const l of r.letters) {
    const sends = r.jobs.filter((j) => j.letter_id === l.id);
    out.push({ id: l.id, caseId: l.case_id, from: 'arik', title: l.subject, job: topic.get(l.case_id) ?? '', at: l.frozen_at ?? l.created_at, status: LETTER_STATUS(l, sends), pdf: l.status === 'frozen' ? (l.signed ? 'signed' : 'letter') : null, sha256: l.signed ? l.signed_pdf_sha256 : l.content_sha256, note: l.status === 'frozen' ? 'Downloads exactly as saved.' : null });
  }
  for (const d of r.documents) {
    const gone = d.raw_upload_expires_at != null && Date.parse(d.raw_upload_expires_at) <= now.getTime();
    out.push({ id: d.id, caseId: d.case_id, from: 'you', title: (DOC_WORDS[d.doc_type] ?? 'a document').replace(/^an? /, '').replace(/^./, (c) => c.toUpperCase()), job: topic.get(d.case_id) ?? '', at: d.created_at, status: d.extraction_status === 'failed' ? 'Could not read' : d.confirmed_at || d.has_denial ? 'Confirmed' : 'Read by Arik', pdf: null, sha256: null, note: gone ? 'Original image removed after 48 hours (privacy). What Arik read from it stays with the job.' : 'The original file is removed within 48 hours (privacy).' });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
