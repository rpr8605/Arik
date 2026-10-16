// Patient rights checks (lib/rules/bills/rights.ts): No Surprises emergency
// and ancillary limits, the good faith estimate dispute threshold and the
// hospital financial assistance window, plus the letter lines they write.
// Rule text: docs/research/no_surprises_charity_care_verification.md.
// Run: npx tsx scripts/test_bill_rights.ts

import { ancillaryKind, financialAssistance, goodFaithEstimate, isEmergencyCode, runRightsChecks, surpriseAncillary, surpriseEmergency, GFE_DISPUTE_THRESHOLD_USD, RIGHTS_VERSION } from '../lib/rules/bills/rights';
import { findingsProblems, letterProblems } from '../lib/production/contracts';
import { buildLetter, findingRequest, joinBody } from '../lib/letters/templates';
import { LETTER_FOOTER, type ConfirmedBill, type LetterInput } from '../lib/production/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const line = (code: string | null, chargeUsd: number, description: string | null = null) => ({ date: '2026-01-05', code, description, units: 1, chargeUsd, box: null });
const bill = (provider: string, lines: ConfirmedBill['lines'], extra: Partial<ConfirmedBill['header']> = {}): ConfirmedBill => ({
  confirmedAt: '2026-02-01T00:00:00Z',
  header: { patientName: 'Rosa Fairbairn', provider, accountNumber: 'ACC-1', statementDate: '2026-01-24', serviceFrom: '2026-01-05', serviceTo: '2026-01-05', totalChargesUsd: lines.reduce((t, l) => t + (l.chargeUsd ?? 0), 0), amountDueUsd: 500, ...extra },
  lines,
});

const er = bill('Pinecrest Valley Hospital', [line('0450', 1800, 'Emergency room'), line('99284', 900, 'ER visit'), line('80053', 120, 'Metabolic panel')]);
const anesthesia = bill('Ridgeview Anesthesia Group', [line('00840', 2400, 'Anesthesia'), line('99213', 150, 'Office visit')]);
const office = bill('Maple Family Practice', [line('99213', 180, 'Office visit')]);
const mri = bill('Ridgeview Imaging', [line('70553', 3200, 'MRI brain')]);

// --- Codes ---
check('emergency codes: revenue 045x, CPT 99281-99285, G0380-G0384', ['0450', '0459', '99281', '99285', 'G0384'].every(isEmergencyCode) && !['0460', '99286', '99213', 'G0385', null].some((c) => isEmergencyCode(c as string | null)));
check('ancillary kinds by code range', ancillaryKind('00840') === 'anesthesia' && ancillaryKind('70553') === 'imaging' && ancillaryKind('80053') === 'lab' && ancillaryKind('99468') === 'newborn care' && ancillaryKind('99213') === null && ancillaryKind('J1885') === null);

// --- Emergency (45 CFR 149.410) ---
const em = surpriseEmergency(er, { coverage: 'commercial' });
check('emergency: found on a work/marketplace plan, an ask with no amount', em.length === 1 && em[0].tone === 'ask' && em[0].amountUsd === null && em[0].lines.join() === '0,1' && em[0].dataVersion === RIGHTS_VERSION);
check('emergency: unknown coverage says "if"', /^If your insurance is through work or the marketplace/.test(surpriseEmergency(er, { coverage: 'unknown' })[0]?.plainText ?? ''));
check('emergency: never for uninsured, Medicare or Medicaid', (['uninsured', 'medicare', 'medicaid'] as const).every((c) => surpriseEmergency(er, { coverage: c }).length === 0));
check('emergency: nothing on a bill with no emergency care', surpriseEmergency(office, { coverage: 'commercial' }).length === 0);

// --- Ancillary at an in-network facility (45 CFR 149.420(b)) ---
const an = surpriseAncillary(anesthesia, { coverage: 'commercial' });
check('ancillary: an anesthesia bill gets one ask on the anesthesia line only', an.length === 1 && an[0].lines.join() === '0' && /anesthesia/.test(an[0].plainText) && /even if you signed a form/.test(an[0].plainText));
check('ancillary: imaging named', /imaging/.test(surpriseAncillary(mri, { coverage: 'unknown' })[0]?.plainText ?? ''));
check('ancillary: not on a hospital bill (the facility bills itself)', surpriseAncillary(er, { coverage: 'commercial' }).length === 0);
check('ancillary: not for Medicare', surpriseAncillary(anesthesia, { coverage: 'medicare' }).length === 0);

// --- Good faith estimate (45 CFR 149.620) ---
const over = goodFaithEstimate(mri, { coverage: 'uninsured', goodFaithEstimateUsd: 2800 });
check(`gfe: exactly ${GFE_DISPUTE_THRESHOLD_USD} over is "at least $400 more"`, over.length === 1 && over[0].ruleId === 'gfe_over' && over[0].refsUsd?.join() === '2800,3200,400');
check('gfe: the text names the estimate, the bill and the difference, and the 120 days', /\$3,200.*\$400 more than the \$2,800 good faith estimate/.test(over[0]?.plainText ?? '') && /120 days/.test(over[0]?.plainText ?? ''));
check('gfe: $399.99 over is not enough', goodFaithEstimate(mri, { coverage: 'uninsured', goodFaithEstimateUsd: 2800.01 }).length === 0);
check('gfe: no amount on the finding (no double counting with line findings)', over[0]?.amountUsd === null);
check('gfe: uses the bill total when given', goodFaithEstimate(bill('X Imaging', [line('70553', 100)], { totalChargesUsd: 5000 }), { coverage: 'uninsured', goodFaithEstimateUsd: 1000 })[0]?.refsUsd?.[1] === 5000);
check('gfe: uninsured with no estimate entered gets the ask', goodFaithEstimate(mri, { coverage: 'uninsured' })[0]?.ruleId === 'gfe_ask');
check('gfe: no ask for emergency care (it is not scheduled)', goodFaithEstimate(er, { coverage: 'uninsured' }).length === 0);
check('gfe: no ask for an insured patient who entered nothing', goodFaithEstimate(mri, { coverage: 'commercial' }).length === 0);

// --- Financial assistance (26 CFR 1.501(r)) ---
const fa = financialAssistance(er);
check('financial assistance: hospital bills get the ask, with the 240-day date from the statement', fa.length === 1 && /If this hospital is a nonprofit/.test(fa[0].plainText) && /Sep 21, 2026 or later/.test(fa[0].plainText), fa[0]?.plainText);
check('financial assistance: no date without a statement date', !/or later/.test(financialAssistance(bill('Pinecrest Valley Hospital', [line('0450', 100)], { statementDate: null }))[0]?.plainText ?? 'or later'));
check('financial assistance: not on a doctor bill', financialAssistance(office).length === 0 && financialAssistance(anesthesia).length === 0);

// --- Whole run honors the findings contract ---
for (const [name, b, cov] of [['er', er, 'commercial'], ['anesthesia', anesthesia, 'unknown'], ['mri', mri, 'uninsured']] as const) {
  const f = runRightsChecks(b, { coverage: cov, goodFaithEstimateUsd: name === 'mri' ? 2000 : null });
  check(`contract: ${name} findings pass (plain words, no rule names)`, f.length > 0 && findingsProblems(f, b).length === 0, findingsProblems(f, b).join('; '));
}

// --- Letters ---
const input = (b: ConfirmedBill, findings: ReturnType<typeof runRightsChecks>): LetterInput => ({ type: 'billing_dispute', patient: { name: 'Rosa Fairbairn', phone: null, address: null }, recipient: { name: b.header.provider!, address: null, fax: null }, bill: b, findings, date: '2026-02-01' });
const erF = runRightsChecks(er, { coverage: 'commercial' });
check('letter: emergency item cites 45 CFR 149.410', /45 CFR 149\.410/.test(findingRequest(erF[0], er)));
check('letter: financial assistance item asks for the policy and a hold', /financial assistance policy/.test(findingRequest(erF[1], er)) && /hold all collection activity/.test(findingRequest(erF[1], er)));
const mriF = runRightsChecks(mri, { coverage: 'uninsured', goodFaithEstimateUsd: 2000 });
const gfeLetter = buildLetter(input(mri, mriF));
const draft = { type: 'billing_dispute' as const, subject: gfeLetter.subject, body: joinBody(gfeLetter), footer: LETTER_FOOTER, drafter: 'code-templates', usedFallback: false };
check('letter: the estimate, total and difference pass the grounding check via refsUsd', letterProblems(draft, input(mri, mriF)).length === 0 && /\$2,000\.00/.test(draft.body) && /\$1,200\.00 more/.test(draft.body), letterProblems(draft, input(mri, mriF)).join('; '));
const noRefs = mriF.map((f) => ({ ...f, refsUsd: undefined }));
check('letter: without the named amounts the same text would fail grounding', letterProblems(draft, input(mri, noRefs)).some((p) => p.startsWith('amount not in the bill')));
check('letter: the gfe ask asks for a copy', findingRequest(runRightsChecks(mri, { coverage: 'uninsured' })[0], mri) === 'Please send me a copy of any good faith estimate you gave me for this care.');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
