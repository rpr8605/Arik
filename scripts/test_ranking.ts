// Pure tests for lib/ranking.ts. Run: npx tsx scripts/test_ranking.ts
import { rankPathways } from '../lib/ranking';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const card = (over: any = {}) => ({
  exploit_type: 'copay_card', title: 'Card', status: 'active',
  verification_status: 'verified_current', patient_price_type: 'as_low_as', patient_price_floor: 10,
  annual_max_savings: 2000, eligibility_criteria: { requires: 'commercial_insurance', excludes_government_programs: true },
  ...over,
});
const pap = (over: any = {}) => ({
  exploit_type: 'pap', title: 'PAP', status: 'active',
  verification_status: 'verified_current', patient_price_type: 'flat', patient_price_floor: 0,
  eligibility_criteria: { requires: 'financial_need', income_max_usd: 100000 }, ...over,
});
const dtp = { exploit_type: 'direct_to_patient_program', title: 'DTP', status: 'active', verification_status: 'verified_current', patient_price_type: 'flat', patient_price_floor: 345, eligibility_criteria: { requires: 'cash_pay', insurance_required: false } };
const conflictedCard = card({ title: 'Conflicted Card', verification_status: 'conflicted', annual_max_savings: null });
const trial = { exploit_type: 'free_trial', title: 'Trial', status: 'active', verification_status: 'verified_current', patient_price_type: 'flat', patient_price_floor: 0, eligibility_criteria: { new_patient: true, one_time: true } };
const pricePts = [{ price_type: 'list', price_usd: 521, supply_days: 30, sources: { title: 's', url: 'u', last_verified_at: null } }];

const IA = { state_code: 'IA', ban_type: 'outright', verification_status: 'primary_source_verified', notes: 'SF 383' };
const CA = { state_code: 'CA', ban_type: 'none', verification_status: 'primary_source_verified', notes: 'no law' };
const TX = { state_code: 'TX', ban_type: 'no_generic_only', verification_status: 'secondary_aggregated', notes: 'unverified' };
const NV = { state_code: 'NV', ban_type: 'regulatory_guidance', verification_status: 'unknown', notes: 'guidance' };

const commercial = { insuranceType: 'employer', stateCode: 'IA' };

// 1. AKS integration: Medicare patient never sees the card ranked; it's blocked.
let r = rankPathways({ exploits: [card(), pap()], pricePoints: [], stateRow: IA, banApplies: true, patient: { insuranceType: 'medicare_part_d', stateCode: 'IA' } });
check('medicare: card blocked, not ranked', r.blocked.length === 1 && !r.ranked.some((p) => p.title === 'Card'));
check('medicare: block reason names the law', /Anti-Kickback/.test(r.blocked[0].reason));
check('medicare: PAP ranks', r.ranked.some((p) => p.title === 'PAP'));

// 2. Conflicted rows never rank with a number.
r = rankPathways({ exploits: [conflictedCard, dtp], pricePoints: [], stateRow: IA, banApplies: true, patient: commercial });
check('conflicted card excluded from ranked', !r.ranked.some((p) => p.title === 'Conflicted Card'));
check('conflicted card appears in pendingVerification with no number', r.pendingVerification.some((p) => p.title === 'Conflicted Card' && /conflict/i.test(p.reason)));

// 3. Winner is by TRAJECTORY (12-month), not point-in-time: the one-time $0
// trial must not beat the $345/mo DTP as the long-term winner.
r = rankPathways({ exploits: [trial, dtp], pricePoints: [], stateRow: IA, banApplies: true, patient: { insuranceType: 'uninsured', stateCode: 'IA' } });
check('winner is the DTP (trajectory), not the one-time trial', r.winner?.title === 'DTP', String(r.winner?.title));
check('trial flagged one-time bridge', r.ranked.find((p) => p.title === 'Trial')?.oneTime === true);

// 4. State pairing rule.
r = rankPathways({ exploits: [card()], pricePoints: pricePts, stateRow: TX, banApplies: true, patient: { insuranceType: 'employer', stateCode: 'TX' } });
check('secondary_aggregated state hedges even when the SQL function says ban', r.stateNote?.status === 'unverified');
r = rankPathways({ exploits: [card()], pricePoints: pricePts, stateRow: IA, banApplies: true, patient: commercial });
check('IA verified-protected note + ERISA carve-out for employer plans', r.stateNote?.status === 'verified_protected' && /ERISA/.test(r.stateNote?.headline ?? ''));
r = rankPathways({ exploits: [card()], pricePoints: pricePts, stateRow: CA, banApplies: false, patient: { insuranceType: 'employer', stateCode: 'CA' } });
check('CA verified-unprotected shows the deductible-cliff warning', r.stateNote?.status === 'verified_unprotected' && /cost can jump/.test(r.stateNote?.headline ?? ''));
check('CA card pathway carries exhaustion-month estimate', r.ranked.find((p) => p.title === 'Card')?.trajectoryNotes.some((n) => /month \d/.test(n)) === true);
r = rankPathways({ exploits: [card()], pricePoints: pricePts, stateRow: NV, banApplies: false, patient: { insuranceType: 'employer', stateCode: 'NV' } });
check('NV surfaces regulatory-guidance note, not statute claim', r.stateNote?.status === 'regulatory_guidance');

// 5. Price semantics: 'as_low_as' stays 'as_low_as'.
r = rankPathways({ exploits: [card()], pricePoints: [], stateRow: IA, banApplies: true, patient: commercial });
check('as_low_as semantics preserved', r.ranked.find((p) => p.title === 'Card')?.priceSemantics === 'as_low_as');

// 6. Price points become normalized monthly pathways.
r = rankPathways({ exploits: [pap()], pricePoints: pricePts, stateRow: IA, banApplies: true, patient: commercial });
check('price_point pathway present at $521/mo', r.ranked.some((p) => p.kind === 'price_point' && p.monthlyCostUsd === 521));

// 7. Unknown state -> honest hedge, no assertion.
r = rankPathways({ exploits: [card()], pricePoints: [], stateRow: null, banApplies: false, patient: { insuranceType: 'employer', stateCode: null } });
check('null state hedges', r.stateNote?.status === 'unverified');

// 8. Bucket split: verified-but-wrong-fit rows land in notApplicable, NOT
// pendingVerification (which stays for genuinely unresolved data).
r = rankPathways({ exploits: [card(), pap()], pricePoints: [], stateRow: IA, banApplies: true, patient: { insuranceType: 'uninsured', stateCode: 'IA' } });
check('uninsured patient: commercial-only card is notApplicable', r.notApplicable.some((p) => p.title === 'Card'));
check('notApplicable row is NOT in pendingVerification', !r.pendingVerification.some((p) => p.title === 'Card'));
check('notApplicable row is NOT ranked', !r.ranked.some((p) => p.title === 'Card'));
r = rankPathways({ exploits: [conflictedCard], pricePoints: [], stateRow: IA, banApplies: true, patient: commercial });
check('conflicted row stays pendingVerification, never notApplicable', r.pendingVerification.some((p) => p.title === 'Conflicted Card') && r.notApplicable.length === 0);

console.log(failures === 0 ? '\nRANKING ENGINE: ALL PASS' : `\nRANKING ENGINE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
