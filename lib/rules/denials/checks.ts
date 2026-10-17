// Denial check functions (Phase 5, spec Appendix B4 A3). Pure. Each
// returns a flag with its citation, or nothing. They run on a
// ConfirmedDenial only (the patient said "Looks right"). Plain text uses
// plain words; rule names and CFR cites go in the letter, not the screen.

import { DENIAL_RULES_VERSION, daysBetween, decidedLate, decisionLimit, patientDeadline, rule } from './rules';
import type { ConfirmedDenial, DenialFlag } from './types';
import { usDate } from './format';

export { DENIAL_RULES_VERSION };

const EMPLOYER_ACA = ['fully_insured', 'self_funded', 'marketplace'];
const MEDICARE = ['medicare_part_d', 'medicare_advantage'];

export function reasonRuleId(d: ConfirmedDenial): string | null {
  if (EMPLOYER_ACA.includes(d.planFunding)) return 'erisa_specific_reason';
  if (d.planFunding === 'medicare_part_d') return 'part_d_specific_reason';
  if (d.planFunding === 'medicare_advantage') return 'ma_specific_reason';
  if (d.planFunding === 'medicaid') return 'medicaid_reasons';
  return null;
}

export function missingSpecificReason(d: ConfirmedDenial): DenialFlag | null {
  const noReason = d.category === 'no_reason_given' || !d.statedReason?.trim();
  if (!noReason) return null;
  const id = reasonRuleId(d);
  return {
    id: 'missing_specific_reason',
    tone: 'wrong',
    plainText: 'The letter does not give a specific reason for the denial. Your plan has to tell you exactly why, so you can answer it. Ask for the reason in writing before the appeal deadline.',
    citation: id ? rule(id).citation : null,
  };
}

export function insurerLate(d: ConfirmedDenial): DenialFlag | null {
  const limit = decisionLimit(d);
  if (!limit || !decidedLate(d, limit)) return null;
  const amount = `${limit.amount} ${limit.unit === 'hours' ? 'hours' : 'days'}`;
  const ext = limit.extensionDays ? ` and did not tell you it was taking up to ${limit.extensionDays} more days` : '';
  const what = d.appealLevel === 'initial' ? 'request' : 'appeal';
  const consequence =
    d.planFunding === 'medicare_part_d' || d.planFunding === 'medicare_advantage'
      ? ' A Medicare plan that misses its deadline has to send your case to the independent reviewer.'
      : d.planFunding === 'medicaid' && d.appealLevel === 'internal_appeal'
        ? ' When a Medicaid plan misses its deadline, you can go straight to a state fair hearing.'
        : '';
  return {
    id: 'insurer_late',
    tone: 'ask',
    plainText: `You sent your ${what} on ${usDate(d.requestDate!)}. The plan had ${amount} to decide, and the letter is dated ${usDate(d.noticeDate)}, ${daysBetween(d.requestDate!, d.noticeDate)} days later. If the plan got it soon after you sent it${ext}, it decided late.${consequence}`,
    citation: rule(limit.ruleId).citation,
    limit: { amount: limit.amount, unit: limit.unit, from: d.requestDate!, decidedOn: d.noticeDate },
  };
}

export function patientDeadlineFlag(d: ConfirmedDenial, today: string): DenialFlag | null {
  const dl = patientDeadline(d);
  if (!dl) {
    if (d.planFunding === 'medicare_advantage' && d.appealLevel === 'internal_appeal') {
      return { id: 'patient_deadline', tone: 'info', plainText: 'Your Medicare Advantage plan upheld its denial, so it must send your case to an independent reviewer on its own. You do not need to file anything for this step. Watch for a letter from the reviewer.', citation: rule('ma_reconsideration_decision').citation };
    }
    if (d.planFunding === 'unknown') {
      return { id: 'patient_deadline', tone: 'ask', plainText: 'Arik can figure out your appeal deadline once you tell us who pays your claims. Until then, use the deadline printed on the letter.', citation: null };
    }
    return null;
  }
  if (!dl.due) return { id: 'patient_deadline', tone: 'ask', plainText: `Your deadline is ${dl.windowText}. ${dl.note ?? ''}`.trim(), citation: dl.citation, deadline: dl };
  const daysLeft = daysBetween(today, dl.due);
  const status = daysLeft < 0 ? 'overdue' : daysLeft <= 14 ? 'due_soon' : 'ok';
  const when = status === 'overdue' ? `was ${usDate(dl.due)}, ${-daysLeft} days ago` : `is ${usDate(dl.due)}, ${daysLeft} day${daysLeft === 1 ? '' : 's'} from today`;
  const late = status === 'overdue' ? (MEDICARE.includes(d.planFunding) ? ' Medicare plans can accept a late request for a good reason, so write down why it is late and file it anyway.' : ' Ask the plan whether it will still accept your appeal, and say why it is late.') : '';
  return {
    id: 'patient_deadline',
    tone: status === 'ok' ? 'info' : 'ask',
    plainText: `Your deadline ${when} (${dl.windowText}).${dl.note ? ` ${dl.note}` : ''}${late}`,
    citation: dl.citation,
    deadline: dl,
    daysLeft,
    status,
  };
}

// An approval for the same service and dates is on file (case data only:
// the approval the patient entered on the confirm screen).
export function priorAuthOnFile(d: ConfirmedDenial): DenialFlag | null {
  const pa = d.priorAuth;
  if (!pa || d.category !== 'no_prior_authorization') return null;
  const dos = d.dateOfService;
  const inDates = dos != null && dos >= pa.validFrom && dos <= pa.validTo;
  const sameService = !pa.serviceCode || !d.serviceCode || pa.serviceCode === d.serviceCode;
  if (!inDates || !sameService) return null;
  return {
    id: 'prior_auth_on_file',
    tone: 'wrong',
    plainText: `The plan says this needed approval first, but you have an approval${pa.reference ? ` (${pa.reference})` : ''} for ${usDate(pa.validFrom)} to ${usDate(pa.validTo)}, which covers the date of service, ${usDate(dos!)}. Send a copy with your appeal.`,
    citation: null,
  };
}

export function administrativeDenial(d: ConfirmedDenial): DenialFlag | null {
  if (d.category !== 'administrative') return null;
  return {
    id: 'administrative_denial',
    tone: 'ask',
    plainText: 'This looks like a paperwork problem, not a decision about your care. Often the doctor\'s office or hospital can fix it by sending a corrected claim or the missing information. Call their billing office first and ask.',
    citation: null,
  };
}

export function selfFundedTrack(d: ConfirmedDenial): DenialFlag | null {
  if (d.planFunding !== 'self_funded') return null;
  return {
    id: 'self_funded_track',
    tone: 'info',
    plainText: 'Your employer pays the claims, so federal rules apply instead of state insurance rules. First, ask the plan for your claim file and the plan documents. They are free, and they show exactly what the plan relied on.',
    citation: rule('erisa_claim_file').citation,
  };
}

export function medicalNecessity(d: ConfirmedDenial): DenialFlag | null {
  if (d.category !== 'medical_necessity') return null;
  const criteria = EMPLOYER_ACA.includes(d.planFunding) ? ' You can also ask the plan, free of charge, for the medical reasoning and the criteria it used.' : '';
  return {
    id: 'medical_necessity',
    tone: 'ask',
    plainText: `The plan says the care was not medically necessary. The strongest answer usually comes from your doctor: a letter explaining why you need it, with your records. Arik drafts the request to your doctor; Arik does not judge medical need.${criteria}`,
    citation: EMPLOYER_ACA.includes(d.planFunding) ? { cite: '29 CFR 2560.503-1(g)(1)(v)(B)', url: rule('erisa_specific_reason').citation.url } : null,
  };
}

export function excludedService(d: ConfirmedDenial): DenialFlag | null {
  if (d.category !== 'excluded_service') return null;
  return {
    id: 'excluded_service',
    tone: 'ask',
    plainText: 'The plan says this is not covered. Ask for the exact words in the plan document it relied on, and compare them with what you had done. Exclusions are often narrower than the denial makes them sound.',
    citation: EMPLOYER_ACA.includes(d.planFunding) ? rule('erisa_claim_file').citation : null,
  };
}

export function externalReview(d: ConfirmedDenial): DenialFlag | null {
  if (d.appealLevel !== 'internal_appeal' || !EMPLOYER_ACA.includes(d.planFunding)) return null;
  return {
    id: 'external_review',
    tone: 'info',
    plainText: 'Your internal appeal was denied. You can ask for an external review, where an independent reviewer decides. The decision usually comes within 45 days, or 72 hours if it is urgent, and the plan must follow it.',
    citation: rule('aca_external_review_decision').citation,
  };
}

export interface DenialReviewResult {
  flags: DenialFlag[];
  rulesVersion: string;
}

export function runDenialChecks(d: ConfirmedDenial, today: string): DenialReviewResult {
  const flags = [missingSpecificReason(d), insurerLate(d), priorAuthOnFile(d), administrativeDenial(d), selfFundedTrack(d), medicalNecessity(d), excludedService(d), externalReview(d)].filter((f): f is DenialFlag => !!f);
  // "No error found": nothing says the plan got it wrong or skipped a
  // step, so the other ways to pay come next (the ranking engine).
  if (!flags.some((f) => f.id === 'missing_specific_reason' || f.id === 'insurer_late' || f.id === 'prior_auth_on_file')) {
    flags.push({
      id: 'no_error_found',
      tone: 'info',
      plainText: 'Arik did not find a mistake in how the plan handled this. You can still appeal, and Arik can look at other ways to pay for it.',
      citation: null,
    });
  }
  const dl = patientDeadlineFlag(d, today);
  return { flags: dl ? [dl, ...flags] : flags, rulesVersion: DENIAL_RULES_VERSION };
}
