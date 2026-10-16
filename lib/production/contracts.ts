// Contract checks every implementation must pass, demo or real
// (scripts/test_production_contracts.ts runs both). Each returns a list of
// problems; empty means the output honors the contract.

import { LETTER_FOOTER, type ConfirmedBill, type DraftLetter, type ExtractedDocument, type Finding, type LetterInput } from './types';

const DOC_TYPES = ['itemized_bill', 'summary_bill', 'eob', 'denial_letter', 'insurance_card', 'pharmacy_receipt', 'unknown'];
const EM_DASH = String.fromCharCode(0x2014);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const inBox = (b: { page: number; x: number; y: number; w: number; h: number } | null) =>
  b == null || (b.page >= 1 && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 100.5 && b.y + b.h <= 100.5);

export function extractionProblems(d: ExtractedDocument): string[] {
  const p: string[] = [];
  if (!DOC_TYPES.includes(d.docType)) p.push(`bad docType ${d.docType}`);
  if (!d.reader) p.push('missing reader name');
  const fields = [...Object.entries(d.header), ...d.lines.flatMap((l, i) => Object.entries(l).filter(([k]) => k !== 'box').map(([k, v]) => [`line ${i} ${k}`, v] as const))];
  for (const [k, v] of fields as [string, any][]) {
    if (!(v.confidence >= 0 && v.confidence <= 1)) p.push(`${k}: confidence out of range`);
    if (!inBox(v.box)) p.push(`${k}: box outside the page`);
  }
  for (const k of ['statementDate', 'serviceFrom', 'serviceTo'] as const) {
    const v = d.header[k].value;
    if (v != null && !ISO.test(v)) p.push(`${k} not ISO: ${v}`);
  }
  d.lines.forEach((l, i) => {
    if (l.date.value != null && !ISO.test(l.date.value)) p.push(`line ${i} date not ISO`);
    if (l.code.value != null && !/^[A-Z0-9]{4,5}$/i.test(l.code.value)) p.push(`line ${i} code not a code: ${l.code.value}`);
    if (l.chargeUsd.value != null && !(l.chargeUsd.value >= 0)) p.push(`line ${i} negative charge`);
    if (l.units.value != null && !(Number.isInteger(l.units.value) && l.units.value > 0)) p.push(`line ${i} bad units`);
    if (!inBox(l.box)) p.push(`line ${i} row box outside the page`);
  });
  return p;
}

export function findingsProblems(findings: Finding[], bill: ConfirmedBill): string[] {
  const p: string[] = [];
  const ids = new Set<string>();
  for (const f of findings) {
    if (ids.has(f.id)) p.push(`duplicate finding id ${f.id}`);
    ids.add(f.id);
    if (!f.lines.length || f.lines.some((i) => i < 0 || i >= bill.lines.length)) p.push(`${f.id}: line index out of range`);
    if (!['wrong', 'ask'].includes(f.tone)) p.push(`${f.id}: bad tone`);
    if (!f.ruleId || !f.dataVersion) p.push(`${f.id}: missing rule or data version`);
    if (f.amountUsd != null && !(f.amountUsd > 0)) p.push(`${f.id}: amount must be positive or null`);
    if (f.refsUsd && !f.refsUsd.every((x) => Number.isFinite(x) && x > 0)) p.push(`${f.id}: named amounts must be positive`);
    if (/CFR|NCCI|MUE|§|section \d|\bPTP\b/i.test(f.plainText)) p.push(`${f.id}: rule names in patient text`);
    if (f.plainText.includes(EM_DASH)) p.push(`${f.id}: em dash`);
    // A finding's amount can never exceed what its lines charged.
    const charged = f.lines.reduce((t, i) => t + (bill.lines[i]?.chargeUsd ?? 0), 0);
    if (f.amountUsd != null && f.amountUsd > charged + 0.005) p.push(`${f.id}: amount ${f.amountUsd} exceeds its lines (${charged})`);
  }
  return p;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function letterProblems(l: DraftLetter, input: LetterInput): string[] {
  const p: string[] = [];
  if (l.footer !== LETTER_FOOTER) p.push('footer is not the required text');
  if ((l.subject + l.body).includes(EM_DASH)) p.push('em dash');
  if (/\b(attorney|lawsuit|sue you|legal action|legal advice)\b/i.test(l.body)) p.push('legal-advice or threat wording');
  if (l.body.includes('{') || l.body.includes('}')) p.push('unfilled placeholder');
  // Grounding: every dollar amount in the letter is a bill line, a finding
  // amount, an amount a finding names (refsUsd) or a bill total.
  const allowed = new Set<string>([
    ...input.findings.map((f) => f.amountUsd).filter((x): x is number => x != null).map(money),
    ...input.findings.flatMap((f) => f.refsUsd ?? []).map(money),
    ...input.bill.lines.map((x) => x.chargeUsd).filter((x): x is number => x != null).map(money),
    ...[input.bill.header.totalChargesUsd, input.bill.header.amountDueUsd].filter((x): x is number => x != null).map(money),
  ]);
  for (const m of l.body.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []) {
    const norm = money(Number(m.replace(/[$,]/g, '')));
    if (!allowed.has(norm)) p.push(`amount not in the bill or findings: ${m}`);
  }
  if (input.bill.header.accountNumber && !l.body.includes(input.bill.header.accountNumber) && !l.subject.includes(input.bill.header.accountNumber)) {
    p.push('account number missing');
  }
  return p;
}

export const findingsTotal = (f: Finding[]) => Math.round(f.reduce((t, x) => t + (x.amountUsd ?? 0), 0) * 100) / 100;
