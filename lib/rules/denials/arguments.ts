// Argument builder (Phase 5). Pure. From the confirmed denial, the check
// flags, the Medicare coverage rules in force for the service (db/036, via
// getCoverageRule) and whether the patient has the plan's own documents,
// build the points an appeal makes. Each point is one or two sentences in
// the patient's voice, written by code, citing its rule. No clinical
// judgment: a medical necessity appeal points to the doctor's letter.

import type { CoverageRuleHit } from '../../data/coverage';
import { reasonRuleId } from './checks';
import { usDate } from './format';
import { rule } from './rules';
import type { Citation, ConfirmedDenial, DenialFlag } from './types';

export type ArgumentType = 'specific_reason_missing' | 'late_decision' | 'prior_auth_on_file' | 'coverage_rule' | 'doctor_support' | 'plan_language' | 'corrected_claim' | 'claim_file' | 'review_again';

export interface AppealArgument {
  type: ArgumentType;
  sentence: string;
  citation: Citation | null;
}

const EMPLOYER_ACA = ['fully_insured', 'self_funded', 'marketplace'];

export interface ArgumentContext {
  coverageRules: CoverageRuleHit[] | null;   // Medicare coverage rules for the service code (Medicare Advantage only)
  planDocumentOnFile: boolean;               // the patient uploaded the plan's own document
}

export function buildArguments(d: ConfirmedDenial, flags: DenialFlag[], ctx: ArgumentContext): AppealArgument[] {
  const has = (id: DenialFlag['id']) => flags.find((f) => f.id === id);
  const out: AppealArgument[] = [];

  if (has('missing_specific_reason')) {
    const rid = reasonRuleId(d);
    const r = rid ? rule(rid).citation : null;
    out.push({ type: 'specific_reason_missing', sentence: `Your notice does not state the specific reason for the denial${r ? `, which the rules require (${r.cite})` : ''}. Please send me the specific reason, the denial code and what it means, and the standard you used.`, citation: r });
  }

  const late = has('insurer_late');
  if (late?.limit) {
    const lim = `${late.limit.amount} ${late.limit.unit}`;
    let then = '';
    if (d.planFunding === 'medicare_part_d') {
      then = d.appealLevel === 'initial' ? ' Under 42 CFR 423.568(h), a late decision counts as a denial that you must forward to the independent review entity.' : ' Under 42 CFR 423.590(c), a late redetermination counts as a denial that you must forward to the independent review entity within 24 hours.';
    } else if (d.planFunding === 'medicaid' && d.appealLevel === 'internal_appeal') {
      then = ' Under 42 CFR 438.402(c)(1)(i)(A), when the plan misses its timing rules I may go directly to a State fair hearing.';
    }
    out.push({ type: 'late_decision', sentence: `I sent my ${d.appealLevel === 'initial' ? 'request' : 'appeal'} on ${usDate(late.limit.from)}. Your decision is dated ${usDate(late.limit.decidedOn)}. The rules allow ${lim} (${late.citation?.cite}). Unless you notified me of an extension, this decision was late.${then}`, citation: late.citation });
  }

  if (has('prior_auth_on_file') && d.priorAuth) {
    const pa = d.priorAuth;
    out.push({ type: 'prior_auth_on_file', sentence: `This service was approved in advance${pa.reference ? ` (approval ${pa.reference})` : ''}, for ${usDate(pa.validFrom)} to ${usDate(pa.validTo)}, which covers my date of service, ${usDate(d.dateOfService!)}. A copy of the approval is enclosed.`, citation: null });
  }

  // Medicare Advantage plans must follow Medicare's coverage rules; cite
  // only a rule that lists this exact code.
  if (d.planFunding === 'medicare_advantage' && d.serviceCode && ctx.coverageRules?.length) {
    const hit = ctx.coverageRules.find((r) => r.matchedBy === 'code');
    if (hit) {
      out.push({ type: 'coverage_rule', sentence: `Medicare Advantage plans must follow Medicare's coverage rules (42 CFR 422.101(b)). Medicare's coverage rule ${hit.displayId}, "${hit.title}", lists code ${d.serviceCode}. Please review my claim against that rule and tell me which of its requirements you believe were not met.`, citation: { cite: `${hit.docType} ${hit.displayId}`, url: hit.url } });
    }
  }

  if (d.category === 'medical_necessity') {
    const ask = EMPLOYER_ACA.includes(d.planFunding) ? ' Please also send me, free of charge, the clinical reasoning and the criteria you used (29 CFR 2560.503-1(g)(1)(v)(B)).' : '';
    out.push({ type: 'doctor_support', sentence: `I have asked my doctor for a letter explaining why I need this care, and for my related records. I will send them, or they are enclosed.${ask}`, citation: EMPLOYER_ACA.includes(d.planFunding) ? { cite: '29 CFR 2560.503-1(g)(1)(v)(B)', url: rule('erisa_specific_reason').citation.url } : null });
  }

  if (d.category === 'excluded_service') {
    out.push({ type: 'plan_language', sentence: ctx.planDocumentOnFile ? 'I have reviewed my plan document. Please identify the exact provision you relied on, by section and page, and explain how it applies to this service.' : 'Please identify the exact plan provision you relied on, by section and page, send me a copy, and explain how it applies to this service.', citation: EMPLOYER_ACA.includes(d.planFunding) ? rule('erisa_claim_file').citation : null });
  }

  if (d.category === 'administrative') {
    out.push({ type: 'corrected_claim', sentence: 'I have asked my provider to send a corrected claim or the missing information. Please reprocess the claim when it arrives.', citation: null });
  }

  if (EMPLOYER_ACA.includes(d.planFunding) && (d.planFunding === 'self_funded' || d.category === 'medical_necessity' || d.category === 'excluded_service')) {
    out.push({ type: 'claim_file', sentence: 'Please send me, free of charge, copies of all documents, records and other information relevant to my claim, including the plan documents (29 CFR 2560.503-1(h)(2)(iii)).', citation: rule('erisa_claim_file').citation });
  }

  out.push({ type: 'review_again', sentence: 'I disagree with this decision and ask that you review it again with the information above.', citation: null });
  return out;
}
