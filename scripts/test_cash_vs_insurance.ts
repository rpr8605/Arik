// Cash vs insurance + "At the counter" card (docs/kimi/PLAN_CASH_VS_INSURANCE.md):
// the rule for each coverage type, EN/ES text for every code, the counter
// card's sourcing rules, the guard's Medicaid cash check, and the ranking
// changes (no drug-maker program for government coverage until confirmed;
// a list price is never the best path). Pure, no network.
// Run: npx tsx scripts/test_cash_vs_insurance.ts

import { coverageFrom, decideCashVsInsurance, decisionText, STRINGS, type CashVsInsuranceInput } from '../lib/rules/cashVsInsurance';
import { buildCounterCard, cashDecisionNote, decisionForPath, isCounterPath } from '../lib/counterCard';
import { buildAllowedFacts, findUnmatchedClaims } from '../lib/groundingGuard';
import { rankPathways } from '../lib/ranking';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}
const d = (i: Partial<CashVsInsuranceInput>) => decideCashVsInsurance({ coverage: 'unknown', cashPriceUsd: 20, isManufacturerProgram: false, ...i });

// --- Coverage mapping ---
check('coverage mapping', coverageFrom('employer') === 'commercial' && coverageFrom('marketplace') === 'commercial' && coverageFrom('medicare_part_d') === 'medicare' && coverageFrom('medicare') === 'medicare' && coverageFrom('medicaid') === 'medicaid' && coverageFrom(null) === 'unknown');

// --- Medicaid: never cash for a covered drug ---
for (const cash of [1, 5, 500]) {
  const r = d({ coverage: 'medicaid', cashPriceUsd: cash, planCostUsd: 4, drugCoveredByPlan: 'yes' });
  check(`Medicaid covered drug, cash $${cash}: use insurance, never cash`, r.decision === 'use_insurance' && r.reason === 'medicaid_bill_medicaid_first');
}
check('Medicaid line is the softer one and marked pending (42 CFR text does not clearly support the strong line)', d({ coverage: 'medicaid', drugCoveredByPlan: 'yes' }).pending && /bill Medicaid first/.test(decisionText(d({ coverage: 'medicaid', drugCoveredByPlan: 'yes' }), 'en')));
check('Medicaid, coverage of the drug unknown: ask, never cash', d({ coverage: 'medicaid' }).decision === 'ask_patient' && d({ coverage: 'medicaid' }).questions.includes('ask_medicaid_covers'));
check('Medicaid, drug not covered: ask to confirm the denial, never cash', d({ coverage: 'medicaid', drugCoveredByPlan: 'no' }).decision === 'ask_patient');
check('Medicaid + drug maker program not confirmed: not offered', d({ coverage: 'medicaid', isManufacturerProgram: true }).decision === 'not_for_this_coverage');
check('no Medicaid input ever returns use_cash', (['yes', 'no', 'unknown'] as const).every((c) => d({ coverage: 'medicaid', drugCoveredByPlan: c, cashPriceUsd: 0.5, planCostUsd: 8 }).decision !== 'use_cash'));

// --- Medicare ---
check('Medicare + drug maker program, federal allowed unknown: not offered', d({ coverage: 'medicare', isManufacturerProgram: true }).decision === 'not_for_this_coverage');
check('Medicare + drug maker program allowed, cash cheaper: cash with the Part D limit caveat', (() => {
  const r = d({ coverage: 'medicare', isManufacturerProgram: true, federalProgramAllowed: 'yes', cashPriceUsd: 10, planCostUsd: 40 });
  return r.decision === 'use_cash' && r.caveats.includes('medicare_cash_not_counted');
})());
check('Medicare, plan cost unknown: ask the copay, caveat already shown', (() => {
  const r = d({ coverage: 'medicare', cashPriceUsd: 10 });
  return r.decision === 'ask_patient' && r.questions.includes('ask_copay') && r.caveats.includes('medicare_cash_not_counted');
})());
check('Medicare, plan cheaper: use insurance', d({ coverage: 'medicare', cashPriceUsd: 50, planCostUsd: 11 }).decision === 'use_insurance');

// --- Commercial ---
check('commercial, plan cost unknown: ask copay and deductible, with the deductible caveat', (() => {
  const r = d({ coverage: 'commercial', cashPriceUsd: 20 });
  return r.decision === 'ask_patient' && r.reason === 'need_plan_cost' && r.questions.join() === 'ask_copay,ask_deductible' && r.caveats.includes('may_not_count_toward_deductible');
})());
check('commercial, deductible status unknown: ask it', d({ coverage: 'commercial', cashPriceUsd: 20, planCostUsd: 60 }).reason === 'need_deductible_status');
check('commercial, cash cheaper, counting unknown: cash + "may not count" caveat + deductible note', (() => {
  const r = d({ coverage: 'commercial', cashPriceUsd: 20, planCostUsd: 60, deductibleMet: 'no' });
  return r.decision === 'use_cash' && r.caveats.join() === 'may_not_count_toward_deductible,deductible_not_met_oop';
})());
check('commercial, program says it counts: the "counts" caveat instead', d({ coverage: 'commercial', cashPriceUsd: 20, planCostUsd: 60, deductibleMet: 'yes', countsTowardDeductible: 'yes' }).caveats.join() === 'counts_toward_deductible');
check('commercial, plan cheaper: use insurance', d({ coverage: 'commercial', cashPriceUsd: 60, planCostUsd: 20, deductibleMet: 'yes' }).decision === 'use_insurance');

// --- Uninsured and unknown ---
check('uninsured: cheapest sourced, no insurance caveats', (() => {
  const r = d({ coverage: 'uninsured', cashPriceUsd: 20 });
  return r.decision === 'use_cash' && r.caveats.length === 0;
})());
check('uninsured, no cash price: ask, never a guessed number', d({ coverage: 'uninsured', cashPriceUsd: null }).decision === 'ask_patient');
check('unknown coverage: ask what coverage', d({ coverage: 'unknown' }).questions.join() === 'ask_coverage');

// --- Words ---
const groups = [STRINGS.reason, STRINGS.caveat, STRINGS.question] as Record<string, Record<'en' | 'es', string>>[];
check('every reason, caveat and question has English and Spanish', groups.every((g) => Object.values(g).every((v) => v.en.trim() && v.es.trim())));
check('no em dashes anywhere in the words', !JSON.stringify(STRINGS).includes('—'));
check('no word ever says "your price" for a benchmark or promises a result', !/guarantee|will save|you will pay/i.test(JSON.stringify(STRINGS)));

// --- Counter card ---
const cashPath = { kind: 'price_point', title: 'cash price at Fixture Pharmacy', monthlyCostUsd: 12, source: { title: 'Fixture source', url: 'https://example.test/p', last_verified_at: '2026-10-15' }, pharmacy: { name: 'Fixture Pharmacy', distanceMiles: 1.2 } };
const cardPath = { kind: 'discount_card', title: 'Fixture Discount Card', monthlyCostUsd: 9, source: { title: 'Card page', url: 'https://example.test/card', last_verified_at: '2026-10-14' } };
const dtpPath = { kind: 'direct_to_patient_program', title: 'Maker Direct', monthlyCostUsd: 345, source: null };
check('counter card only for cash and discount-card paths', isCounterPath(cashPath) && isCounterPath(cardPath) && !isCounterPath(dtpPath) && !isCounterPath({ kind: 'price_point', title: 'list price', monthlyCostUsd: 521 }));
const unsourced = buildCounterCard({ path: cardPath, program: { card_bin: '123456', card_pcn: 'X' }, decision: decisionForPath(cardPath, null, 'uninsured'), lang: 'en' })!;
check('card numbers without a source are never shown; the card says where to get them', unsourced.cardLines.length === 0 && unsourced.getNumbers?.url === 'https://example.test/card');
const sourced = buildCounterCard({ path: cardPath, program: { card_bin: '123456', card_pcn: 'ABC', card_group: 'G1', card_details_source_url: 'https://example.test/card' }, decision: decisionForPath(cardPath, null, 'uninsured'), lang: 'en' })!;
check('sourced card numbers shown exactly', sourced.cardLines.join('|') === 'BIN: 123456|PCN: ABC|Group: G1' && sourced.getNumbers === null);
const cashCard = buildCounterCard({ path: cashPath, program: null, decision: decisionForPath(cashPath, null, 'employer'), lang: 'en' })!;
check('cash card: the words to say, the pharmacy, the date and source, the deductible caveat', /run it as cash, not through my insurance/.test(cashCard.say) && cashCard.where === 'This price is for Fixture Pharmacy.' && cashCard.when === 'Price checked 2026-10-15 by Fixture source.' && cashCard.caveats.some((c) => /may not count toward your deductible/.test(c)));
const es = buildCounterCard({ path: cashPath, program: null, decision: decisionForPath(cashPath, null, 'employer'), lang: 'es' })!;
check('Spanish card has the same fields', es.heading === 'En el mostrador' && /en efectivo/.test(es.say) && es.caveats.length === cashCard.caveats.length && /Precio revisado el 2026-10-15/.test(es.when));
check('no counter card for a Medicaid patient (use insurance)', buildCounterCard({ path: cashPath, program: null, decision: decisionForPath(cashPath, null, 'medicaid'), lang: 'en' }) === null);
check('chat note: Medicaid gets the bill-Medicaid-first line and no counter card', (() => {
  const n = cashDecisionNote({ best: cashPath, program: null, insuranceType: 'medicaid', lang: 'en' });
  return /bill Medicaid first/.test(n) && !/At the counter/.test(n);
})());
check('chat note: nothing for a non-cash best path', cashDecisionNote({ best: { kind: 'pap', title: 'Foundation', monthlyCostUsd: null }, program: null, insuranceType: 'uninsured', lang: 'en' }) === '');

// --- Grounding guard rule 6 ---
const medicaidFacts = buildAllowedFacts({ retrievedContext: { price: 20 }, profile: null, coverage: 'medicaid' });
for (const bad of ['You could pay cash for it at $20.', 'It may be cheaper to pay the cash price.', 'Go with paying out-of-pocket here.']) {
  check(`guard rejects cash advice to a Medicaid patient: "${bad}"`, findUnmatchedClaims(bad, medicaidFacts).some((x) => x.startsWith('cash advice')));
}
const uninsuredFacts = buildAllowedFacts({ retrievedContext: { price: 20 }, profile: null, coverage: 'uninsured' });
check('the same sentence is fine for an uninsured patient', !findUnmatchedClaims('You could pay cash for it at $20.', uninsuredFacts).some((x) => x.startsWith('cash advice')));

// --- Ranking ---
const dtp = { exploit_type: 'direct_to_patient_program', title: 'DTP', status: 'active', verification_status: 'verified_current', patient_price_type: 'flat', patient_price_floor: 345, eligibility_criteria: { insurance_required: false } };
const list = { price_type: 'list', price_usd: 521, supply_days: 30 };
const rose = rankPathways({ exploits: [dtp], pricePoints: [list, { price_type: 'direct_to_patient', price_usd: 345, supply_days: 30 }], stateRow: null, banApplies: false, patient: { insuranceType: 'medicare', stateCode: 'FL' } });
check('Medicare: a drug maker program not confirmed for federal programs is held as pending', rose.pendingVerification.some((p) => p.title === 'DTP' && /Medicare or Medicaid/.test(p.reason)) && !rose.ranked.some((p) => p.title === 'DTP'));
check('Medicare: a direct-to-patient price row is not a path either', !rose.ranked.some((p) => /direct to patient/.test(p.title)));
check('a list price is shown but never the best path', rose.ranked.some((p) => p.title === 'list price' && p.reference) && rose.winner === null);
const allowed = rankPathways({ exploits: [{ ...dtp, federal_program_allowed: 'yes' }], pricePoints: [], stateRow: null, banApplies: false, patient: { insuranceType: 'medicare', stateCode: 'FL' } });
check('Medicare: offered once the program is confirmed (federal_program_allowed = yes)', allowed.winner?.title === 'DTP');
const maria = rankPathways({ exploits: [dtp], pricePoints: [list], stateRow: null, banApplies: false, patient: { insuranceType: 'uninsured', stateCode: 'TX' } });
check('uninsured: the program still wins, list price still not the winner', maria.winner?.title === 'DTP');

console.log(failures === 0 ? '\nCASH VS INSURANCE: ALL PASS' : `\nCASH VS INSURANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
