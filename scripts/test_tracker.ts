// Tracker (lib/actions/tracker.ts): each response-deadline rule counted
// from the delivery date, letters with no verified rule getting none, and
// overdue detection at its edges.
// Run: npx tsx scripts/test_tracker.ts

import { isOverdue, overdueText, responseDeadline } from '../lib/actions/tracker';
import type { ConfirmedDenial } from '../lib/rules/denials/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const denial = (o: Partial<ConfirmedDenial> = {}): ConfirmedDenial => ({
  confirmedAt: '2026-03-10T00:00:00Z', payerName: 'Bluefin Health Plan', providerName: null, planFunding: 'fully_insured', medicaidDelivery: 'unknown', category: 'medical_necessity',
  carcCodes: [], rarcCodes: [], serviceOrDrug: 'MRI', serviceCode: null, isDrug: false, noticeDate: '2026-03-02', dateOfService: null, requestDate: null, appealLevel: 'initial',
  timing: 'post_service', isPriorAuthDecision: false, isUrgent: false, statedReason: 'x', claimNumber: null, letterDeadlineDays: null, priorAuth: null, ...o,
});
const D = '2026-04-01T15:30:00Z';
const rd = (o: Partial<ConfirmedDenial>, type: any = 'insurer_appeal') => responseDeadline(type, D, denial(o));

check('employer appeal, care already received: 60 days from delivery', rd({}).due === '2026-05-31' && rd({}).ruleId === 'erisa_appeal_decision' && rd({}).certain);
check('employer appeal, care not yet received: 30 days', rd({ timing: 'pre_service' }).due === '2026-05-01');
check('employer appeal, urgent: 72 hours -> 3 days', rd({ isUrgent: true }).due === '2026-04-04');
check('marketplace and self-funded use the same rule', rd({ planFunding: 'marketplace' }).due === '2026-05-31' && rd({ planFunding: 'self_funded' }).due === '2026-05-31');
check('Part D redetermination for a drug: 7 days', rd({ planFunding: 'medicare_part_d', timing: 'pre_service' }).due === '2026-04-08' && rd({ planFunding: 'medicare_part_d', timing: 'pre_service' }).ruleId === 'part_d_redetermination_decision');
check('Part D redetermination for payment: 14 days', rd({ planFunding: 'medicare_part_d', timing: 'payment' }).due === '2026-04-15');
check('Part D, expedited: 72 hours', rd({ planFunding: 'medicare_part_d', isUrgent: true }).due === '2026-04-04');
check('Part D independent review: the same limits (42 CFR 423.600(d))', rd({ planFunding: 'medicare_part_d', appealLevel: 'internal_appeal', timing: 'pre_service' }).due === '2026-04-08');
check('Medicare Advantage reconsideration of a service: 30 days, with the 14-day extension noted', rd({ planFunding: 'medicare_advantage', timing: 'pre_service' }).due === '2026-05-01' && /14 more days/.test(rd({ planFunding: 'medicare_advantage', timing: 'pre_service' }).text));
check('Medicare Advantage reconsideration of a payment: 60 days', rd({ planFunding: 'medicare_advantage' }).due === '2026-05-31');
check('Medicare Advantage Part B drug: 7 days', rd({ planFunding: 'medicare_advantage', isDrug: true }).due === '2026-04-08');
check('Medicaid plan appeal: 30 days', rd({ planFunding: 'medicaid', medicaidDelivery: 'managed_care' }).due === '2026-05-01');
check('Medicaid fair hearing request: no verified rule, no date', rd({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', appealLevel: 'internal_appeal' }).due === null);
check('state Medicaid: no date', rd({ planFunding: 'medicaid', medicaidDelivery: 'state' }).due === null);
check('unknown plan: no date', rd({ planFunding: 'unknown' }).due === null);
check('external review: 45 days, worded as not certain', rd({}, 'external_review_request').due === '2026-05-16' && !rd({}, 'external_review_request').certain);
check('external review, urgent: 72 hours', rd({ isUrgent: true }, 'external_review_request').due === '2026-04-04');
for (const t of ['billing_dispute', 'itemized_bill_request', 'hold_collections', 'financial_assistance_cover', 'medical_necessity_request', 'claim_file_request', 'specific_reason_request', 'part_d_exception']) {
  const r = responseDeadline(t as any, D, null);
  check(`${t}: no verified rule, no deadline, said plainly`, r.due === null && /no set deadline/.test(r.text));
}
check('an appeal with no denial on file: no deadline', responseDeadline('insurer_appeal', D, null).due === null);
check('delivery late in the day counts from that date', responseDeadline('insurer_appeal', '2026-04-01T23:59:00Z', denial({ timing: 'pre_service' })).due === '2026-05-01');
check('across a leap February', responseDeadline('insurer_appeal', '2028-02-10T12:00:00Z', denial({ timing: 'pre_service' })).due === '2028-03-11');
check('every dated deadline carries a citation', [rd({}), rd({ planFunding: 'medicare_part_d' }), rd({}, 'external_review_request')].every((r) => !!r.citation?.url));

check('overdue: the day after the due date, delivered, no reply', isOverdue({ status: 'delivered', responseDue: '2026-05-31' }, '2026-06-01'));
check('overdue: not on the due date itself', !isOverdue({ status: 'delivered', responseDue: '2026-05-31' }, '2026-05-31'));
check('overdue: never once a reply is on file', !isOverdue({ status: 'replied', responseDue: '2026-05-31' }, '2026-07-01'));
check('overdue: never without a deadline', !isOverdue({ status: 'delivered', responseDue: null }, '2030-01-01'));
check('overdue: never before delivery', !isOverdue({ status: 'sent', responseDue: '2026-05-31' }, '2026-07-01'));
check('overdue words: firm when certain, a question when not', /deadline to answer has passed/.test(overdueText({ certain: true })) && /Has anything arrived/.test(overdueText({ certain: false })));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
