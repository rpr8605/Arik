// Denial rules (lib/rules/denials/rules.ts): date math edge cases (month
// ends, leap years), each patient deadline per plan type, each decision
// limit, and the registry matching db/041's `rules` seed. Rule text:
// docs/research/denial_rules_verification.md.
// Run: npx tsx scripts/test_denial_rules.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DENIAL_RULES, DENIAL_RULES_VERSION, addDays, addMonthsRule, daysBetween, decidedLate, decisionLimit, patientDeadline } from '../lib/rules/denials/rules';
import type { ConfirmedDenial } from '../lib/rules/denials/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const denial = (over: Partial<ConfirmedDenial> = {}): ConfirmedDenial => ({
  confirmedAt: '2026-10-01T00:00:00Z', payerName: 'Bluepine Health Plan', providerName: null, planFunding: 'fully_insured', medicaidDelivery: 'unknown',
  category: 'medical_necessity', carcCodes: ['50'], rarcCodes: [], serviceOrDrug: 'MRI of the knee', serviceCode: '73721', isDrug: false,
  noticeDate: '2026-03-02', dateOfService: '2026-02-10', requestDate: null, appealLevel: 'initial', timing: 'post_service',
  isPriorAuthDecision: false, isUrgent: false, statedReason: 'The records do not show this was medically necessary.', claimNumber: 'CL-12-3456789',
  letterDeadlineDays: null, priorAuth: null, ...over,
});

// ---------- Date math ----------
check('addDays: across a month end', addDays('2026-01-31', 1) === '2026-02-01');
check('addDays: across a leap day', addDays('2028-02-28', 1) === '2028-02-29' && addDays('2028-02-29', 1) === '2028-03-01');
check('addDays: non-leap February', addDays('2026-02-28', 1) === '2026-03-01');
check('addDays: across a year end', addDays('2026-12-31', 1) === '2027-01-01');
check('addDays: 180 days', addDays('2026-03-02', 180) === '2026-08-29');
check('daysBetween: leap year February', daysBetween('2028-02-01', '2028-03-01') === 29 && daysBetween('2026-02-01', '2026-03-01') === 28);
check('four months: the rule\'s own example (October 30 -> March 1)', addMonthsRule('2026-10-30', 4) === '2027-03-01');
check('four months: October 31 -> March 1', addMonthsRule('2026-10-31', 4) === '2027-03-01');
check('four months: October 29 -> March 1 in a non-leap year', addMonthsRule('2026-10-29', 4) === '2027-03-01');
check('four months: October 29 -> February 29 in a leap year', addMonthsRule('2027-10-29', 4) === '2028-02-29');
check('four months: an ordinary day', addMonthsRule('2026-03-15', 4) === '2026-07-15');
check('four months: across a year end', addMonthsRule('2026-11-30', 4) === '2027-03-30');
check('four months: June 30 -> October 30', addMonthsRule('2026-06-30', 4) === '2026-10-30');

// ---------- Patient deadlines ----------
const dl = (o: Partial<ConfirmedDenial>) => patientDeadline(denial(o));
check('employer insured: internal appeal 180 days from the notice date', dl({})!.due === '2026-08-29' && dl({})!.ruleId === 'aca_internal_appeal_window');
check('self-funded: same 180 days', dl({ planFunding: 'self_funded' })!.due === '2026-08-29');
check('marketplace: same 180 days', dl({ planFunding: 'marketplace' })!.due === '2026-08-29');
check('final internal denial: external review in four months', dl({ appealLevel: 'internal_appeal' })!.due === '2026-07-02' && dl({ appealLevel: 'internal_appeal' })!.step === 'external_review');
check('external review from October 30: March 1', dl({ appealLevel: 'internal_appeal', noticeDate: '2026-10-30' })!.due === '2027-03-01');
check('Part D redetermination: 5 presumed days + 60 = 65 days', dl({ planFunding: 'medicare_part_d' })!.due === addDays('2026-03-02', 65) && dl({ planFunding: 'medicare_part_d' })!.step === 'part_d_redetermination');
check('Part D independent review: 65 days from the redetermination', dl({ planFunding: 'medicare_part_d', appealLevel: 'internal_appeal' })!.step === 'part_d_ire' && dl({ planFunding: 'medicare_part_d', appealLevel: 'internal_appeal' })!.due === '2026-05-06');
check('Part D across a leap February: 2028-01-15 + 65 = 2028-03-20', dl({ planFunding: 'medicare_part_d', noticeDate: '2028-01-15' })!.due === '2028-03-20');
check('Medicare Advantage reconsideration: 65 days', dl({ planFunding: 'medicare_advantage' })!.due === '2026-05-06' && dl({ planFunding: 'medicare_advantage' })!.step === 'ma_reconsideration');
check('Medicare Advantage upheld: no patient deadline (forwarded automatically)', dl({ planFunding: 'medicare_advantage', appealLevel: 'internal_appeal' }) === null);
check('Medicaid managed care: plan appeal 60 days from the notice date', dl({ planFunding: 'medicaid', medicaidDelivery: 'managed_care' })!.due === '2026-05-01');
check('Medicaid managed care upheld: fair hearing at the earliest allowed, 90 days', dl({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', appealLevel: 'internal_appeal' })!.due === '2026-05-31' && /120/.test(dl({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', appealLevel: 'internal_appeal' })!.note ?? ''));
check('state Medicaid: no computed date (the state sets it)', dl({ planFunding: 'medicaid', medicaidDelivery: 'state' })!.due === null);
check('Medicaid, delivery unknown: no computed date, both cases explained', dl({ planFunding: 'medicaid' })!.due === null && /60 days/.test(dl({ planFunding: 'medicaid' })!.note ?? ''));
check('unknown plan: no deadline guessed', dl({ planFunding: 'unknown' }) === null);
check('a letter giving fewer days than the rule wins (earlier date)', dl({ letterDeadlineDays: 60 })!.due === '2026-05-01' && /earlier date/.test(dl({ letterDeadlineDays: 60 })!.note ?? ''));
check('a letter giving more days than the rule does not move the date later', dl({ planFunding: 'medicare_part_d', letterDeadlineDays: 90 })!.due === '2026-05-06');
check('the letter\'s days fill in when the rule has no date', dl({ planFunding: 'medicaid', medicaidDelivery: 'state', letterDeadlineDays: 30 })!.due === '2026-04-01');
check('every deadline carries a citation with a URL', ['fully_insured', 'medicare_part_d', 'medicare_advantage', 'medicaid'].every((f) => !!dl({ planFunding: f as any, medicaidDelivery: 'managed_care' })?.citation.url.startsWith('https://www.ecfr.gov/')));

// ---------- Decision limits ----------
const lim = (o: Partial<ConfirmedDenial>) => decisionLimit(denial({ requestDate: '2026-02-01', ...o }));
check('no request date: no limit checked', decisionLimit(denial()) === null);
check('employer post-service first decision: 30 days', lim({})!.amount === 30 && lim({})!.unit === 'days');
check('employer pre-service first decision: 15 days', lim({ timing: 'pre_service' })!.amount === 15);
check('employer urgent: 72 hours', lim({ isUrgent: true })!.amount === 72 && lim({ isUrgent: true })!.unit === 'hours');
check('employer appeal, pre-service: 30 days', lim({ appealLevel: 'internal_appeal', timing: 'pre_service' })!.amount === 30);
check('employer appeal, post-service: 60 days', lim({ appealLevel: 'internal_appeal' })!.amount === 60);
check('Part D coverage decision for a drug: 72 hours', lim({ planFunding: 'medicare_part_d', timing: 'pre_service' })!.amount === 72);
check('Part D coverage decision, expedited: 24 hours', lim({ planFunding: 'medicare_part_d', isUrgent: true })!.amount === 24);
check('Part D payment request: 14 days', lim({ planFunding: 'medicare_part_d', timing: 'payment' })!.amount === 14);
check('Part D redetermination: 7 days', lim({ planFunding: 'medicare_part_d', appealLevel: 'internal_appeal', timing: 'pre_service' })!.amount === 7);
check('Part D redetermination for payment: 14 days', lim({ planFunding: 'medicare_part_d', appealLevel: 'internal_appeal', timing: 'payment' })!.amount === 14);
check('MA prior authorization from 2026: 7 days', lim({ planFunding: 'medicare_advantage', timing: 'pre_service', isPriorAuthDecision: true })!.amount === 7);
check('MA prior authorization requested in 2025: 14 days', lim({ planFunding: 'medicare_advantage', timing: 'pre_service', isPriorAuthDecision: true, requestDate: '2025-12-20', noticeDate: '2026-01-10' })!.amount === 14);
check('MA reconsideration of a service: 30 days', lim({ planFunding: 'medicare_advantage', appealLevel: 'internal_appeal', timing: 'pre_service' })!.amount === 30);
check('MA reconsideration of a payment: 60 days', lim({ planFunding: 'medicare_advantage', appealLevel: 'internal_appeal' })!.amount === 60);
check('MA reconsideration of a Part B drug: 7 days', lim({ planFunding: 'medicare_advantage', appealLevel: 'internal_appeal', isDrug: true })!.amount === 7);
check('Medicaid plan appeal: 30 days', lim({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', appealLevel: 'internal_appeal' })!.amount === 30);
check('Medicaid authorization in 2026: 14 days (rating period may predate 2026)', lim({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', timing: 'pre_service' })!.amount === 14);
check('Medicaid authorization from 2027: 7 days', lim({ planFunding: 'medicaid', medicaidDelivery: 'managed_care', timing: 'pre_service', requestDate: '2027-02-01', noticeDate: '2027-02-20' })!.amount === 7);
check('state Medicaid: no limit checked', lim({ planFunding: 'medicaid', medicaidDelivery: 'state' }) === null);

// Late or not, at the edge.
const late = (o: Partial<ConfirmedDenial>) => { const d = denial(o); const l = decisionLimit(d); return !!l && decidedLate(d, l); };
check('30-day limit: day 30 is on time', !late({ requestDate: '2026-02-01', noticeDate: '2026-03-03' }));
check('30-day limit: day 31 may be late', late({ requestDate: '2026-02-01', noticeDate: '2026-03-04' }));
check('72 hours: dated 3 days later is on time', !late({ isUrgent: true, requestDate: '2026-02-01', noticeDate: '2026-02-04' }));
check('72 hours: dated 4 days later may be late', late({ isUrgent: true, requestDate: '2026-02-01', noticeDate: '2026-02-05' }));
check('24 hours: dated the next day is on time', !late({ planFunding: 'medicare_part_d', isUrgent: true, requestDate: '2026-02-01', noticeDate: '2026-02-02' }));
check('24 hours: dated two days later may be late', late({ planFunding: 'medicare_part_d', isUrgent: true, requestDate: '2026-02-01', noticeDate: '2026-02-03' }));
check('a leap-year February counts 29 days', late({ timing: 'pre_service', requestDate: '2028-02-10', noticeDate: '2028-02-26' }) && !late({ timing: 'pre_service', requestDate: '2028-02-14', noticeDate: '2028-02-29' }));

// ---------- Registry ----------
check('every rule has a citation, a URL and plan types', DENIAL_RULES.every((r) => r.citation.cite && r.citation.url.startsWith('https://www.ecfr.gov/current/') && r.planFunding.length > 0));
check('rule ids are unique', new Set(DENIAL_RULES.map((r) => r.id)).size === DENIAL_RULES.length);
const sql = readFileSync(join(__dirname, '..', 'db', '041_denial_engine.sql'), 'utf8');
const seeded = [...sql.matchAll(/\('([a-z_]+)', '(ecfr-[0-9-]+)', '\{([a-z_,]+)\}', '((?:[^']|'')*)', '((?:[^']|'')*)', '([^']+)'/g)].map((m) => ({ id: m[1], version: m[2], funding: m[3].split(','), description: m[4].replace(/''/g, "'"), cite: m[5], url: m[6] }));
check('db/041 seeds every rule in the registry, and nothing else', seeded.length === DENIAL_RULES.length && DENIAL_RULES.every((r) => seeded.some((s) => s.id === r.id)), `${seeded.length} seeded vs ${DENIAL_RULES.length}`);
const mismatch = DENIAL_RULES.filter((r) => { const s = seeded.find((x) => x.id === r.id); return !s || s.version !== DENIAL_RULES_VERSION || s.description !== r.description || s.cite !== r.citation.cite || s.url !== r.citation.url || s.funding.join() !== r.planFunding.join(); });
check('db/041 rows match the code (version, text, citation, plan types)', mismatch.length === 0, mismatch.map((r) => r.id).join(', '));
const codeSeeds = [...sql.matchAll(/\('CARC', '(\d+)', '((?:[^']|'')*)'\)/g)];
const codeInsert = sql.slice(sql.indexOf('insert into denial_codes'));
check('code explanations are seeded as needs_review only (default), never approved', codeSeeds.length > 0 && !/approved'/.test(codeInsert.replace("where denial_codes.explanation_status = 'needs_review'", '')) && /where denial_codes\.explanation_status = 'needs_review'/.test(codeInsert));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
