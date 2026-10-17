// Agent actions data layer (Phase 6): the authorization, letter
// signatures, sends, delivery events, replies and next-step decisions.
// Called by the routes through apiDeps after the session and case-access
// checks; every query is also scoped to the case. The registry gate
// (lib/actions/registry.ts canRun) runs before anything happens, and every
// approval is written to the consent ledger. No IP address or device data
// is stored.

import { supabaseAdmin } from '../supabaseAdmin';
import { recordConsent } from '../consent';
import { canRun } from '../actions/registry';
import { AUTHORIZATION_TEXT, AUTHORIZATION_VERSION, authorizationPdf, authorizationTextHash, parseSignature, sha256, signatureHasInk, signedLetterPdf } from '../actions/authorization';
import { FAX_RE, ZIP_RE, senders, type Address, type SendEvent } from '../actions/senders';
import { isOverdue, overdueText, responseDeadline, type JobStatus } from '../actions/tracker';
import { classifyReply, proposeNextStep, REPLY_KINDS, type Proposal, type ReplyKind } from '../actions/replies';
import { SYNTHETIC_REPLIES } from '../actions/syntheticReplies';
import { letterDateLine } from '../letters/templates';
import { getLetter, createLetter, type StoredLetter } from './billReview';
import { createDenialLetter } from './denialReview';
import { BILL_LETTER_TYPES } from '../letters/templates';
import { DENIAL_LETTER_TYPES, type ConfirmedDenial, type DenialLetterType } from '../rules/denials/types';
import type { LetterType } from './types';

const sb = () => supabaseAdmin();
const today = () => new Date().toISOString().slice(0, 10);
type Err = { error: string; status: number };

// ---------- The one-time authorization ----------

export async function getAuthorization(userId: string) {
  const { data, error } = await sb().from('agent_authorizations').select('id, text_version, signer_name, signed_at, signed_copy_sha256').eq('user_id', userId).is('revoked_at', null).maybeSingle();
  if (error) throw error;
  return { current: data, text: AUTHORIZATION_TEXT, version: AUTHORIZATION_VERSION, needsCounsel: true };
}

export async function signAuthorization(userId: string, name: string, signature: unknown): Promise<{ signedAt: string } | Err> {
  const gate = canRun('authorize_arik', { actor: 'patient', authorizationOnFile: false, letterFrozen: false, letterSigned: false, patientApproved: true });
  if (!gate.ok) return { error: gate.reason, status: 409 };
  const sig = parseSignature(signature);
  if ('error' in sig) return { error: sig.error, status: 400 };
  if (!(await signatureHasInk(sig.png))) return { error: 'the signature looks empty; sign with your finger', status: 400 };
  const existing = await getAuthorization(userId);
  if (existing.current) return { error: 'you already signed the authorization', status: 409 };
  const signedAt = new Date().toISOString();
  const pdf = await authorizationPdf(name, signedAt, sig.png);
  const { error } = await sb().from('agent_authorizations').insert({ user_id: userId, text_version: AUTHORIZATION_VERSION, text_sha256: authorizationTextHash(), signer_name: name, signature_png: sig.dataUrl, signed_at: signedAt, signed_copy_sha256: sha256(pdf) });
  if (error) throw error;
  await recordConsent(sb(), userId, 'agent_authorization', 'opt_in', { version: AUTHORIZATION_VERSION, text_sha256: authorizationTextHash() });
  return { signedAt };
}

export async function revokeAuthorization(userId: string): Promise<boolean> {
  const { data, error } = await sb().from('agent_authorizations').update({ revoked_at: new Date().toISOString() }).eq('user_id', userId).is('revoked_at', null).select('id');
  if (error) throw error;
  if (data?.length) await recordConsent(sb(), userId, 'agent_authorization', 'opt_out', { version: AUTHORIZATION_VERSION });
  return !!data?.length;
}

export async function authorizationPdfFor(userId: string): Promise<Uint8Array | null> {
  const { data } = await sb().from('agent_authorizations').select('signer_name, signed_at, signature_png').eq('user_id', userId).is('revoked_at', null).maybeSingle();
  if (!data) return null;
  const sig = parseSignature(data.signature_png);
  return 'png' in sig ? authorizationPdf(data.signer_name, data.signed_at, sig.png) : null;
}

// ---------- Signing a letter ----------

async function letterSignature(letterId: string) {
  const { data, error } = await sb().from('letter_signatures').select('signer_name, signed_at, signature_png, signed_pdf_sha256').eq('letter_id', letterId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function signLetter(userId: string, caseId: string, letterId: string, name: string, signature: unknown): Promise<{ signedAt: string; sha256: string } | Err> {
  const letter = await getLetter(caseId, letterId);
  if (!letter) return { error: 'not found', status: 404 };
  const gate = canRun('sign_letter', { actor: 'patient', authorizationOnFile: false, letterFrozen: letter.status === 'frozen', letterSigned: false, patientApproved: true });
  if (!gate.ok) return { error: gate.reason, status: 409 };
  if (await letterSignature(letterId)) return { error: 'this letter is already signed', status: 409 };
  const sig = parseSignature(signature);
  if ('error' in sig) return { error: sig.error, status: 400 };
  if (!(await signatureHasInk(sig.png))) return { error: 'the signature looks empty; sign with your finger', status: 400 };
  const signedAt = new Date().toISOString();
  const pdf = await signedLetterPdf(letter, letterDateLine(letter.frozen_at!.slice(0, 10)), name, signedAt, sig.png);
  const hash = sha256(pdf);
  const { error } = await sb().from('letter_signatures').insert({ letter_id: letterId, user_id: userId, case_id: caseId, signer_name: name, signature_png: sig.dataUrl, signed_at: signedAt, signed_pdf_sha256: hash });
  if (error) throw error;
  return { signedAt, sha256: hash };
}

// The signed letter, rebuilt from the frozen text and the stored signature;
// it must hash to what was stored when it was signed.
export async function signedLetterFile(caseId: string, letterId: string): Promise<Uint8Array | null> {
  const letter = await getLetter(caseId, letterId);
  const s = letter && (await letterSignature(letterId));
  if (!letter || !s) return null;
  const sig = parseSignature(s.signature_png);
  if (!('png' in sig)) return null;
  const pdf = await signedLetterPdf(letter, letterDateLine(letter.frozen_at!.slice(0, 10)), s.signer_name, s.signed_at, sig.png);
  if (sha256(pdf) !== s.signed_pdf_sha256) throw new Error('the signed letter no longer matches its stored copy');
  return pdf;
}

// ---------- Sending ----------

export interface SendRequest {
  letterId: string;
  channel: 'fax' | 'mail';
  recipientName: string;
  fax?: string;
  address?: Address;
  returnAddress?: Address;
  certified?: boolean;
}

const addrOk = (a: Address | undefined): a is Address => !!a && !!a.name?.trim() && !!a.line1?.trim() && !!a.city?.trim() && /^[A-Z]{2}$/.test(a.state ?? '') && ZIP_RE.test(a.zip ?? '');

export function parseSendRequest(body: unknown): SendRequest | { error: string } {
  const b = body as Record<string, any> | null;
  if (!b || typeof b.letterId !== 'string') return { error: 'letterId is required' };
  if (b.channel !== 'fax' && b.channel !== 'mail') return { error: "channel must be 'fax' or 'mail'" };
  const name = typeof b.recipientName === 'string' ? b.recipientName.trim() : '';
  if (name.length < 2 || name.length > 120) return { error: 'who the letter goes to is required' };
  const clean = (a: any): Address | undefined => (a && typeof a === 'object' ? { name: String(a.name ?? '').trim().slice(0, 120), line1: String(a.line1 ?? '').trim().slice(0, 120), line2: a.line2 ? String(a.line2).trim().slice(0, 120) : null, city: String(a.city ?? '').trim().slice(0, 60), state: String(a.state ?? '').trim().toUpperCase(), zip: String(a.zip ?? '').trim() } : undefined);
  if (b.channel === 'fax') {
    if (typeof b.fax !== 'string' || !FAX_RE.test(b.fax.trim())) return { error: 'a fax number like (555) 555-0142 is required' };
    return { letterId: b.letterId, channel: 'fax', recipientName: name, fax: b.fax.trim() };
  }
  const address = clean(b.address);
  const returnAddress = clean(b.returnAddress);
  if (!addrOk(address)) return { error: 'the full mailing address is required' };
  if (!addrOk(returnAddress)) return { error: 'your return address is required' };
  return { letterId: b.letterId, channel: 'mail', recipientName: name, address, returnAddress, certified: b.certified !== false };
}

export async function prepareSend(userId: string, caseId: string, req: SendRequest): Promise<{ job: any; summary: Record<string, unknown> } | Err> {
  const letter = await getLetter(caseId, req.letterId);
  if (!letter) return { error: 'not found', status: 404 };
  if (letter.status !== 'frozen') return { error: 'save the final copy of the letter first', status: 409 };
  const ex = senders();
  const executor = req.channel === 'fax' ? ex.fax : ex.mail;
  const recipient = req.channel === 'fax' ? { name: req.recipientName, fax: req.fax } : { name: req.recipientName, address: req.address };
  const { data, error } = await sb()
    .from('send_jobs')
    .insert({ user_id: userId, case_id: caseId, letter_id: letter.id, channel: req.channel, executor: executor.name, practice: !executor.allowsRealPatientData, recipient, return_address: req.returnAddress ?? null, certified: req.channel === 'mail' ? !!req.certified : false })
    .select()
    .single();
  if (error) throw error;
  return { job: data, summary: { letter: letter.subject, channel: req.channel, to: recipient, certified: data.certified, practice: data.practice, shares: req.channel === 'fax' ? ['the signed letter', 'the recipient fax number', 'a return fax number for this case'] : ['the signed letter', 'the recipient address', 'your return address'] } };
}

async function job(caseId: string, jobId: string) {
  const { data, error } = await sb().from('send_jobs').select('*').eq('id', jobId).eq('case_id', caseId).maybeSingle();
  if (error) throw error;
  return data;
}

async function addEvents(jobId: string, caseId: string, events: { kind: string; at: string; detail: string }[]) {
  if (!events.length) return;
  const { error } = await sb().from('send_job_events').insert(events.map((e) => ({ job_id: jobId, case_id: caseId, kind: e.kind, at: e.at, detail: e.detail })));
  if (error) throw error;
}

async function denialFor(letter: StoredLetter): Promise<ConfirmedDenial | null> {
  const id = (letter as any).denial_id as string | null;
  if (!id) return null;
  const { data } = await sb().from('denials').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  return {
    confirmedAt: data.confirmed_at, payerName: data.payer_name, providerName: data.provider_name, planFunding: data.plan_funding, medicaidDelivery: data.medicaid_delivery,
    category: data.denial_category, carcCodes: data.carc_codes ?? [], rarcCodes: data.rarc_codes ?? [], serviceOrDrug: data.service_or_drug, serviceCode: data.service_code,
    isDrug: data.is_drug, noticeDate: data.notice_date, dateOfService: data.date_of_service, requestDate: data.request_date, appealLevel: data.appeal_level,
    timing: data.timing, isPriorAuthDecision: data.is_prior_auth_decision, isUrgent: data.is_urgent, statedReason: data.stated_reason, claimNumber: data.claim_number,
    letterDeadlineDays: data.letter_deadline_days, priorAuth: data.prior_auth,
  };
}

export async function ensureInboundNumber(userId: string, caseId: string): Promise<string> {
  const { data } = await sb().from('case_inbound_numbers').select('number').eq('case_id', caseId).maybeSingle();
  if (data) return data.number;
  const fax = senders().fax;
  const number = await fax.inboundNumber(caseId);
  const { error } = await sb().from('case_inbound_numbers').insert({ case_id: caseId, user_id: userId, number, executor: fax.name });
  if (error && !/duplicate/.test(error.message)) throw error;
  return number;
}

// The one tap. Runs the registry gate with this approval, records it in
// the consent ledger, runs the executor, stores every event, and sets the
// response deadline from the delivery date.
export async function approveSend(userId: string, caseId: string, jobId: string): Promise<{ job: any } | Err> {
  const j = await job(caseId, jobId);
  if (!j) return { error: 'not found', status: 404 };
  if (j.status !== 'awaiting_approval') return { error: 'this send was already approved or cancelled', status: 409 };
  const letter = await getLetter(caseId, j.letter_id);
  if (!letter) return { error: 'not found', status: 404 };
  const [auth, signature] = await Promise.all([getAuthorization(userId), letterSignature(letter.id)]);
  const action = j.channel === 'fax' ? 'send_fax' : 'send_mail';
  const gate = canRun(action, { actor: 'patient', authorizationOnFile: !!auth.current, letterFrozen: letter.status === 'frozen', letterSigned: !!signature, patientApproved: true });
  if (!gate.ok) return { error: gate.reason, status: 409 };
  const approvedAt = new Date();
  await recordConsent(sb(), userId, 'agent_action', 'opt_in', { action, job_id: jobId, letter_id: letter.id, letter_sha256: letter.content_sha256, executor: j.executor });
  await addEvents(jobId, caseId, [{ kind: 'approved', at: approvedAt.toISOString(), detail: 'You approved this send.' }]);
  const pdf = await signedLetterFile(caseId, letter.id);
  const ex = senders();
  let result;
  try {
    if (j.channel === 'fax') {
      await ensureInboundNumber(userId, caseId);
      result = await ex.fax.send({ jobId, to: j.recipient.fax, pdf: pdf!, now: approvedAt });
    } else {
      result = await ex.mail.send({ jobId, to: { ...j.recipient.address, name: j.recipient.name }, from: j.return_address, pdf: pdf!, certified: j.certified, now: approvedAt });
    }
  } catch (e) {
    const failedAt = new Date().toISOString();
    await addEvents(jobId, caseId, [{ kind: 'failed', at: failedAt, detail: `Not sent: ${(e as Error).message}.` }]);
    const { data } = await sb().from('send_jobs').update({ status: 'failed', approved_at: approvedAt.toISOString(), updated_at: failedAt }).eq('id', jobId).select().single();
    return { job: data };
  }
  await addEvents(jobId, caseId, result.events);
  const delivered = result.events.find((e: SendEvent) => e.kind === 'delivered');
  const dl = delivered ? responseDeadline(letter.letter_type as LetterType | DenialLetterType, delivered.at, await denialFor(letter)) : null;
  const status: JobStatus = delivered ? 'delivered' : 'sent';
  const { data, error } = await sb()
    .from('send_jobs')
    .update({ status, approved_at: approvedAt.toISOString(), confirmation: result.confirmation, tracking: result.tracking, delivered_at: delivered?.at ?? null, response_due: dl?.due ?? null, response_rule_id: dl?.ruleId ?? null, response_certain: dl?.certain ?? null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .select()
    .single();
  if (error) throw error;
  return { job: data };
}

export async function cancelSend(caseId: string, jobId: string): Promise<{ job: any } | Err> {
  const j = await job(caseId, jobId);
  if (!j) return { error: 'not found', status: 404 };
  if (j.status !== 'awaiting_approval') return { error: 'only a send waiting for approval can be cancelled', status: 409 };
  await addEvents(jobId, caseId, [{ kind: 'cancelled', at: new Date().toISOString(), detail: 'You cancelled this send. Nothing was sent.' }]);
  const { data } = await sb().from('send_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', jobId).select().single();
  return { job: data };
}

// ---------- The tracker ----------

export async function listJobs(caseId: string) {
  const [{ data: jobs, error }, { data: events }, { data: replies }, { data: inbound }] = await Promise.all([
    sb().from('send_jobs').select('*, letters(subject, letter_type, version)').eq('case_id', caseId).order('created_at', { ascending: false }),
    sb().from('send_job_events').select('job_id, kind, at, detail').eq('case_id', caseId).order('at', { ascending: true }),
    sb().from('replies').select('id, job_id, source, classification, signals, proposal, status, created_at, decided_at').eq('case_id', caseId).order('created_at', { ascending: true }),
    sb().from('case_inbound_numbers').select('number, executor').eq('case_id', caseId).maybeSingle(),
  ]);
  if (error) throw error;
  const t = today();
  return {
    inboundNumber: inbound?.number ?? null,
    jobs: (jobs ?? []).map((j) => {
      const overdue = isOverdue({ status: j.status, responseDue: j.response_due }, t);
      return {
        ...j,
        events: (events ?? []).filter((e) => e.job_id === j.id),
        replies: (replies ?? []).filter((r) => r.job_id === j.id),
        overdue,
        overdue_text: overdue ? overdueText({ certain: !!j.response_certain }) : null,
      };
    }),
  };
}

// ---------- Replies ----------

async function readReply(caseId: string, src: { documentId?: string; practiceKind?: string }): Promise<{ text: string; documentId: string | null; practice: boolean } | Err> {
  if (src.documentId) {
    const { data } = await sb().from('uploaded_documents').select('id, extracted_data').eq('id', src.documentId).eq('case_id', caseId).maybeSingle();
    if (!data) return { error: 'not found', status: 404 };
    const text = data.extracted_data?.layout?.text;
    if (!text) return { error: 'Arik could not read text in that document', status: 409 };
    return { text, documentId: data.id, practice: false };
  }
  // A practice inbound fax: synthetic text only, and only with the demo fax executor.
  if (senders().fax.allowsRealPatientData) return { error: 'practice replies are only for practice sends', status: 409 };
  const kind = src.practiceKind as Exclude<ReplyKind, 'unknown'>;
  const texts = (SYNTHETIC_REPLIES as Record<string, string[]>)[kind];
  if (!texts) return { error: `practice reply kind must be one of ${Object.keys(SYNTHETIC_REPLIES).join(', ')}`, status: 400 };
  return { text: texts[0], documentId: null, practice: true };
}

export async function addReply(userId: string, caseId: string, jobId: string, src: { documentId?: string; practiceKind?: string }): Promise<{ reply: any } | Err> {
  const j = await job(caseId, jobId);
  if (!j) return { error: 'not found', status: 404 };
  if (!['delivered', 'sent', 'replied'].includes(j.status)) return { error: 'a reply can only follow a sent letter', status: 409 };
  const read = await readReply(caseId, src);
  if ('error' in read) return read;
  const letter = await getLetter(caseId, j.letter_id);
  const reading = classifyReply(read.text);
  const proposal = proposeNextStep(reading.kind, { letterType: letter!.letter_type, denial: await denialFor(letter!) }, read.text);
  const { data, error } = await sb()
    .from('replies')
    .insert({ user_id: userId, case_id: caseId, job_id: jobId, document_id: read.documentId, source: read.practice ? 'inbound_fax' : 'upload', practice_text: read.practice ? read.text : null, classification: reading.kind, signals: reading.signals, proposal })
    .select()
    .single();
  if (error) throw error;
  const at = new Date().toISOString();
  await addEvents(jobId, caseId, [{ kind: 'reply_received', at, detail: read.practice ? 'Practice reply received by fax (synthetic).' : 'You added a reply.' }]);
  await sb().from('send_jobs').update({ status: 'replied', updated_at: at }).eq('id', jobId);
  return { reply: data };
}

// The patient approves or dismisses Arik's suggested next step, or says
// what the reply really is (which re-proposes). Approving drafts a letter
// at most; sending it is its own approval.
export async function decideReply(userId: string, caseId: string, replyId: string, decision: 'approve' | 'dismiss' | 'reclassify', kind?: string): Promise<{ reply: any; letter?: StoredLetter | null; draftError?: string } | Err> {
  const { data: r } = await sb().from('replies').select('*').eq('id', replyId).eq('case_id', caseId).maybeSingle();
  if (!r) return { error: 'not found', status: 404 };
  if (r.status !== 'proposed') return { error: 'this step was already decided', status: 409 };
  const j = r.job_id ? await job(caseId, r.job_id) : null;
  const letter = j ? await getLetter(caseId, j.letter_id) : null;
  if (decision === 'reclassify') {
    if (!REPLY_KINDS.includes(kind as ReplyKind)) return { error: `kind must be one of ${REPLY_KINDS.join(', ')}`, status: 400 };
    const proposal = proposeNextStep(kind as ReplyKind, { letterType: letter?.letter_type ?? 'billing_dispute', denial: letter ? await denialFor(letter) : null }, r.practice_text ?? '');
    const { data } = await sb().from('replies').update({ classification: kind, proposal }).eq('id', replyId).select().single();
    return { reply: data };
  }
  const gate = canRun('decide_proposal', { actor: 'patient', authorizationOnFile: false, letterFrozen: false, letterSigned: false, patientApproved: true });
  if (!gate.ok) return { error: gate.reason, status: 409 };
  await recordConsent(sb(), userId, 'agent_action', decision === 'approve' ? 'opt_in' : 'opt_out', { action: 'decide_proposal', reply_id: replyId, step: (r.proposal as Proposal).step });
  const { data } = await sb().from('replies').update({ status: decision === 'approve' ? 'approved' : 'dismissed', decided_at: new Date().toISOString() }).eq('id', replyId).select().single();
  const p = r.proposal as Proposal;
  if (decision !== 'approve' || !p.letterType || !letter) return { reply: data };
  // Draft the proposed letter from the same document the sent letter came
  // from (Tier 0: a draft, nothing leaves Arik).
  const docId = (letter as any).bill_document_id as string | null;
  if (!docId) return { reply: data, letter: null, draftError: 'Add the document this letter is about, then draft it.' };
  const auth = await getAuthorization(userId);
  const name = auth.current?.signer_name ?? 'The patient';
  const out = (DENIAL_LETTER_TYPES as string[]).includes(p.letterType) && !(BILL_LETTER_TYPES as string[]).includes(p.letterType)
    ? await createDenialLetter(userId, caseId, docId, p.letterType as DenialLetterType, { name, phone: null })
    : await createLetter(userId, caseId, docId, p.letterType as LetterType, { name, phone: null });
  if ('error' in out) {
    // The next level is written from the plan's NEW letter (its own date and
    // deadline), which the patient adds and confirms first.
    const fits = !/does not fit this denial/.test(out.error);
    return { reply: data, letter: null, draftError: fits ? out.error : "Add the plan's new letter to this case and confirm it, so Arik can work out the new deadline. Then Arik will draft this." };
  }
  return { reply: data, letter: out };
}
