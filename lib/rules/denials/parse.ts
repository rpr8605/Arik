// Denial reader (Phase 5): the text a reader found on a denial letter or
// EOB (lib/production/layout.ts keeps it as `text`) -> a draft for the
// "Here's what I read" screen. Pure, no model. The draft is a SUGGESTION:
// nothing runs on it until the patient confirms it
// (lib/rules/denials/confirm.ts). `unsure` lists the fields the patient
// should look at first. Codes are numbers only.

import { parseDate } from '../../production/layout';
import { categoryFromCodes, isCarc, isRarc } from './codes';
import type { AppealLevel, ClaimTiming, DenialCategory, MedicaidDelivery, PlanFunding } from './types';

export interface DenialDraft {
  payerName: string | null;
  providerName: string | null;
  planFunding: PlanFunding;
  medicaidDelivery: MedicaidDelivery;
  category: DenialCategory;
  carcCodes: string[];
  rarcCodes: string[];
  serviceOrDrug: string | null;
  serviceCode: string | null;
  isDrug: boolean;
  noticeDate: string | null;
  dateOfService: string | null;
  requestDate: string | null;
  appealLevel: AppealLevel;
  timing: ClaimTiming;
  isPriorAuthDecision: boolean;
  isUrgent: boolean;
  statedReason: string | null;
  claimNumber: string | null;
  letterDeadlineDays: number | null;
  unsure: string[];
}

const DATE_TOKEN = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4})\b/;
const firstDate = (s: string | undefined) => {
  if (!s) return null;
  const m = s.match(DATE_TOKEN);
  return m ? toIso(m[1]) : null;
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function toIso(tok: string): string | null {
  const named = tok.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/);
  if (named) {
    const m = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (m < 0) return null;
    const iso = `${named[3]}-${String(m + 1).padStart(2, '0')}-${named[2].padStart(2, '0')}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  return parseDate(tok);
}

const after = (text: string, label: RegExp) => {
  const m = text.match(label);
  return m ? text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 80) : undefined;
};

function planFundingFrom(t: string): { planFunding: PlanFunding; medicaidDelivery: MedicaidDelivery } {
  const none = { medicaidDelivery: 'unknown' as MedicaidDelivery };
  if (/medicare advantage|medicare health plan|organization determination/.test(t)) return { planFunding: 'medicare_advantage', ...none };
  if (/part d|medicare prescription drug|coverage determination|redetermination/.test(t)) return { planFunding: 'medicare_part_d', ...none };
  if (/medicaid|medi-cal/.test(t)) {
    const managed = /health plan|managed care|\bmco\b|plan appeal/.test(t);
    const state = /department of (health|human services)|state agency|fair hearing request form/.test(t) && !managed;
    return { planFunding: 'medicaid', medicaidDelivery: managed ? 'managed_care' : state ? 'state' : 'unknown' };
  }
  if (/self-funded|self funded|self-insured|self insured|your employer pays|claims administrator for your employer/.test(t)) return { planFunding: 'self_funded', ...none };
  if (/marketplace|healthcare\.gov|individual (health )?plan/.test(t)) return { planFunding: 'marketplace', ...none };
  if (/fully insured|insured by|state department of insurance/.test(t)) return { planFunding: 'fully_insured', ...none };
  return { planFunding: 'unknown', ...none };
}

function categoryFromText(t: string, reason: string | null): DenialCategory {
  if (!reason) return 'no_reason_given';
  const r = reason.toLowerCase();
  if (/medically necessary|medical necessity|not necessary/.test(r)) return 'medical_necessity';
  if (/approval before|prior auth|preauthoriz|pre-authoriz|precertif|pre-certif|referral/.test(r)) return 'no_prior_authorization';
  if (/not covered|excluded|exclusion|not a covered|not a benefit|formulary/.test(r)) return 'excluded_service';
  if (/did not receive the information|missing|incomplete|corrected claim|duplicate|timely filing|coding|not eligible on/.test(r)) return 'administrative';
  void t;
  return 'other';
}

export function parseDenialText(text: string): DenialDraft {
  const t = text.toLowerCase();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const unsure: string[] = [];

  // Codes: group-code style (CO-50, PR 204) and labelled lists.
  const carc = new Set<string>();
  const rarc = new Set<string>();
  for (const m of text.matchAll(/\b(?:CO|PR|OA|PI|CR)[-\s]?(\d{1,3})\b/g)) carc.add(String(Number(m[1])));
  for (const m of text.matchAll(/(?:reason|adjustment|denial|CARC)\s+codes?\s*[:#]?\s*((?:(?:[A-Z]{2}[-\s]?)?\d{1,3}(?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const c of m[1].matchAll(/(\d{1,3})/g)) carc.add(String(Number(c[1])));
  }
  for (const m of text.matchAll(/(?:remark|RARC)\s+codes?\s*[:#]?\s*((?:(?:MA|M|N)\d{1,3}(?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const c of m[1].matchAll(/((?:MA|M|N)\d{1,3})/g)) rarc.add(c[1]);
  }
  const carcCodes = [...carc].filter(isCarc);
  const rarcCodes = [...rarc].filter(isRarc);

  // The reason line; a second line only when the first stops mid-sentence.
  const reasonM = text.match(/\b(?:reason(?: for (?:our|the) decision)?|why we (?:denied|said no)[^:\n]*)\s*:\s*([^\n]+)(?:\n([^\n]+))?/i);
  const first = reasonM?.[1].trim() ?? '';
  const statedReason = reasonM ? (/[.!?]$/.test(first) || !reasonM[2] ? first : `${first} ${reasonM[2].trim()}`).replace(/\s+/g, ' ') : null;

  const codeM = text.match(/\((?:code|cpt|hcpcs)[:\s]*([A-Z]?\d{4,5}[A-Z]?)\)/i) ?? text.match(/\b(?:CPT|HCPCS|procedure code)[:\s#]*([A-Z]?\d{4,5})\b/i);
  // "Service:" but never "Date of service:".
  const serviceM = text.match(/(?:request for|claim for|(?<!(?:date|dates)\(?s?\)? of )\bservice(?: requested)?|drug(?: requested)?|\bitem)\s*:\s*([^\n(]+)/i);
  const serviceOrDrug = serviceM ? serviceM[1].replace(/\s+/g, ' ').trim().replace(/[.,]$/, '') : null;

  const { planFunding, medicaidDelivery } = planFundingFrom(t);
  if (planFunding === 'unknown') unsure.push('planFunding');

  const noticeDate = firstDate(after(text, /(?:date of (?:this )?(?:notice|letter)|notice date|letter date)\s*:?/i)) ?? firstDate(lines.slice(0, 8).join(' '));
  if (!noticeDate) unsure.push('noticeDate');
  const dateOfService = firstDate(after(text, /(?:date\(?s?\)? of service|service date)\s*:?/i));
  const requestDate = firstDate(after(text, /(?:we received your (?:request|claim|appeal) on|request(?:ed)? (?:date|on)|appeal received)\s*:?/i));

  const appealLevel: AppealLevel = /(we (?:have )?reviewed your appeal|your appeal (?:was|is|has been) denied|appeal decision|we (?:have )?upheld|final internal|notice of redetermination|redetermination notice|reconsideration decision)/.test(t) ? 'internal_appeal' : 'initial';
  const isPriorAuthDecision = /prior auth|preauthoriz|pre-authoriz|precertif|request for (?:approval|authorization)|we reviewed the request for/.test(t);
  const isDrug = planFunding === 'medicare_part_d' || /prescription|\bdrug\b|tablets?\b|\bmg\b|formulary/.test(t);
  const timing: ClaimTiming = /request for (?:payment|reimbursement)|pay you back/.test(t) ? 'payment' : isPriorAuthDecision || /before you get|not yet received|requested service/.test(t) ? 'pre_service' : 'post_service';
  if (!isPriorAuthDecision && !dateOfService) unsure.push('timing');
  const isUrgent = /\b(expedited|urgent|fast appeal|72 hours)\b/.test(t);
  const deadlineM = t.match(/appeal[^.]{0,80}?within (\d{1,3}) (?:calendar )?days/) ?? t.match(/within (\d{1,3}) (?:calendar )?days[^.]{0,60}appeal/);
  const letterDeadlineDays = deadlineM ? Number(deadlineM[1]) : null;
  const claimM = text.match(/\b(?:claim|reference|case|request)\s*(?:number|no\.?|#|id)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})/i);

  const category = categoryFromCodes(carcCodes) ?? categoryFromText(t, statedReason);
  if (!carcCodes.length && category === 'other') unsure.push('category');

  const payerName = lines.find((l) => /\b(health|insurance|plan|care|medicare|medicaid|mutual|assurance|benefits)\b/i.test(l) && !/^dear\b/i.test(l) && !DATE_TOKEN.test(l) && l.length < 80) ?? lines[0] ?? null;

  const providerM = text.match(/(?:provider|doctor|physician|facility|prescriber)(?: name)?\s*:\s*([^\n]+)/i);

  return {
    payerName,
    providerName: providerM ? providerM[1].trim().slice(0, 200) : null,
    planFunding,
    medicaidDelivery,
    category,
    carcCodes,
    rarcCodes,
    serviceOrDrug,
    serviceCode: codeM ? codeM[1].toUpperCase() : null,
    isDrug,
    noticeDate,
    dateOfService,
    requestDate,
    appealLevel,
    timing,
    isPriorAuthDecision,
    isUrgent,
    statedReason,
    claimNumber: claimM ? claimM[1] : null,
    letterDeadlineDays,
    unsure,
  };
}
