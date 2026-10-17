// "Arik watches it" (Phase 6): when a reply is due for a sent letter, and
// whether it is overdue. Pure. Deadlines come only from verified rules
// (docs/research/denial_rules_verification.md), counted from the delivery
// date, which is when the plan received the letter. A letter with no
// verified rule gets no deadline and says so; Arik never guesses one.

import { addDays, decisionLimit, rule } from '../rules/denials/rules';
import type { Citation, ConfirmedDenial, DenialLetterType } from '../rules/denials/types';
import type { LetterType } from '../production/types';

export interface ResponseDeadline {
  due: string | null;          // ISO date
  ruleId: string | null;
  citation: Citation | null;
  text: string;                // plain words for the timeline
  certain: boolean;            // false: the clock starts at a step Arik cannot see, so "overdue" is worded as a question
}

const NO_RULE = (what: string): ResponseDeadline => ({ due: null, ruleId: null, citation: null, text: `There is no set deadline for a reply to ${what}. Arik will remind you to check in.`, certain: false });

export function responseDeadline(letterType: LetterType | DenialLetterType, deliveredAt: string, denial: ConfirmedDenial | null): ResponseDeadline {
  const day = deliveredAt.slice(0, 10);
  if (letterType === 'external_review_request') {
    const urgent = !!denial?.isUrgent;
    const r = rule('aca_external_review_decision');
    return { due: addDays(day, urgent ? 3 : 45), ruleId: r.id, citation: r.citation, text: `The independent reviewer has ${urgent ? '72 hours' : '45 days'} after it gets your request. Arik counts from the day the plan got it, so the real date may be a little later.`, certain: false };
  }
  if (letterType === 'insurer_appeal' && denial) {
    if (denial.planFunding === 'medicaid' && denial.appealLevel === 'internal_appeal') return NO_RULE('a State fair hearing request');
    const limit = decisionLimit({ ...denial, appealLevel: 'internal_appeal', requestDate: day, noticeDate: day });
    if (!limit) return NO_RULE('this appeal');
    const days = limit.unit === 'hours' ? Math.ceil(limit.amount / 24) : limit.amount;
    const r = rule(limit.ruleId);
    const ext = limit.extensionDays ? ` The plan can take up to ${limit.extensionDays} more days if it tells you in writing.` : '';
    return { due: addDays(day, days), ruleId: r.id, citation: r.citation, text: `The plan has ${limit.amount} ${limit.unit} from the day it got your appeal to decide.${ext}`, certain: true };
  }
  const words: Record<string, string> = {
    billing_dispute: 'a billing dispute', itemized_bill_request: 'a request for an itemized bill', hold_collections: 'a request to hold collections',
    financial_assistance_cover: 'a financial assistance application', medical_necessity_request: 'a request to your doctor',
    claim_file_request: 'a claim file request', specific_reason_request: 'a request for the specific reason', part_d_exception: 'an exception request until your prescriber\'s statement arrives',
    insurer_appeal: 'this appeal',
  };
  return NO_RULE(words[letterType] ?? 'this letter');
}

export type JobStatus = 'awaiting_approval' | 'queued' | 'sent' | 'delivered' | 'failed' | 'replied' | 'closed' | 'cancelled';

export function isOverdue(j: { status: JobStatus; responseDue: string | null }, today: string): boolean {
  return j.responseDue != null && j.status === 'delivered' && today > j.responseDue;
}

export function overdueText(dl: { certain: boolean }): string {
  return dl.certain
    ? 'The plan\'s deadline to answer has passed and no reply is on file. If a reply came, add it here. If not, Arik can help you follow up.'
    : 'The usual time for an answer has passed and no reply is on file. Has anything arrived? If not, Arik can help you follow up.';
}
