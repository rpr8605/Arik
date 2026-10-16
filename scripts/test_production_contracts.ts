// Production contracts (docs/kimi/PLAN_PHASES_2_4.md): the demo and real
// implementations of each interface pass the same checks. Pure, no network,
// no model calls (real letter drafting runs with a stub model here).
// Run: npx tsx scripts/test_production_contracts.ts

import { confirm, demoBillChecks, demoDocumentSource, demoExtractor, demoLetterDrafter, LUIS_EXTRACTION } from '../lib/production/demo';
import { extractionProblems, findingsProblems, findingsTotal, letterProblems } from '../lib/production/contracts';
import { realBillChecks } from '../lib/production/real/billChecks';
import type { BillChecks, Extractor, LetterDrafter, LetterInput } from '../lib/production/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

export async function runContracts(label: string, impl: { extractor?: Extractor; checks?: BillChecks; drafter?: LetterDrafter }) {
  const bill = confirm(LUIS_EXTRACTION, '2026-10-16T12:00:00Z');
  if (impl.extractor) {
    const src = await demoDocumentSource.get('luis-hospital-bill');
    const out = await impl.extractor.extract(src);
    const p = extractionProblems(out);
    check(`${label} extractor: output honors the contract`, p.length === 0, p.slice(0, 3).join('; '));
  }
  if (impl.checks) {
    const findings = await impl.checks.run(bill);
    const p = findingsProblems(findings, bill);
    check(`${label} checks: findings honor the contract`, p.length === 0, p.slice(0, 3).join('; '));
    check(`${label} checks: total is the sum of the findings`, findingsTotal(findings) === findings.reduce((t, f) => t + (f.amountUsd ?? 0), 0));
    if (impl.drafter) {
      const input: LetterInput = {
        type: 'billing_dispute',
        patient: { name: 'Luis Moreno', phone: '(555) 555-0100', address: null },
        recipient: { name: 'Riverbend General Hospital', address: '1200 Riverbend Parkway, Mesa Vista, AZ 85000', fax: '(480) 555-0142' },
        bill,
        findings,
        date: '2026-10-16',
      };
      const letter = await impl.drafter.draft(input);
      const lp = letterProblems(letter, input);
      check(`${label} drafter: letter honors the contract`, lp.length === 0, lp.slice(0, 3).join('; '));
    }
  }
}

(async () => {
  await runContracts('demo', { extractor: demoExtractor, checks: demoBillChecks, drafter: demoLetterDrafter });
  // The real rules, with an in-memory reference set (TEST FIXTURE pair,
  // not CMS data) in place of the database.
  await runContracts('real', {
    checks: realBillChecks(async () => ({
      ptp: { version: 'test-fixture', pairs: [{ col1: '80053', col2: '80048', modifier: 0, effective: '2000-01-01', deleted: null }] },
      mue: { version: 'mue-test', byCode: { '85025': { limit: 4, mai: 3 } } },
    })),
    drafter: demoLetterDrafter,
  });

  // The contract checks themselves catch what they should.
  const bad = { ...LUIS_EXTRACTION, lines: [{ ...LUIS_EXTRACTION.lines[0], date: { value: '09/03/26', confidence: 2, box: { page: 1, x: 90, y: 10, w: 30, h: 2 } } }] };
  check('contract catches non-ISO dates, bad confidence and boxes off the page', extractionProblems(bad as any).length >= 3);
  const bill = confirm(LUIS_EXTRACTION);
  check('contract catches a finding bigger than its lines and rule names in patient text', findingsProblems([{ id: 'x', lines: [1], tone: 'wrong', amountUsd: 999, plainText: 'Per NCCI, remove it.', ruleId: 'r', dataVersion: 'v' }], bill).length === 2);
  check('contract catches an invented amount in a letter', letterProblems(
    { type: 'billing_dispute', subject: 'Account RGH-4471902', body: 'Please refund $77.00.', footer: 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.', drafter: 'x', usedFallback: false },
    { type: 'billing_dispute', patient: { name: 'L', phone: null, address: null }, recipient: { name: 'R', address: null, fax: null }, bill, findings: [], date: '2026-10-16' },
  ).some((x) => x.includes('$77.00')));

  console.log(failures === 0 ? '\nPRODUCTION CONTRACTS: ALL PASS' : `\nPRODUCTION CONTRACTS: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
