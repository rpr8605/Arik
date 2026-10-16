// The real bill path's data layer (Phases 2 to 4): confirm a reading, run
// the checks, store the findings, write and freeze letters. Called by the
// case-scoped routes through apiDeps (lib/apiAuth.ts) after the session
// and case-access checks; every query here is also scoped to the case.

import { supabaseAdmin } from '../supabaseAdmin';
import { findingsTotal } from './contracts';
import { letterHash } from '../letters/freeze';
import { realBillChecks } from './real/billChecks';
import { codeLetterDrafter, modelLetterDrafter } from './real/letterDrafter';
import type { ConfirmedBill, Finding, LetterType } from './types';

export interface StoredLetter {
  id: string;
  case_id: string;
  letter_type: LetterType;
  version: number;
  subject: string;
  body: string;
  footer: string;
  drafter: string;
  used_fallback: boolean;
  status: 'draft' | 'frozen';
  frozen_at: string | null;
  content_sha256: string | null;
  created_at: string;
}

export async function getCaseDocument(caseId: string, documentId: string) {
  const { data, error } = await supabaseAdmin()
    .from('uploaded_documents')
    .select('id, case_id, doc_type, reader, extracted_data, confirmed_data, confirmed_at, extraction_status')
    .eq('id', documentId)
    .eq('case_id', caseId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Store the confirmed copy, run the checks on it, and replace this
// document's findings with the new set (re-confirming re-runs).
export async function confirmAndReview(userId: string, caseId: string, documentId: string, bill: ConfirmedBill): Promise<{ findings: Finding[]; totalUsd: number }> {
  const sb = supabaseAdmin();
  const { error: upErr } = await sb.from('uploaded_documents').update({ confirmed_data: bill, confirmed_at: bill.confirmedAt }).eq('id', documentId).eq('case_id', caseId);
  if (upErr) throw upErr;
  const findings = await realBillChecks().run(bill);
  const { error: delErr } = await sb.from('bill_audit_findings').delete().eq('bill_document_id', documentId).eq('case_id', caseId);
  if (delErr) throw delErr;
  if (findings.length) {
    const { error } = await sb.from('bill_audit_findings').insert(
      findings.map((f) => ({
        user_id: userId,
        case_id: caseId,
        bill_document_id: documentId,
        finding_type: f.ruleId,
        finding_key: f.id,
        cpt_hcpcs_code: bill.lines[f.lines[0]]?.code ?? null,
        description: f.plainText,
        disputed_amount_usd: f.amountUsd,
        line_indexes: f.lines,
        tone: f.tone,
        data_version: f.dataVersion,
        confidence: f.tone === 'wrong' ? 'high' : 'medium',
      })),
    );
    if (error) throw error;
  }
  return { findings, totalUsd: findingsTotal(findings) };
}

async function storedFindings(caseId: string, documentId: string): Promise<Finding[]> {
  const { data, error } = await supabaseAdmin()
    .from('bill_audit_findings')
    .select('finding_key, line_indexes, tone, disputed_amount_usd, description, finding_type, data_version, status')
    .eq('case_id', caseId)
    .eq('bill_document_id', documentId)
    .neq('status', 'dismissed');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.finding_key,
    lines: r.line_indexes ?? [],
    tone: r.tone,
    amountUsd: r.disputed_amount_usd == null ? null : Number(r.disputed_amount_usd),
    plainText: r.description,
    ruleId: r.finding_type,
    dataVersion: r.data_version,
  }));
}

export const letterModelSentence = () => process.env.LETTER_MODEL_SENTENCE?.trim().toLowerCase() === 'true';

// Draft a new version of a letter for a confirmed bill. Code writes every
// fact; the model sentence is opt-in (LETTER_MODEL_SENTENCE=true).
export async function createLetter(userId: string, caseId: string, documentId: string, type: LetterType, patient: { name: string; phone: string | null }): Promise<StoredLetter | { error: string }> {
  const doc = await getCaseDocument(caseId, documentId);
  if (!doc?.confirmed_data) return { error: 'confirm what Arik read before writing a letter' };
  const bill = doc.confirmed_data as ConfirmedBill;
  const findings = await storedFindings(caseId, documentId);
  const drafter = letterModelSentence() ? modelLetterDrafter() : codeLetterDrafter;
  let letter;
  try {
    letter = await drafter.draft({
      type,
      patient: { ...patient, address: null },
      recipient: { name: bill.header.provider ?? 'the hospital', address: null, fax: null },
      bill,
      findings,
      date: new Date().toISOString().slice(0, 10),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  const sb = supabaseAdmin();
  const { data: prev } = await sb.from('letters').select('version').eq('case_id', caseId).eq('letter_type', type).order('version', { ascending: false }).limit(1);
  const { data, error } = await sb
    .from('letters')
    .insert({ user_id: userId, case_id: caseId, bill_document_id: documentId, letter_type: type, version: (prev?.[0]?.version ?? 0) + 1, subject: letter.subject, body: letter.body, footer: letter.footer, drafter: letter.drafter, used_fallback: letter.usedFallback })
    .select()
    .single();
  if (error) throw error;
  return data as StoredLetter;
}

export async function getLetter(caseId: string, letterId: string): Promise<StoredLetter | null> {
  const { data, error } = await supabaseAdmin().from('letters').select('*').eq('id', letterId).eq('case_id', caseId).maybeSingle();
  if (error) throw error;
  return data as StoredLetter | null;
}

// The patient's edits to a draft (subject and body only; the footer is
// fixed). A frozen letter refuses edits in the database too.
export async function editLetter(caseId: string, letterId: string, edit: { subject: string; body: string }): Promise<StoredLetter | null> {
  const { data, error } = await supabaseAdmin().from('letters').update(edit).eq('id', letterId).eq('case_id', caseId).eq('status', 'draft').select().maybeSingle();
  if (error) throw error;
  return data as StoredLetter | null;
}

export async function freezeLetter(caseId: string, letterId: string): Promise<StoredLetter | null> {
  const l = await getLetter(caseId, letterId);
  if (!l) return null;
  if (l.status === 'frozen') return l;
  const { data, error } = await supabaseAdmin()
    .from('letters')
    .update({ status: 'frozen', frozen_at: new Date().toISOString(), content_sha256: letterHash(l) })
    .eq('id', letterId)
    .eq('case_id', caseId)
    .eq('status', 'draft')
    .select()
    .single();
  if (error) throw error;
  return data as StoredLetter;
}
