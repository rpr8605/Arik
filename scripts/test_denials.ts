// Denial engine (Phase 5): check functions, the reader on synthetic denial
// letters, the confirmation gate, the argument builder and the letter
// contract (every number, date and code from the record or a rule; the
// required footer; no clinical judgment). Rule dates: test_denial_rules.ts.
// Run: npx tsx scripts/test_denials.ts

import { parseDenialText } from '../lib/rules/denials/parse';
import { parseConfirmedDenial } from '../lib/rules/denials/confirm';
import { runDenialChecks, insurerLate, missingSpecificReason, priorAuthOnFile, administrativeDenial, selfFundedTrack, patientDeadlineFlag } from '../lib/rules/denials/checks';
import { buildArguments } from '../lib/rules/denials/arguments';
import { categoryFromCodes, CATEGORY_TEXT } from '../lib/rules/denials/codes';
import { buildDenialLetter, denialLetterOptions, denialLetterProblems, type DenialLetterInput } from '../lib/letters/denialTemplates';
import { joinBody } from '../lib/letters/templates';
import { detectDocType } from '../lib/production/layout';
import { makeDenial, formatDate } from '../lib/synth/model';
import { LETTER_FOOTER } from '../lib/production/types';
import { DENIAL_LETTER_TYPES, type ConfirmedDenial } from '../lib/rules/denials/types';
import type { CoverageRuleHit } from '../lib/data/coverage';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const TODAY = '2026-03-20';
const denial = (over: Partial<ConfirmedDenial> = {}): ConfirmedDenial => ({
  confirmedAt: '2026-03-10T00:00:00Z', payerName: 'Bluepine Health Plan', providerName: 'Dr. Ines Abernathy', planFunding: 'fully_insured', medicaidDelivery: 'unknown',
  category: 'medical_necessity', carcCodes: ['50'], rarcCodes: [], serviceOrDrug: 'MRI of the knee', serviceCode: '73721', isDrug: false,
  noticeDate: '2026-03-02', dateOfService: '2026-02-10', requestDate: null, appealLevel: 'initial', timing: 'post_service',
  isPriorAuthDecision: false, isUrgent: false, statedReason: 'The records do not show this was medically necessary.', claimNumber: 'CL-12-3456789',
  letterDeadlineDays: null, priorAuth: null, ...over,
});

// ---------- Codes ----------
check('codes: medical necessity code suggests that category', categoryFromCodes(['50']) === 'medical_necessity');
check('codes: an approval code wins over a paperwork code', categoryFromCodes(['16', '197']) === 'no_prior_authorization');
check('codes: unknown codes suggest nothing', categoryFromCodes(['999']) === null);
check('codes: every category has our own plain words', Object.values(CATEGORY_TEXT).every((c) => c.title && c.plain && !/CARC|X12/.test(c.plain)));

// ---------- Checks ----------
check('missing reason: flagged when the letter gives none, with the plan type\'s rule', missingSpecificReason(denial({ category: 'no_reason_given', statedReason: null }))?.citation?.cite.startsWith('29 CFR 2560.503-1(g)(1)(i)') === true);
check('missing reason: Part D cites its own notice rule', missingSpecificReason(denial({ planFunding: 'medicare_part_d', statedReason: '' }))?.citation?.cite.startsWith('42 CFR 423.568(g)(2)') === true);
check('missing reason: not flagged when a reason is given', missingSpecificReason(denial()) === null);
const lateFlag = insurerLate(denial({ requestDate: '2026-01-02', noticeDate: '2026-03-02' }));
check('insurer late: flagged as an ask with the limit and dates', lateFlag?.tone === 'ask' && lateFlag.limit?.amount === 30 && /If the plan got it/.test(lateFlag.plainText), lateFlag?.plainText);
check('insurer late: on time is not flagged', insurerLate(denial({ requestDate: '2026-02-20' })) === null);
check('insurer late: Medicaid plan appeal mentions going to a fair hearing', /fair hearing/.test(insurerLate(denial({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', appealLevel: 'internal_appeal', requestDate: '2026-01-02' }))?.plainText ?? ''));
const dueSoon = patientDeadlineFlag(denial({ planFunding: 'medicare_part_d', noticeDate: '2026-01-20' }), TODAY);
check('patient deadline: due within 14 days -> due_soon', dueSoon?.status === 'due_soon' && dueSoon.daysLeft === 6, `${dueSoon?.status} ${dueSoon?.daysLeft}`);
check('patient deadline: plenty of time -> ok', patientDeadlineFlag(denial(), TODAY)?.status === 'ok');
const overdue = patientDeadlineFlag(denial({ planFunding: 'medicare_part_d', noticeDate: '2025-12-01' }), TODAY);
check('patient deadline: past -> overdue, with the Medicare good-cause path', overdue?.status === 'overdue' && /good reason/.test(overdue.plainText));
check('patient deadline: on the due date itself, 0 days left, not overdue', patientDeadlineFlag(denial({ planFunding: 'medicare_part_d', noticeDate: '2026-01-14' }), TODAY)?.daysLeft === 0 && patientDeadlineFlag(denial({ planFunding: 'medicare_part_d', noticeDate: '2026-01-14' }), TODAY)?.status === 'due_soon');
check('patient deadline: unknown plan asks who pays', /who pays your claims/.test(patientDeadlineFlag(denial({ planFunding: 'unknown' }), TODAY)?.plainText ?? ''));
check('patient deadline: MA upheld says nothing to file', /do not need to file/.test(patientDeadlineFlag(denial({ planFunding: 'medicare_advantage', appealLevel: 'internal_appeal' }), TODAY)?.plainText ?? ''));
const pa = { reference: 'PA-77812', serviceCode: '73721', validFrom: '2026-02-01', validTo: '2026-04-30' };
check('prior auth on file: same service, date in range -> wrong', priorAuthOnFile(denial({ category: 'no_prior_authorization', priorAuth: pa }))?.tone === 'wrong');
check('prior auth on file: date outside the approval -> nothing', priorAuthOnFile(denial({ category: 'no_prior_authorization', priorAuth: pa, dateOfService: '2026-05-02' })) === null);
check('prior auth on file: a different service -> nothing', priorAuthOnFile(denial({ category: 'no_prior_authorization', priorAuth: { ...pa, serviceCode: '70551' } })) === null);
check('prior auth on file: edge dates count', priorAuthOnFile(denial({ category: 'no_prior_authorization', priorAuth: pa, dateOfService: '2026-04-30' })) !== null && priorAuthOnFile(denial({ category: 'no_prior_authorization', priorAuth: pa, dateOfService: '2026-02-01' })) !== null);
check('administrative: recommends a corrected claim from the provider', /corrected claim/.test(administrativeDenial(denial({ category: 'administrative' }))?.plainText ?? ''));
check('self-funded: claim file first, citing the free copies rule', selfFundedTrack(denial({ planFunding: 'self_funded' }))?.citation?.cite === '29 CFR 2560.503-1(h)(2)(iii)');
check('self-funded: not for an insured plan', selfFundedTrack(denial()) === null);
const clean = runDenialChecks(denial({ category: 'other', statedReason: 'Benefit limit reached.' }), TODAY);
check('no error found: routes to other ways to pay', clean.flags.some((f) => f.id === 'no_error_found'));
check('no error found: absent when a real problem was found', !runDenialChecks(denial({ category: 'no_reason_given', statedReason: null }), TODAY).flags.some((f) => f.id === 'no_error_found'));
check('external review: offered after a final internal denial', runDenialChecks(denial({ appealLevel: 'internal_appeal' }), TODAY).flags.some((f) => f.id === 'external_review'));
check('checks: the deadline comes first', runDenialChecks(denial(), TODAY).flags[0].id === 'patient_deadline');
check('checks: plain text has no rule names', runDenialChecks(denial({ planFunding: 'self_funded', category: 'no_reason_given', statedReason: null, requestDate: '2026-01-01' }), TODAY).flags.every((f) => !/CFR|§|ERISA/.test(f.plainText)));
check('checks: carry the rules version', runDenialChecks(denial(), TODAY).rulesVersion === 'ecfr-2026-10-15');

// ---------- Confirmation gate (B2) ----------
const draftLike = { ...denial(), confirmedAt: undefined };
check('confirm: a valid confirmation passes', 'denial' in parseConfirmedDenial(draftLike, new Date('2026-03-20T00:00:00Z')));
check('confirm: the date on the letter is required', 'error' in parseConfirmedDenial({ ...draftLike, noticeDate: null }));
check('confirm: a date in the future is refused', 'error' in parseConfirmedDenial({ ...draftLike, noticeDate: '2026-12-01' }, new Date('2026-03-20T00:00:00Z')));
check('confirm: a request after the letter is refused', 'error' in parseConfirmedDenial({ ...draftLike, requestDate: '2026-03-05' }, new Date('2026-03-20T00:00:00Z')));
check('confirm: an unknown plan type is refused, not coerced', 'error' in parseConfirmedDenial({ ...draftLike, planFunding: 'cadillac' }));
check('confirm: a code with words is refused (numbers only)', 'error' in parseConfirmedDenial({ ...draftLike, carcCodes: ['50 not medically necessary'] }));
const norm = parseConfirmedDenial({ ...draftLike, carcCodes: ['CO-050', 'PR-204'] }, new Date('2026-03-20T00:00:00Z'));
check('confirm: group prefixes and leading zeros are normalized', 'denial' in norm && norm.denial.carcCodes.join() === '50,204');
check('confirm: an approval with dates out of order is refused', 'error' in parseConfirmedDenial({ ...draftLike, priorAuth: { reference: 'A', serviceCode: null, validFrom: '2026-03-01', validTo: '2026-02-01' } }));
check('confirm: the only way checks get data is a confirmed copy (stamped confirmedAt)', 'denial' in parseConfirmedDenial(draftLike, new Date('2026-03-20T00:00:00Z')) && (parseConfirmedDenial(draftLike, new Date('2026-03-20T00:00:00Z')) as any).denial.confirmedAt === '2026-03-20T00:00:00.000Z');

// ---------- Reader on synthetic denial letters ----------
// The same text the generator draws (scripts/synth_docs/generate.ts), one
// row per line, as the layout parser joins rows.
function synthText(seed: number) {
  const d = makeDenial(seed);
  const lines = [d.insurer, formatDate(d.letterDate, 'MM/DD/YYYY'), `Dear ${d.memberName},`, `Claim number: ${d.claimNumber}    Date of service: ${formatDate(d.serviceDate, 'MM/DD/YYYY')}`, `We reviewed the request for: ${d.service} (code ${d.code}).`, 'Our decision: we are not able to approve this request.', ...(d.reason ? [`Reason: ${d.reason}`] : []), ...(d.carc ? [`Reason code: CO-${d.carc}`] : []), d.planLine, `You have the right to appeal. Your appeal must reach us within ${d.appealDays} days of the date of this letter.`, 'If we uphold our decision, you may ask for an independent external review.'];
  return { d, text: lines.join('\n') };
}
let readOk = 0;
const misses: string[] = [];
for (let seed = 1; seed <= 40; seed++) {
  const { d, text } = synthText(seed);
  const r = parseDenialText(text);
  const ok = detectDocType(text) === 'denial_letter' && r.noticeDate === d.letterDate && r.dateOfService === d.serviceDate && r.claimNumber === d.claimNumber && r.serviceCode === d.code && r.category === d.category && r.planFunding === d.planFunding && r.letterDeadlineDays === d.appealDays && r.carcCodes.join() === (d.carc ?? '') && r.appealLevel === 'initial' && r.isPriorAuthDecision;
  if (ok) readOk++;
  else misses.push(`${d.id}: ${JSON.stringify({ cat: [r.category, d.category], plan: [r.planFunding, d.planFunding], date: [r.noticeDate, d.letterDate], dos: [r.dateOfService, d.serviceDate], claim: [r.claimNumber, d.claimNumber], days: r.letterDeadlineDays })}`);
}
check('reader: 40 synthetic denial letters read correctly (dates, claim, code, category, plan, deadline, codes)', readOk === 40, misses.slice(0, 3).join(' | '));
const md = makeDenial(3);
check('reader: Medicaid health plan letters read as managed care', ((): boolean => { for (let s = 1; s <= 60; s++) { const x = synthText(s); if (x.d.planFunding === 'medicaid') return parseDenialText(x.text).medicaidDelivery === 'managed_care'; } return false; })());
void md;
const partD = parseDenialText('Northwind Medicare Rx\nNotice of Denial of Medicare Prescription Drug Coverage\nDate of notice: March 2, 2026\nDrug: Zolvanex 20 mg tablets\nWhy we denied your request: The drug is not on our formulary.\nYou can ask for a redetermination within 65 days.');
check('reader: a Part D notice (named-month date, drug) reads as Part D, drug, excluded', partD.planFunding === 'medicare_part_d' && partD.isDrug && partD.noticeDate === '2026-03-02' && partD.category === 'excluded_service' && partD.serviceOrDrug === 'Zolvanex 20 mg tablets', JSON.stringify(partD));
const upheld = parseDenialText('Lantern Mutual Health\n04/10/2026\nWe have reviewed your appeal and upheld our decision.\nReason: Not covered under your plan.\nYour plan is self-funded by your employer.');
check('reader: an appeal decision reads as internal_appeal, self-funded', upheld.appealLevel === 'internal_appeal' && upheld.planFunding === 'self_funded');
const noReason = parseDenialText('Bluefin Health Plan\n05/01/2026\nYour claim has been denied.\nYou can appeal this decision.');
check('reader: no reason line -> no_reason_given, plan unknown flagged as unsure', noReason.category === 'no_reason_given' && noReason.unsure.includes('planFunding'));
check('reader: "Date of service:" is never read as the service', parseDenialText('Claim number: CL-1-2345678    Date of service: 05/04/2026\nWe reviewed the request for: CT of the abdomen (code 74177).').serviceOrDrug === 'CT of the abdomen');
check('reader: codes in a remark list are numbers only', parseDenialText('Remark codes: N130, M127\nAdjustment reason codes: CO-45, PR 204').rarcCodes.join() === 'N130,M127' && parseDenialText('Remark codes: N130, M127\nAdjustment reason codes: CO-45, PR 204').carcCodes.sort().join() === '204,45');

// ---------- Arguments ----------
const hits: CoverageRuleHit[] = [{ docType: 'LCD', displayId: 'L33633', version: 7, title: 'MRI of the lower extremities', effectiveDate: '2025-01-01', contractors: [], excerpt: null, url: 'https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=33633', matchedBy: 'code' }];
const maD = denial({ planFunding: 'medicare_advantage' });
const maArgs = buildArguments(maD, runDenialChecks(maD, TODAY).flags, { coverageRules: hits, planDocumentOnFile: false });
check('arguments: Medicare Advantage cites the coverage rule listing the code', maArgs.some((a) => a.type === 'coverage_rule' && /L33633/.test(a.sentence) && /422\.101\(b\)/.test(a.sentence)));
check('arguments: a title-only coverage match is never cited', !buildArguments(maD, [], { coverageRules: [{ ...hits[0], matchedBy: 'title' }], planDocumentOnFile: false }).some((a) => a.type === 'coverage_rule'));
check('arguments: not cited for an employer plan', !buildArguments(denial(), [], { coverageRules: hits, planDocumentOnFile: false }).some((a) => a.type === 'coverage_rule'));
check('arguments: medical necessity points to the doctor\'s letter, no clinical judgment', buildArguments(denial(), [], { coverageRules: null, planDocumentOnFile: false }).some((a) => a.type === 'doctor_support' && /doctor for a letter/.test(a.sentence)));
const lateD = denial({ planFunding: 'medicare_part_d', appealLevel: 'internal_appeal', timing: 'pre_service', requestDate: '2026-02-01' });
check('arguments: a late Part D redetermination asks for forwarding to the IRE', buildArguments(lateD, runDenialChecks(lateD, TODAY).flags, { coverageRules: null, planDocumentOnFile: false }).some((a) => a.type === 'late_decision' && /423\.590\(c\)/.test(a.sentence)));

// ---------- Letters ----------
const fixtures: [string, ConfirmedDenial][] = [
  ['insured, medical necessity', denial()],
  ['self-funded, excluded', denial({ planFunding: 'self_funded', category: 'excluded_service', carcCodes: ['96'], statedReason: 'Not covered under your plan.' })],
  ['marketplace, no reason, late', denial({ planFunding: 'marketplace', category: 'no_reason_given', statedReason: null, carcCodes: [], requestDate: '2026-01-02' })],
  ['employer, final internal', denial({ appealLevel: 'internal_appeal' })],
  ['Part D, not on formulary, urgent', denial({ planFunding: 'medicare_part_d', category: 'excluded_service', isDrug: true, serviceOrDrug: 'Zolvanex 20 mg tablets', serviceCode: null, carcCodes: [], statedReason: 'The drug is not on our formulary.', isUrgent: true, timing: 'pre_service' })],
  ['MA, prior auth, approval on file', denial({ planFunding: 'medicare_advantage', category: 'no_prior_authorization', carcCodes: ['197'], statedReason: 'Approval was needed first.', priorAuth: pa, isPriorAuthDecision: true })],
  ['Medicaid plan, administrative', denial({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', category: 'administrative', carcCodes: ['16'], statedReason: 'Missing information.' })],
  ['unknown plan, no claim number', denial({ planFunding: 'unknown', claimNumber: null, providerName: null })],
];
let letters = 0;
for (const [name, d] of fixtures) {
  const flags = runDenialChecks(d, TODAY).flags;
  const types = denialLetterOptions(d, flags);
  for (const type of types) {
    const input: DenialLetterInput = { type, patient: { name: 'Rosa Fairbairn', phone: '555-0142' }, denial: d, flags, context: { coverageRules: d.planFunding === 'medicare_advantage' ? hits : null, planDocumentOnFile: false }, date: TODAY };
    const parts = buildDenialLetter(input);
    const letter = { subject: parts.subject, body: joinBody(parts), footer: LETTER_FOOTER };
    const probs = denialLetterProblems(letter, input);
    letters++;
    check(`letter ${type} (${name}) honors the contract`, probs.length === 0, probs.join('; '));
  }
}
check('letters: every type was written at least once', DENIAL_LETTER_TYPES.every((t) => fixtures.some(([, d]) => denialLetterOptions(d, runDenialChecks(d, TODAY).flags).includes(t))), `${letters} letters`);
{
  const d = denial();
  const flags = runDenialChecks(d, TODAY).flags;
  const input: DenialLetterInput = { type: 'insurer_appeal', patient: { name: 'Rosa Fairbairn', phone: null }, denial: d, flags, context: { coverageRules: null, planDocumentOnFile: false }, date: TODAY };
  const parts = buildDenialLetter(input);
  const body = joinBody(parts);
  check('guard: an invented date is caught', denialLetterProblems({ subject: parts.subject, body: body + '\n\nI was seen on 01/15/2026.', footer: LETTER_FOOTER }, input).some((p) => p.includes('01/15/2026')));
  check('guard: an invented dollar amount or count is caught', denialLetterProblems({ subject: parts.subject, body: body + '\n\nI paid $450.', footer: LETTER_FOOTER }, input).length > 0);
  check('guard: clinical judgment is caught', denialLetterProblems({ subject: parts.subject, body: body + '\n\nThis treatment is medically necessary.', footer: LETTER_FOOTER }, input).includes('clinical judgment'));
  check('guard: the plan\'s own quoted words may say "medically necessary"', !denialLetterProblems({ subject: parts.subject, body, footer: LETTER_FOOTER }, input).includes('clinical judgment'));
  check('guard: the footer must be exact', denialLetterProblems({ subject: parts.subject, body, footer: 'Prepared by Arik.' }, input).includes('footer is not the required text'));
  check('guard: legal threats are caught', denialLetterProblems({ subject: parts.subject, body: body + '\n\nI will sue.', footer: LETTER_FOOTER }, input).length > 0);
  check('footer: the required notice text', LETTER_FOOTER === 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.');
  const mn = buildDenialLetter({ ...input, type: 'medical_necessity_request' });
  check('medical necessity request: addressed to the doctor, asks for a letter in their own words and records', /Dr\. Ines Abernathy/.test(mn.greeting) && /in your own words/.test(joinBody(mn)) && /medical records/.test(joinBody(mn)));
  check('appeal: names the denial date, claim and codes', /03\/02\/2026/.test(body) && /CL-12-3456789/.test(parts.subject) && /codes listed are 50/.test(body));
  check('Part D appeal is a redetermination; MA a reconsideration', /redetermination/.test(buildDenialLetter({ ...input, denial: denial({ planFunding: 'medicare_part_d' }) }).subject) && /reconsideration/.test(buildDenialLetter({ ...input, denial: denial({ planFunding: 'medicare_advantage' }) }).subject));
  check('options: MA upheld offers no appeal letter (forwarded automatically)', !denialLetterOptions(denial({ planFunding: 'medicare_advantage', appealLevel: 'internal_appeal' }), []).includes('insurer_appeal'));
  check('options: self-funded starts with the claim file request', denialLetterOptions(denial({ planFunding: 'self_funded', category: 'excluded_service' }), [])[0] === 'claim_file_request');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
