// Patient home (Phase 7 P1, lib/home/compose.ts): status chips, Needs you
// (every kind, soonest first, closed jobs left out), Saved so far from
// confirmed outcomes only, Coming up, the job timeline (newest first), the
// document list, and frozen letters re-downloading byte-identical.
// Run: npx tsx scripts/test_home.ts

import { chipFor, comingUp, documentCards, jobCards, needsYou, outcomeSaved, savedSoFar, timeline, type HomeRows } from '../lib/home/compose';
import { letterHash, letterPdf } from '../lib/letters/freeze';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const TODAY = '2026-10-17';
const base = (): HomeRows => ({ cases: [], corrections: [], documents: [], letters: [], jobs: [], events: [], replies: [], deadlines: [], outcomes: [], findings: [], denials: [] });
const kase = (id: string, status = 'gathering_evidence', case_type = 'bill_dispute', extra: Partial<HomeRows['cases'][number]> = {}) => ({ id, case_type, status, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-10T10:00:00Z', estimated_recoverable_usd: null, next_action: null, managed_patient_id: null, ...extra });
const outcome = (case_id: string, confirmed: boolean, o: Partial<HomeRows['outcomes'][number]> = {}) => ({ case_id, patient_confirmed: confirmed, original_amount_owed_usd: null, revised_amount_owed_usd: null, refund_received_usd: null, future_monthly_savings_usd: null, created_at: '2026-10-12T10:00:00Z', ...o });

// ---------- Chips ----------
check('chip: anything waiting on the patient -> Needs you', chipFor('submitted', 1) === 'needs_you');
check('chip: gathering evidence / action ready -> Arik is working', chipFor('gathering_evidence', 0) === 'arik_working' && chipFor('action_ready', 0) === 'arik_working');
check('chip: submitted / awaiting / escalated -> Waiting on them', ['submitted', 'awaiting_response', 'escalated'].every((s) => chipFor(s, 0) === 'waiting_on_them'));
check('chip: won -> Won; lost or closed -> Closed', chipFor('resolved_won', 0) === 'won' && chipFor('resolved_lost', 0) === 'closed' && chipFor('closed_by_patient', 0) === 'closed');
check('chip: a finished job never shows Needs you', chipFor('resolved_won', 3) === 'won');

// ---------- Needs you ----------
const r = base();
r.cases = [kase('c1'), kase('c2', 'awaiting_response', 'denial_appeal'), kase('done', 'resolved_won')];
r.corrections = [{ id: 'p1', case_id: 'c1', field: 'insurance_plan_name', created_at: '2026-10-02T10:00:00Z' }, { id: 'p2', case_id: 'done', field: 'dose', created_at: '2026-10-02T10:00:00Z' }];
r.documents = [
  { id: 'd1', case_id: 'c1', doc_type: 'itemized_bill', created_at: '2026-10-03T10:00:00Z', extraction_status: 'extracted', confirmed_at: null, raw_upload_expires_at: '2026-10-05T10:00:00Z', layout_doc_type: 'itemized_bill', layout_lines: 6, has_denial: false },
  { id: 'd2', case_id: 'c2', doc_type: 'denial_letter', created_at: '2026-10-04T10:00:00Z', extraction_status: 'extracted', confirmed_at: null, raw_upload_expires_at: '2026-10-20T10:00:00Z', layout_doc_type: 'denial_letter', layout_lines: 0, has_denial: true },
];
r.letters = [{ id: 'l1', case_id: 'c1', letter_type: 'billing_dispute', subject: 'Dispute of charges on account A-1', version: 1, status: 'draft', created_at: '2026-10-05T10:00:00Z', frozen_at: null, content_sha256: null, signed: false, signed_pdf_sha256: null },
  { id: 'l2', case_id: 'c2', letter_type: 'insurer_appeal', subject: 'Request for internal appeal, claim CL-1', version: 1, status: 'frozen', created_at: '2026-10-06T10:00:00Z', frozen_at: '2026-10-06T11:00:00Z', content_sha256: 'a'.repeat(64), signed: true, signed_pdf_sha256: 'b'.repeat(64) }];
r.jobs = [{ id: 'j1', case_id: 'c2', letter_id: 'l2', channel: 'fax', status: 'delivered', practice: true, created_at: '2026-10-06T12:00:00Z', delivered_at: '2026-10-06T12:02:00Z', response_due: '2026-10-16', confirmation: 'PRACTICE-FAX-1', tracking: null, overdue: true },
  { id: 'j2', case_id: 'c1', letter_id: 'l1', channel: 'mail', status: 'awaiting_approval', practice: true, created_at: '2026-10-07T10:00:00Z', delivered_at: null, response_due: null, confirmation: null, tracking: null, overdue: false }];
r.events = [{ job_id: 'j1', kind: 'approved', at: '2026-10-06T12:00:00Z', detail: null }, { job_id: 'j1', kind: 'delivered', at: '2026-10-06T12:02:00Z', detail: 'Practice send' }];
r.replies = [{ id: 'r1', case_id: 'c2', job_id: 'j1', classification: 'denied_again', status: 'proposed', created_at: '2026-10-08T10:00:00Z', proposal: { title: 'Ask for an external review' } }];
r.deadlines = [{ id: 'k1', case_id: 'c2', filing_deadline: '2026-10-25', step: 'external_review', escalation_path: 'four months from the date on the notice', denial_id: 'x' }, { id: 'k2', case_id: 'c1', filing_deadline: '2027-01-30', step: 'internal_appeal', escalation_path: null, denial_id: null }];
const ny = needsYou(r, TODAY);
const kinds = ny.map((i) => i.kind);
check('needs you: every kind appears (fact, looks right, letter, approve, next step, no reply, deadline soon)', ['confirm_fact', 'looks_right', 'finish_letter', 'approve_send', 'decide_step', 'no_reply', 'deadline_soon'].every((k) => kinds.includes(k as any)), kinds.join());
check('needs you: soonest first (dated items before undated)', ny[0].due === '2026-10-16' && ny[1].due === '2026-10-25' && ny.slice(2).every((i) => i.due === null));
check('needs you: a finished job contributes nothing', !ny.some((i) => i.caseId === 'done'));
check('needs you: a denial letter already confirmed is not asked again', ny.filter((i) => i.kind === 'looks_right').length === 1);
check('needs you: a deadline months away is not "needs you"', !ny.some((i) => i.kind === 'deadline_soon' && i.due === '2027-01-30'));
check('needs you: plain words, no internal names', ny.every((i) => !/_/.test(i.title)) && ny.some((i) => i.title === 'Confirm your insurance plan'));

// ---------- Saved so far ----------
const m = base();
m.cases = [kase('a', 'resolved_won'), kase('b', 'resolved_won'), kase('c', 'gathering_evidence', 'bill_dispute', { estimated_recoverable_usd: 900 }), kase('d', 'gathering_evidence'), kase('e', 'resolved_lost', 'bill_dispute', { estimated_recoverable_usd: 5000 })];
m.outcomes = [
  outcome('a', true, { original_amount_owed_usd: 2000, revised_amount_owed_usd: 1588 }),
  outcome('b', false, { refund_received_usd: 300 }),
  outcome('b', true, { refund_received_usd: 100, created_at: '2026-10-01T00:00:00Z' }),   // older and confirmed, but superseded by the newer unconfirmed one
  outcome('c', true, { future_monthly_savings_usd: 45.5 }),
];
m.findings = [{ case_id: 'd', bill_document_id: 'x', disputed_amount_usd: 280, created_at: '2026-10-05T00:00:00Z' }];
const saved = savedSoFar(m);
check('saved: only patient-confirmed money counts (412 lowered bill)', saved.confirmedUsd === 412, String(saved.confirmedUsd));
check('saved: the latest outcome per case decides; an unconfirmed latest outcome counts nothing', saved.confirmedUsd === 412);
check('saved: monthly savings shown separately, never multiplied by a guessed duration', saved.monthlyUsd === 45.5);
check('saved: possible = open jobs not yet confirmed (finding totals when no estimate); closed and confirmed jobs excluded', saved.possibleUsd === 280, String(saved.possibleUsd));
check('saved: an outcome with no amounts is zero, never negative', outcomeSaved(outcome('z', true, { original_amount_owed_usd: 100, revised_amount_owed_usd: 150 })).now === 0);
check('saved: an empty account saves nothing', JSON.stringify(savedSoFar(base())) === JSON.stringify({ confirmedUsd: 0, monthlyUsd: 0, possibleUsd: 0 }));

// ---------- Coming up, jobs ----------
const cu = comingUp(r, TODAY);
check('coming up: deadlines and answers due, soonest first, nothing past', cu.map((c) => c.date).join() === '2026-10-25,2027-01-30', cu.map((c) => c.date).join());
const cards = jobCards(r, TODAY);
check('jobs: needs-you jobs first, each with a plain topic and next step', cards[0].chip === 'needs_you' && cards.every((c) => !/_/.test(c.topic)) && !!cards[0].next);
check('jobs: a won job shows Won', cards.find((c) => c.caseId === 'done')?.chipWords === 'Won');
check('jobs: a managed patient\'s job is marked as someone you help', jobCards({ ...base(), cases: [kase('mp', 'gathering_evidence', 'bill_dispute', { managed_patient_id: 'm1' })] }, TODAY)[0].forSomeoneElse);

// ---------- Timeline ----------
const tl = timeline(r, 'c2');
check('timeline: newest first', tl.every((e, i) => i === 0 || tl[i - 1].at >= e.at));
check('timeline: sends say practice send and carry the confirmation', tl.some((e) => e.kind === 'send' && /practice send/.test(e.title) && /PRACTICE-FAX-1/.test(e.detail ?? '')));
check('timeline: the upload, the final signed copy, the reply and the deadline are all there', ['upload', 'letter', 'reply', 'deadline'].every((k) => tl.some((e) => e.kind === k)) && tl.some((e) => e.detail === 'Signed by you'));
check('timeline: only this job\'s rows', !tl.some((e) => /Dispute of charges/.test(e.title)));
const money = base();
money.cases = [kase('a', 'resolved_won')];
money.outcomes = [outcome('a', false, { refund_received_usd: 50 })];
check('timeline: an unconfirmed outcome says so', timeline(money, 'a').some((e) => e.title === 'Outcome recorded, not confirmed yet'));

// ---------- Documents ----------
const docs = documentCards(r, new Date('2026-10-17T12:00:00Z'));
check('documents: a draft has no PDF; a signed final copy downloads the signed PDF with its fingerprint', docs.find((d) => d.id === 'l1')!.pdf === null && docs.find((d) => d.id === 'l2')!.pdf === 'signed' && docs.find((d) => d.id === 'l2')!.sha256 === 'b'.repeat(64));
check('documents: a practice send says it was not really sent', docs.find((d) => d.id === 'l2')!.status === 'Practice send, not really sent');
check('documents: an upload past 48 hours says the original was removed', /removed after 48 hours/.test(docs.find((d) => d.id === 'd1')!.note ?? ''));
check('documents: newest first, both sources', docs.some((d) => d.from === 'you') && docs.some((d) => d.from === 'arik') && docs.every((d, i) => i === 0 || docs[i - 1].at >= d.at));

// ---------- Frozen copies ----------
async function frozen() {
  const l = { subject: 'Dispute of charges on account A-1', body: 'To the billing office,\n\nPlease remove the duplicate.\n\nSincerely,\nRosa Fairbairn', footer: 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.' };
  const at = new Date('2026-10-06T11:00:00Z');
  const a = await letterPdf(l, 'October 6, 2026', undefined, at);
  await new Promise((res) => setTimeout(res, 1100));
  const b = await letterPdf(l, 'October 6, 2026', undefined, at);
  check('frozen letter: re-download is byte-identical (dates pinned to the freeze time)', Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
  check('frozen letter: its text hash never changes', letterHash(l) === letterHash({ ...l }));
}

frozen().then(() => {
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
});
