// Replies (lib/actions/replies.ts): a synthetic reply for each
// classification is read correctly, the tricky wordings ("not approved",
// a collection notice that mentions a denial), and the next step proposed
// for each, which never sends anything by itself.
// Run: npx tsx scripts/test_replies.ts

import { classifyReply, proposeNextStep, REPLY_KINDS } from '../lib/actions/replies';
import { SYNTHETIC_REPLIES, SYNTHETIC_UNKNOWN } from '../lib/actions/syntheticReplies';
import type { ConfirmedDenial } from '../lib/rules/denials/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

for (const [kind, texts] of Object.entries(SYNTHETIC_REPLIES)) {
  texts.forEach((t, i) => {
    const r = classifyReply(t);
    check(`synthetic ${kind} #${i + 1} reads as ${kind}`, r.kind === kind && r.signals.length > 0, `${r.kind} ${r.signals.join(' | ')}`);
  });
}
check('synthetic unknown reads as unknown', classifyReply(SYNTHETIC_UNKNOWN).kind === 'unknown');
check('every classification has a synthetic reply', REPLY_KINDS.filter((k) => k !== 'unknown').every((k) => (SYNTHETIC_REPLIES as any)[k]?.length > 0));
check('"not approved" is a denial, not an approval', classifyReply('Your request was not approved.').kind === 'denied_again');
check('"unable to approve" is a denial', classifyReply('We are unable to approve this service.').kind === 'denied_again');
check('a collection notice that mentions the denial is still a collection notice', classifyReply('Your claim was denied by your insurer and the balance has been placed with a collection agency.').kind === 'collections_notice');
check('a corrected bill mentioning an approval is a corrected bill', classifyReply('Your plan approved part of the claim. We have adjusted the balance on a revised statement.').kind === 'corrected_bill');
check('a request for information beats a denial mention', classifyReply('We cannot decide your appeal until we receive your records. Please send copies of the visit notes.').kind === 'info_requested');
check('whitespace and line breaks do not matter', classifyReply('We have\n   overturned   our\ndecision.').kind === 'approved');

const denial = (o: Partial<ConfirmedDenial>): ConfirmedDenial => ({
  confirmedAt: '2026-03-10T00:00:00Z', payerName: 'Bluefin Health Plan', providerName: null, planFunding: 'fully_insured', medicaidDelivery: 'unknown', category: 'medical_necessity',
  carcCodes: [], rarcCodes: [], serviceOrDrug: 'MRI', serviceCode: null, isDrug: false, noticeDate: '2026-03-02', dateOfService: null, requestDate: null, appealLevel: 'initial',
  timing: 'post_service', isPriorAuthDecision: false, isUrgent: false, statedReason: 'x', claimNumber: null, letterDeadlineDays: null, priorAuth: null, ...o,
});
const appeal = (d: ConfirmedDenial | null) => ({ letterType: 'insurer_appeal' as const, denial: d });
check('approved -> record the win, no letter', proposeNextStep('approved', appeal(denial({}))).step === 'record_outcome' && proposeNextStep('approved', appeal(denial({}))).letterType === null);
check('denied again, employer plan -> external review letter', proposeNextStep('denied_again', appeal(denial({}))).letterType === 'external_review_request');
check('denied again, Medicare Advantage -> wait for the reviewer, nothing to send', proposeNextStep('denied_again', appeal(denial({ planFunding: 'medicare_advantage' }))).step === 'wait_for_reviewer');
check('denied again, Part D -> the independent review entity', /independent review entity/.test(proposeNextStep('denied_again', appeal(denial({ planFunding: 'medicare_part_d' }))).title));
check('denied again, Medicaid -> State fair hearing', /fair hearing/.test(proposeNextStep('denied_again', appeal(denial({ planFunding: 'medicaid' }))).title));
check('denied again on a bill -> a follow-up dispute', proposeNextStep('denied_again', { letterType: 'billing_dispute', denial: null }).letterType === 'billing_dispute');
check('info requested, medical records -> request to the doctor', proposeNextStep('info_requested', appeal(denial({})), SYNTHETIC_REPLIES.info_requested[0]).letterType === 'medical_necessity_request');
check('info requested, other items -> gather and reply', proposeNextStep('info_requested', appeal(denial({})), SYNTHETIC_REPLIES.info_requested[1]).step === 'reply_with_information');
check('collections notice -> hold collections letter', proposeNextStep('collections_notice', { letterType: 'billing_dispute', denial: null }).letterType === 'hold_collections');
check('corrected bill -> check the new bill', proposeNextStep('corrected_bill', { letterType: 'billing_dispute', denial: null }).step === 'review_new_bill');
check('unknown -> the patient says what it is', proposeNextStep('unknown', appeal(null)).step === 'read_it_yourself');
check('no proposal sends anything: each is at most a letter to draft', REPLY_KINDS.every((k) => ['record_outcome', 'draft_letter', 'review_new_bill', 'reply_with_information', 'wait_for_reviewer', 'read_it_yourself'].includes(proposeNextStep(k, appeal(denial({}))).step)));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
