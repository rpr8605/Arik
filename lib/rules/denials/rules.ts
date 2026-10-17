// Denial rules registry and deadline engine (Phase 5, spec Appendix B4).
// Pure. Every value here is quoted in
// docs/research/denial_rules_verification.md (eCFR, current to 2026-10-15);
// scripts/test_denial_rules.ts tests each rule, including month ends and
// leap years, and checks the registry matches db/041's `rules` seed.
//
// Safety rules (same doc): a window that runs from the patient's receipt
// of a notice is counted from the date ON the notice, so the date shown is
// never later than the real one, unless the rule sets a presumed receipt
// date (Medicare: 5 days). If the letter states a shorter window, the
// earlier date is shown.

import type { Citation, ClaimTiming, ConfirmedDenial, PatientDeadline, PlanFunding } from './types';

export const DENIAL_RULES_VERSION = 'ecfr-2026-10-15';

const ecfr = (title: number, section: string) => `https://www.ecfr.gov/current/title-${title}/section-${section}`;
const c = (cite: string, title: number, section: string): Citation => ({ cite, url: ecfr(title, section) });

export interface DenialRule {
  id: string;
  planFunding: PlanFunding[];
  description: string;
  citation: Citation;
  effectiveFrom: string | null;
}

const EMPLOYER_ACA: PlanFunding[] = ['fully_insured', 'self_funded', 'marketplace'];

export const DENIAL_RULES: DenialRule[] = [
  // Employer, marketplace and individual plans (ERISA claims rule, applied to insured and individual coverage by 45 CFR 147.136(b)).
  { id: 'aca_internal_appeal_window', planFunding: EMPLOYER_ACA, description: 'Internal appeal: at least 180 days after receiving the denial', citation: c('29 CFR 2560.503-1(h)(4)(i); 45 CFR 147.136(b)', 29, '2560.503-1'), effectiveFrom: '2017-01-01' },
  { id: 'aca_external_review_window', planFunding: EMPLOYER_ACA, description: 'External review: within four months after receiving the final internal denial', citation: c('45 CFR 147.136(c)(2)(vi), (d)(2)(i)', 45, '147.136'), effectiveFrom: '2017-01-01' },
  { id: 'aca_external_review_decision', planFunding: EMPLOYER_ACA, description: 'External review decision: 45 days, 72 hours expedited', citation: c('45 CFR 147.136(d)(2)', 45, '147.136'), effectiveFrom: '2017-01-01' },
  { id: 'erisa_first_decision', planFunding: EMPLOYER_ACA, description: 'First decision: 72 hours urgent, 15 days pre-service, 30 days post-service (one 15-day extension)', citation: c('29 CFR 2560.503-1(f)(2)', 29, '2560.503-1'), effectiveFrom: '2017-01-01' },
  { id: 'erisa_appeal_decision', planFunding: EMPLOYER_ACA, description: 'Decision on appeal: 72 hours urgent, 30 days pre-service, 60 days post-service', citation: c('29 CFR 2560.503-1(i)(2)', 29, '2560.503-1'), effectiveFrom: '2017-01-01' },
  { id: 'erisa_specific_reason', planFunding: EMPLOYER_ACA, description: 'The notice must give the specific reason, the denial code and its meaning, and the standard used', citation: c('29 CFR 2560.503-1(g)(1)(i); 45 CFR 147.136(b)(2)(ii)(E)(3)', 29, '2560.503-1'), effectiveFrom: '2017-01-01' },
  { id: 'erisa_claim_file', planFunding: EMPLOYER_ACA, description: 'Copies of all documents relevant to the claim, free of charge, on request', citation: c('29 CFR 2560.503-1(h)(2)(iii)', 29, '2560.503-1'), effectiveFrom: '2017-01-01' },
  // Medicare Part D
  { id: 'part_d_redetermination_window', planFunding: ['medicare_part_d'], description: 'Redetermination: 60 days after receipt, receipt presumed 5 days after the notice date', citation: c('42 CFR 423.582(b)', 42, '423.582'), effectiveFrom: null },
  { id: 'part_d_ire_window', planFunding: ['medicare_part_d'], description: 'Independent review: 60 days after receipt of the redetermination, receipt presumed 5 days after its date', citation: c('42 CFR 423.600(a)', 42, '423.600'), effectiveFrom: null },
  { id: 'part_d_coverage_decision', planFunding: ['medicare_part_d'], description: 'Coverage decision: 72 hours for a drug, 14 days for payment, 24 hours expedited', citation: c('42 CFR 423.568(b), (c); 423.572(a)', 42, '423.568'), effectiveFrom: null },
  { id: 'part_d_redetermination_decision', planFunding: ['medicare_part_d'], description: 'Redetermination decision: 7 days for a drug, 14 days for payment, 72 hours expedited', citation: c('42 CFR 423.590(a), (b), (d)', 42, '423.590'), effectiveFrom: null },
  { id: 'part_d_specific_reason', planFunding: ['medicare_part_d'], description: 'The notice must state the specific reasons for the denial', citation: c('42 CFR 423.568(g)(2); 423.590(g)(2)', 42, '423.568'), effectiveFrom: null },
  { id: 'part_d_exception', planFunding: ['medicare_part_d'], description: 'Formulary and tier exceptions need the prescriber\'s supporting statement', citation: c('42 CFR 423.578', 42, '423.578'), effectiveFrom: null },
  // Medicare Advantage
  { id: 'ma_reconsideration_window', planFunding: ['medicare_advantage'], description: 'Reconsideration: 60 days after receipt, receipt presumed 5 days after the notice date', citation: c('42 CFR 422.582(b)', 42, '422.582'), effectiveFrom: null },
  { id: 'ma_first_decision', planFunding: ['medicare_advantage'], description: 'First decision: 14 days, 7 days for prior authorization from 2026-01-01, 72 hours expedited or for a Part B drug (14-day extension for services)', citation: c('42 CFR 422.568(b); 422.572(a)', 42, '422.568'), effectiveFrom: '2026-01-01' },
  { id: 'ma_reconsideration_decision', planFunding: ['medicare_advantage'], description: 'Reconsideration decision: 30 days for a service, 60 for payment, 7 for a Part B drug, 72 hours expedited; upheld denials go to the independent reviewer automatically', citation: c('42 CFR 422.590', 42, '422.590'), effectiveFrom: null },
  { id: 'ma_specific_reason', planFunding: ['medicare_advantage'], description: 'The notice must state the specific reasons for the denial', citation: c('42 CFR 422.568(e)(2); 422.572(e)(1)', 42, '422.568'), effectiveFrom: null },
  { id: 'ma_follows_medicare_coverage', planFunding: ['medicare_advantage'], description: 'Medicare Advantage plans must follow national and local Medicare coverage decisions', citation: c('42 CFR 422.101(b)', 42, '422.101'), effectiveFrom: null },
  // Medicaid
  { id: 'medicaid_plan_appeal_window', planFunding: ['medicaid'], description: 'Managed care plan appeal: 60 days from the date on the notice', citation: c('42 CFR 438.402(c)(2)(ii)', 42, '438.402'), effectiveFrom: null },
  { id: 'medicaid_plan_appeal_decision', planFunding: ['medicaid'], description: 'Plan appeal decision: 30 days, 72 hours expedited (14-day extension)', citation: c('42 CFR 438.408(b), (c)', 42, '438.408'), effectiveFrom: null },
  { id: 'medicaid_fair_hearing_window', planFunding: ['medicaid'], description: 'State fair hearing after the plan upholds: at least 90 and at most 120 days from the plan\'s notice', citation: c('42 CFR 438.408(f)(2)', 42, '438.408'), effectiveFrom: null },
  { id: 'medicaid_state_hearing_window', planFunding: ['medicaid'], description: 'State Medicaid hearing: a time the state sets, not more than 90 days from the notice', citation: c('42 CFR 431.221(d)', 42, '431.221'), effectiveFrom: null },
  { id: 'medicaid_first_decision', planFunding: ['medicaid'], description: 'Authorization decision: 7 days for rating periods from 2026-01-01 (14 before), 72 hours expedited (14-day extension)', citation: c('42 CFR 438.210(d)', 42, '438.210'), effectiveFrom: null },
  { id: 'medicaid_reasons', planFunding: ['medicaid'], description: 'The notice must explain the reasons for the decision', citation: c('42 CFR 438.404(b)(2)', 42, '438.404'), effectiveFrom: null },
];

export function rule(id: string): DenialRule {
  const r = DENIAL_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown denial rule ${id}`);
  return r;
}

// ---------- Dates (calendar days, UTC, ISO YYYY-MM-DD) ----------

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

// 45 CFR 147.136(d)(2)(i): the same day N months later; if there is no
// such day, the first day of the month after (October 30 -> March 1).
export function addMonthsRule(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  if (d <= lastDay) return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), d)).toISOString().slice(0, 10);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

// ---------- The patient's deadlines ----------

const MEDICARE_RECEIPT_DAYS = 5;

function windowDeadline(d: ConfirmedDenial): PatientDeadline | null {
  const n = d.noticeDate;
  const f = d.planFunding;
  if (EMPLOYER_ACA.includes(f)) {
    if (d.appealLevel === 'initial') {
      return { ruleId: 'aca_internal_appeal_window', step: 'internal_appeal', due: addDays(n, 180), windowText: '180 days from the date on the notice', note: null, citation: rule('aca_internal_appeal_window').citation };
    }
    return { ruleId: 'aca_external_review_window', step: 'external_review', due: addMonthsRule(n, 4), windowText: 'four months from the date on the notice', note: null, citation: rule('aca_external_review_window').citation };
  }
  if (f === 'medicare_part_d') {
    const id = d.appealLevel === 'initial' ? 'part_d_redetermination_window' : 'part_d_ire_window';
    return { ruleId: id, step: d.appealLevel === 'initial' ? 'part_d_redetermination' : 'part_d_ire', due: addDays(n, MEDICARE_RECEIPT_DAYS + 60), windowText: '65 days from the date on the notice (60 days after it is presumed received)', note: null, citation: rule(id).citation };
  }
  if (f === 'medicare_advantage') {
    if (d.appealLevel === 'initial') {
      return { ruleId: 'ma_reconsideration_window', step: 'ma_reconsideration', due: addDays(n, MEDICARE_RECEIPT_DAYS + 60), windowText: '65 days from the date on the notice (60 days after it is presumed received)', note: null, citation: rule('ma_reconsideration_window').citation };
    }
    return null; // an upheld reconsideration goes to the independent reviewer automatically (422.590(a)(2))
  }
  if (f === 'medicaid') {
    if (d.medicaidDelivery === 'managed_care') {
      if (d.appealLevel === 'initial') {
        return { ruleId: 'medicaid_plan_appeal_window', step: 'medicaid_plan_appeal', due: addDays(n, 60), windowText: '60 days from the date on the notice', note: null, citation: rule('medicaid_plan_appeal_window').citation };
      }
      return { ruleId: 'medicaid_fair_hearing_window', step: 'medicaid_fair_hearing', due: addDays(n, 90), windowText: 'at least 90 days from the date on the plan\'s notice', note: 'Your state may allow up to 120 days. The notice should say which.', citation: rule('medicaid_fair_hearing_window').citation };
    }
    if (d.medicaidDelivery === 'state') {
      return { ruleId: 'medicaid_state_hearing_window', step: 'medicaid_fair_hearing', due: null, windowText: 'the time your state sets, no more than 90 days from the notice', note: 'Use the date printed on your notice.', citation: rule('medicaid_state_hearing_window').citation };
    }
    return { ruleId: 'medicaid_plan_appeal_window', step: 'medicaid_plan_appeal', due: null, windowText: 'it depends on whether your Medicaid is through a health plan', note: 'If the notice came from a Medicaid health plan, you have 60 days from the date on it. If it came from the state, use the date printed on the notice.', citation: rule('medicaid_plan_appeal_window').citation };
  }
  return null;
}

// The deadline to show: the rule's, or the letter's own if that is earlier.
export function patientDeadline(d: ConfirmedDenial): PatientDeadline | null {
  const base = windowDeadline(d);
  if (!base) return null;
  if (d.letterDeadlineDays == null) return base;
  const letterDue = addDays(d.noticeDate, d.letterDeadlineDays);
  if (base.due == null || letterDue < base.due) {
    return {
      ...base,
      due: letterDue,
      windowText: `${d.letterDeadlineDays} days from the date on the notice, as the letter says`,
      note: base.due == null ? base.note : `The letter gives you less time than the rule's minimum (${base.windowText}). Arik uses the earlier date to be safe; you can ask the plan about it.`,
    };
  }
  return base;
}

// ---------- How long the plan had to decide ----------

export interface DecisionLimit {
  ruleId: string;
  amount: number;
  unit: 'days' | 'hours';
  extensionDays: number;   // an extension the plan may take, which the notice would mention
}

export function decisionLimit(d: ConfirmedDenial): DecisionLimit | null {
  const f = d.planFunding;
  const t: ClaimTiming = d.timing;
  const req = d.requestDate;
  if (!req) return null;
  if (EMPLOYER_ACA.includes(f)) {
    if (d.appealLevel === 'initial') {
      if (d.isUrgent) return { ruleId: 'erisa_first_decision', amount: 72, unit: 'hours', extensionDays: 0 };
      if (t === 'pre_service') return { ruleId: 'erisa_first_decision', amount: 15, unit: 'days', extensionDays: 15 };
      return { ruleId: 'erisa_first_decision', amount: 30, unit: 'days', extensionDays: 15 };
    }
    if (d.isUrgent) return { ruleId: 'erisa_appeal_decision', amount: 72, unit: 'hours', extensionDays: 0 };
    return { ruleId: 'erisa_appeal_decision', amount: t === 'pre_service' ? 30 : 60, unit: 'days', extensionDays: 0 };
  }
  if (f === 'medicare_part_d') {
    if (d.appealLevel === 'initial') {
      if (d.isUrgent) return { ruleId: 'part_d_coverage_decision', amount: 24, unit: 'hours', extensionDays: 0 };
      return t === 'payment' ? { ruleId: 'part_d_coverage_decision', amount: 14, unit: 'days', extensionDays: 0 } : { ruleId: 'part_d_coverage_decision', amount: 72, unit: 'hours', extensionDays: 0 };
    }
    if (d.isUrgent) return { ruleId: 'part_d_redetermination_decision', amount: 72, unit: 'hours', extensionDays: 0 };
    return { ruleId: 'part_d_redetermination_decision', amount: t === 'payment' ? 14 : 7, unit: 'days', extensionDays: 0 };
  }
  if (f === 'medicare_advantage') {
    if (d.appealLevel === 'initial') {
      if (t !== 'pre_service') return null; // payment decisions: not checked here
      if (d.isDrug) return { ruleId: 'ma_first_decision', amount: d.isUrgent ? 24 : 72, unit: 'hours', extensionDays: 0 };
      if (d.isUrgent) return { ruleId: 'ma_first_decision', amount: 72, unit: 'hours', extensionDays: 14 };
      return { ruleId: 'ma_first_decision', amount: d.isPriorAuthDecision && req >= '2026-01-01' ? 7 : 14, unit: 'days', extensionDays: 14 };
    }
    if (d.isUrgent) return { ruleId: 'ma_reconsideration_decision', amount: 72, unit: 'hours', extensionDays: d.isDrug ? 0 : 14 };
    if (d.isDrug) return { ruleId: 'ma_reconsideration_decision', amount: 7, unit: 'days', extensionDays: 0 };
    return { ruleId: 'ma_reconsideration_decision', amount: t === 'pre_service' ? 30 : 60, unit: 'days', extensionDays: t === 'pre_service' ? 14 : 0 };
  }
  if (f === 'medicaid' && d.medicaidDelivery === 'managed_care') {
    if (d.appealLevel === 'initial') {
      if (t !== 'pre_service') return null;
      // 7 days only for rating periods starting 2026-01-01 or later; a
      // rating period is at most a year, so before 2027 the older 14 holds.
      if (d.isUrgent) return { ruleId: 'medicaid_first_decision', amount: 72, unit: 'hours', extensionDays: 14 };
      return { ruleId: 'medicaid_first_decision', amount: req >= '2027-01-01' ? 7 : 14, unit: 'days', extensionDays: 14 };
    }
    return d.isUrgent ? { ruleId: 'medicaid_plan_appeal_decision', amount: 72, unit: 'hours', extensionDays: 14 } : { ruleId: 'medicaid_plan_appeal_decision', amount: 30, unit: 'days', extensionDays: 14 };
  }
  return null;
}

// Possibly late: the notice is dated after the limit, counted from the day
// the patient says the request was SENT. Never certain (the plan may have
// received it later, or taken an extension it told the patient about), so
// the check that uses this always asks. Hours: N hours from any time on
// the request day end no later than the end of day N/24.
export function decidedLate(d: ConfirmedDenial, limit: DecisionLimit): boolean {
  if (!d.requestDate) return false;
  const elapsed = daysBetween(d.requestDate, d.noticeDate);
  const allowed = limit.unit === 'hours' ? Math.ceil(limit.amount / 24) : limit.amount;
  return elapsed > allowed;
}
