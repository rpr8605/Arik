// The real denial path's data layer (Phase 5). Called by the case-scoped
// routes through apiDeps (lib/apiAuth.ts) after the session and case-access
// checks; every query is also scoped to the case. The rules engine decides
// (lib/rules/denials/*); nothing here asks a model anything.

import { supabaseAdmin } from '../supabaseAdmin';
import { getCaseManagedPatient, getChatProfile } from '../chatSession';
import { resolveChatSubject } from '../chatSubject';
import { getCoverageRule } from '../data/coverageData';
import { buildArguments, type AppealArgument, type ArgumentContext } from '../rules/denials/arguments';
import { runDenialChecks } from '../rules/denials/checks';
import { CATEGORY_TEXT, X12_CODES_URL } from '../rules/denials/codes';
import { parseDenialText, type DenialDraft } from '../rules/denials/parse';
import type { ConfirmedDenial, DenialFlag, DenialLetterType } from '../rules/denials/types';
import { buildDenialLetter, denialLetterOptions, denialLetterProblems } from '../letters/denialTemplates';
import { joinBody } from '../letters/templates';
import { LETTER_FOOTER } from './types';
import type { StoredLetter } from './billReview';

const today = () => new Date().toISOString().slice(0, 10);

export function denialDraftFromDocument(doc: { extracted_data?: any } | null): DenialDraft | null {
  const text: string | undefined = doc?.extracted_data?.layout?.text;
  return text ? parseDenialText(text) : null;
}

const toRow = (d: ConfirmedDenial) => ({
  payer_name: d.payerName, provider_name: d.providerName, plan_funding: d.planFunding, medicaid_delivery: d.medicaidDelivery,
  denial_category: d.category, carc_codes: d.carcCodes, rarc_codes: d.rarcCodes, service_or_drug: d.serviceOrDrug, service_code: d.serviceCode,
  is_drug: d.isDrug, notice_date: d.noticeDate, date_of_service: d.dateOfService, request_date: d.requestDate, appeal_level: d.appealLevel,
  timing: d.timing, is_prior_auth_decision: d.isPriorAuthDecision, is_urgent: d.isUrgent, stated_reason: d.statedReason, claim_number: d.claimNumber,
  letter_deadline_days: d.letterDeadlineDays, prior_auth: d.priorAuth, confirmed_at: d.confirmedAt,
});

const fromRow = (r: any): ConfirmedDenial => ({
  confirmedAt: r.confirmed_at, payerName: r.payer_name, providerName: r.provider_name, planFunding: r.plan_funding, medicaidDelivery: r.medicaid_delivery,
  category: r.denial_category, carcCodes: r.carc_codes ?? [], rarcCodes: r.rarc_codes ?? [], serviceOrDrug: r.service_or_drug, serviceCode: r.service_code,
  isDrug: r.is_drug, noticeDate: r.notice_date, dateOfService: r.date_of_service, requestDate: r.request_date, appealLevel: r.appeal_level,
  timing: r.timing, isPriorAuthDecision: r.is_prior_auth_decision, isUrgent: r.is_urgent, statedReason: r.stated_reason, claimNumber: r.claim_number,
  letterDeadlineDays: r.letter_deadline_days, priorAuth: r.prior_auth,
});

// What the argument builder may use: Medicare coverage rules for the
// service code (Medicare Advantage only, in the patient's state), and
// whether the patient uploaded the plan's own document.
async function argumentContext(userId: string, caseId: string, d: ConfirmedDenial): Promise<ArgumentContext> {
  let coverageRules: ArgumentContext['coverageRules'] = null;
  if (d.planFunding === 'medicare_advantage' && d.serviceCode) {
    const [profile, managedPatient] = await Promise.all([getChatProfile(userId), getCaseManagedPatient(caseId)]);
    const subject = resolveChatSubject({ userProfile: profile, managedPatient });
    const hit = await getCoverageRule(d.serviceCode, subject.state ?? null);
    coverageRules = hit.found ? hit.rules : null;
  }
  const { data } = await supabaseAdmin().from('uploaded_documents').select('id').eq('case_id', caseId).eq('doc_type', 'spd').limit(1);
  return { coverageRules, planDocumentOnFile: (data ?? []).length > 0 };
}

export interface DenialView {
  denialId: string;
  denial: ConfirmedDenial;
  flags: DenialFlag[];
  arguments: AppealArgument[];
  letterOptions: DenialLetterType[];
  category: { title: string; plain: string };
  codes: { code: string; explanation: string | null; url: string }[];   // explanation only once the owner approved it
}

async function codeWords(carc: string[]) {
  if (!carc.length) return [];
  const { data } = await supabaseAdmin().from('denial_codes').select('code, arik_explanation, explanation_status').eq('code_set', 'CARC').in('code', carc);
  return carc.map((code) => {
    const row = (data ?? []).find((r) => r.code === code);
    return { code, explanation: row?.explanation_status === 'approved' ? row.arik_explanation : null, url: X12_CODES_URL };
  });
}

async function view(userId: string, caseId: string, denialId: string, d: ConfirmedDenial, flags: DenialFlag[]): Promise<DenialView> {
  const ctx = await argumentContext(userId, caseId, d);
  return { denialId, denial: d, flags, arguments: buildArguments(d, flags, ctx), letterOptions: denialLetterOptions(d, flags), category: CATEGORY_TEXT[d.category], codes: await codeWords(d.carcCodes) };
}

// Store the confirmed copy, run the checks, and replace this denial's
// computed deadlines (re-confirming re-runs).
export async function confirmDenial(userId: string, caseId: string, documentId: string, d: ConfirmedDenial): Promise<DenialView> {
  const sb = supabaseAdmin();
  const { flags, rulesVersion } = runDenialChecks(d, today());
  const { data: row, error } = await sb
    .from('denials')
    .upsert({ user_id: userId, case_id: caseId, document_id: documentId, ...toRow(d), check_results: flags, rules_version: rulesVersion, updated_at: new Date().toISOString() }, { onConflict: 'document_id' })
    .select('id')
    .single();
  if (error) throw error;
  const { error: delErr } = await sb.from('deadlines').delete().eq('denial_id', row.id).eq('case_id', caseId);
  if (delErr) throw delErr;
  const dl = flags.find((f) => f.id === 'patient_deadline')?.deadline;
  if (dl?.due) {
    const { error: dErr } = await sb.from('deadlines').insert({
      case_id: caseId, denial_id: row.id, rule_id: dl.ruleId, step: dl.step, rule_jurisdiction: 'federal', plan_type: d.planFunding,
      notice_date: d.noticeDate, filing_deadline: dl.due, escalation_path: dl.windowText,
      // A cited federal rule, verified against eCFR (docs/research/denial_rules_verification.md);
      // no sources row exists for eCFR yet, so source_id stays null.
      last_verified_at: '2026-10-17T00:00:00Z',
    });
    if (dErr) throw dErr;
  }
  return view(userId, caseId, row.id, d, flags);
}

export async function getDenialView(userId: string, caseId: string, documentId: string): Promise<DenialView | null> {
  const { data, error } = await supabaseAdmin().from('denials').select('*').eq('case_id', caseId).eq('document_id', documentId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = fromRow(data);
  // Deadlines move with today: re-run the checks for the view.
  return view(userId, caseId, data.id, d, runDenialChecks(d, today()).flags);
}

// Draft a denial letter. Code writes every word; the contract is checked
// before it is stored, and a letter that fails is refused, never saved.
export async function createDenialLetter(userId: string, caseId: string, documentId: string, type: DenialLetterType, patient: { name: string; phone: string | null }): Promise<StoredLetter | { error: string }> {
  const v = await getDenialView(userId, caseId, documentId);
  if (!v) return { error: 'confirm what Arik read before writing a letter' };
  if (!v.letterOptions.includes(type)) return { error: `a ${type.replace(/_/g, ' ')} letter does not fit this denial` };
  const ctx = await argumentContext(userId, caseId, v.denial);
  const input = { type, patient, denial: v.denial, flags: v.flags, context: ctx, date: today() };
  const parts = buildDenialLetter(input);
  const letter = { subject: parts.subject, body: joinBody(parts), footer: LETTER_FOOTER };
  const problems = denialLetterProblems(letter, input);
  if (problems.length) return { error: `letter failed its checks: ${problems.join('; ')}` };
  const sb = supabaseAdmin();
  const { data: prev } = await sb.from('letters').select('version').eq('case_id', caseId).eq('letter_type', type).order('version', { ascending: false }).limit(1);
  const { data, error } = await sb
    .from('letters')
    .insert({ user_id: userId, case_id: caseId, bill_document_id: documentId, denial_id: v.denialId, letter_type: type, version: (prev?.[0]?.version ?? 0) + 1, subject: letter.subject, body: letter.body, footer: letter.footer, drafter: 'code-templates', used_fallback: false })
    .select()
    .single();
  if (error) throw error;
  return data as StoredLetter;
}
