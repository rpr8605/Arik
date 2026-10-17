// Denial engine eval harness (spec Appendix B4, B5; M11-AC6). Each case is
// a synthetic denial letter's text (no real PHI) plus what a reviewer
// expects: category, plan type, flags, the deadline and the first letter.
// The pipeline is the real one: reader -> (patient confirms the draft as
// read) -> checks -> letter options -> each letter through the contract.
// Graded cases from billing experts can be added as a JSON file of the
// same shape: npx tsx scripts/eval_denials.ts [--cases graded.json]
// No model calls; free to run.

import { readFileSync } from 'node:fs';
import { parseDenialText } from '../lib/rules/denials/parse';
import { parseConfirmedDenial } from '../lib/rules/denials/confirm';
import { runDenialChecks } from '../lib/rules/denials/checks';
import { buildDenialLetter, denialLetterOptions, denialLetterProblems } from '../lib/letters/denialTemplates';
import { joinBody } from '../lib/letters/templates';
import { LETTER_FOOTER } from '../lib/production/types';
import type { CheckId, DenialLetterType } from '../lib/rules/denials/types';

interface EvalCase {
  id: string;
  text: string;
  today: string;
  patientAdds?: Record<string, unknown>;   // what the patient fills in on the confirm screen
  expect: { category: string; planFunding: string; flags: CheckId[]; deadline: string | null; firstLetter: DenialLetterType | null };
}

const SAMPLE = 'SAMPLE document made for testing Arik Health. Fictional member and plan.';
const BUILTIN: EvalCase[] = [
  {
    id: 'medical-necessity-insured',
    text: `Bluefin Health Plan\n03/02/2026\nDear Owen Lindqvist,\nClaim number: CL-31-4482210    Date of service: 02/10/2026\nWe reviewed the claim for: MRI of the knee (code 73721).\nReason: The records we received do not show that this service was medically necessary.\nReason code: CO-50\nYour plan is insured by Bluefin Health Plan through your employer.\nYou have the right to appeal within 180 days of the date of this letter.\n${SAMPLE}`,
    today: '2026-03-20',
    expect: { category: 'medical_necessity', planFunding: 'fully_insured', flags: ['patient_deadline', 'medical_necessity', 'no_error_found'], deadline: '2026-08-29', firstLetter: 'insurer_appeal' },
  },
  {
    id: 'no-reason-marketplace',
    text: `Northwind Care Plan\n05/01/2026\nDear Imani Moraes,\nClaim number: CL-77-1029384\nYour claim has been denied.\nYou bought this individual plan through the Marketplace.\nYou can appeal this decision.\n${SAMPLE}`,
    today: '2026-05-10',
    expect: { category: 'no_reason_given', planFunding: 'marketplace', flags: ['patient_deadline', 'missing_specific_reason'], deadline: '2026-10-28', firstLetter: 'specific_reason_request' },
  },
  {
    id: 'administrative-medicaid-plan',
    text: `Lantern Medicaid Health Plan\n04/06/2026\nDear Gus Holloway,\nClaim number: CL-50-6677112    Date of service: 03/15/2026\nReason: We did not receive the information we asked for.\nReason code: CO-16\nThis is your Medicaid health plan.\nYou have the right to appeal within 60 days.\n${SAMPLE}`,
    today: '2026-04-10',
    expect: { category: 'administrative', planFunding: 'medicaid', flags: ['patient_deadline', 'administrative_denial', 'no_error_found'], deadline: '2026-06-05', firstLetter: 'insurer_appeal' },
  },
  {
    id: 'prior-auth-ma-approval-on-file',
    text: `Meridian Oak Medicare Advantage\nDate of notice: 06/01/2026\nDear Noor Okonkwo-Vale,\nClaim number: CL-12-9988776    Date of service: 05/12/2026\nWe reviewed the request for: CT of the abdomen (code 74177).\nReason: This service needed approval before it was done, and we did not receive a request.\nReason code: CO-197\nThis is a Medicare Advantage plan. This notice is our organization determination.\n${SAMPLE}`,
    today: '2026-06-05',
    patientAdds: { priorAuth: { reference: 'PA-55120', serviceCode: '74177', validFrom: '2026-05-01', validTo: '2026-06-30' } },
    expect: { category: 'no_prior_authorization', planFunding: 'medicare_advantage', flags: ['patient_deadline', 'prior_auth_on_file'], deadline: '2026-08-05', firstLetter: 'insurer_appeal' },
  },
  {
    id: 'excluded-self-funded',
    text: `Lantern Mutual Health\n02/02/2026\nDear Calvin Abernathy,\nClaim number: CL-90-1112223    Date of service: 01/09/2026\nReason: This service is not covered under your plan.\nReason code: CO-96\nYour employer's plan is self-funded. We are the claims administrator for your employer.\n${SAMPLE}`,
    today: '2026-02-10',
    expect: { category: 'excluded_service', planFunding: 'self_funded', flags: ['patient_deadline', 'self_funded_track', 'excluded_service', 'no_error_found'], deadline: '2026-08-01', firstLetter: 'claim_file_request' },
  },
  {
    id: 'part-d-formulary',
    text: `Northwind Medicare Rx\nNotice of Denial of Medicare Prescription Drug Coverage\nDate of notice: March 2, 2026\nDear Mei Castellanos,\nDrug: Zolvanex 20 mg tablets\nWhy we denied your request: The drug is not on our formulary.\nYou can ask for a redetermination.\n${SAMPLE}`,
    today: '2026-03-10',
    expect: { category: 'excluded_service', planFunding: 'medicare_part_d', flags: ['patient_deadline', 'excluded_service', 'no_error_found'], deadline: '2026-05-06', firstLetter: 'insurer_appeal' },
  },
  {
    id: 'other-late-appeal-decision',
    text: `Bluefin Health Plan\n07/20/2026\nDear Rosa Fairbairn,\nClaim number: CL-44-5566778    Date of service: 03/03/2026\nWe have reviewed your appeal and upheld our decision.\nReason: The plan pays for 20 visits each year and you have used them.\nYour plan is insured by Bluefin Health Plan through your employer.\n${SAMPLE}`,
    today: '2026-07-25',
    patientAdds: { requestDate: '2026-04-01' },
    expect: { category: 'other', planFunding: 'fully_insured', flags: ['patient_deadline', 'insurer_late', 'external_review'], deadline: '2026-11-20', firstLetter: 'external_review_request' },
  },
];

const ci = process.argv.indexOf('--cases');
const cases: EvalCase[] = ci > 0 ? JSON.parse(readFileSync(process.argv[ci + 1], 'utf8')) : BUILTIN;

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
};

for (const c of cases) {
  const draft = parseDenialText(c.text);
  const confirmed = parseConfirmedDenial({ ...draft, ...c.patientAdds }, new Date(`${c.today}T12:00:00Z`));
  if ('error' in confirmed) {
    check(`${c.id}: confirms`, false, confirmed.error);
    continue;
  }
  const d = confirmed.denial;
  const { flags } = runDenialChecks(d, c.today);
  const ids = flags.map((f) => f.id);
  const deadline = flags.find((f) => f.id === 'patient_deadline')?.deadline?.due ?? null;
  const options = denialLetterOptions(d, flags);
  check(`${c.id}: category ${c.expect.category}`, d.category === c.expect.category, d.category);
  check(`${c.id}: plan ${c.expect.planFunding}`, d.planFunding === c.expect.planFunding, d.planFunding);
  check(`${c.id}: flags`, ids.join() === c.expect.flags.join(), ids.join());
  check(`${c.id}: deadline ${c.expect.deadline}`, deadline === c.expect.deadline, String(deadline));
  check(`${c.id}: first letter ${c.expect.firstLetter}`, (options[0] ?? null) === c.expect.firstLetter, options.join());
  for (const type of options) {
    const input = { type, patient: { name: 'Sample Patient', phone: null }, denial: d, flags, context: { coverageRules: null, planDocumentOnFile: false }, date: c.today };
    const parts = buildDenialLetter(input);
    const probs = denialLetterProblems({ subject: parts.subject, body: joinBody(parts), footer: LETTER_FOOTER }, input);
    check(`${c.id}: ${type} letter honors the contract`, probs.length === 0, probs.join('; '));
  }
}

console.log(failures ? `\nEVAL DENIALS: ${failures} FAILED of ${cases.length} cases` : `\nEVAL DENIALS: ALL PASS (${cases.length} cases)`);
process.exit(failures ? 1 : 0);
