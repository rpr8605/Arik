// Letter engine (Phase 4): code templates, the one-sentence model guard,
// the model drafter's fallback, and freezing (hash + PDF). Pure apart from
// rendering and re-reading a PDF locally; the model is a stub here.
// Run: npx tsx scripts/test_letters.ts

import { confirm, LUIS_EXTRACTION } from '../lib/production/demo';
import { letterProblems } from '../lib/production/contracts';
import { codeLetterDrafter, modelLetterDrafter } from '../lib/production/real/letterDrafter';
import { pdfTextWords } from '../lib/production/real/readers';
import type { ConfirmedBill, LetterInput, LetterType } from '../lib/production/types';
import { boundedSentenceProblems } from '../lib/letters/guard';
import { letterHash, letterPdf } from '../lib/letters/freeze';
import { BILL_LETTER_TYPES, buildLetter } from '../lib/letters/templates';
import { runBillChecks, type BillRefs } from '../lib/rules/bills/checks';
import { makeBill } from '../lib/synth/model';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// TEST FIXTURE pair, not CMS data.
const REFS: BillRefs = { ptp: { version: 'test-fixture', pairs: [{ col1: '80053', col2: '80048', modifier: 0, effective: '2000-01-01', deleted: null }] } };
const luis = confirm(LUIS_EXTRACTION, '2026-10-16T00:00:00Z');
const input = (type: LetterType, bill: ConfirmedBill = luis, refs = REFS): LetterInput => ({
  type,
  patient: { name: bill === luis ? 'Luis Moreno' : bill.header.patientName ?? 'Sample Person', phone: '(555) 555-0100', address: null },
  recipient: { name: bill.header.provider ?? 'Sample Hospital', address: null, fax: null },
  bill,
  findings: runBillChecks(bill, refs),
  date: '2026-10-16',
});

(async () => {
  // ---------- Code templates ----------
  const dispute = await codeLetterDrafter.draft(input('billing_dispute'));
  check('dispute: honors the letter contract', letterProblems(dispute, input('billing_dispute')).length === 0, letterProblems(dispute, input('billing_dispute')).join('; '));
  check('dispute: subject names the account and the visit', dispute.subject === 'Dispute of charges on account RGH-4471902 (visit 09/03/2026 to 09/05/2026)', dispute.subject);
  check('dispute: the three demo disputes, with their amounts', ['remove the duplicate charge of $186.00', 'Please explain why both were charged, or remove the $412.00 charge', 'which is 2 nights. Please remove one day, $2,950.00'].every((s) => dispute.body.includes(s)), dispute.body.slice(0, 600));
  check('dispute: numbered items, hold-from-collections request, phone, signoff', /\n\n1\. /.test(dispute.body) && /do not send it to collections/.test(dispute.body) && dispute.body.includes('(555) 555-0100') && dispute.body.endsWith('Sincerely,\nLuis Moreno'));
  check('dispute: no Medicare benchmark figures and no rule names in a letter', !/NCCI|MUE|CFR|Medicare pays/.test(dispute.body));

  for (const t of BILL_LETTER_TYPES) {
    const i = input(t);
    const l = await codeLetterDrafter.draft(i);
    check(`${t}: honors the contract`, letterProblems(l, i).length === 0, letterProblems(l, i).join('; '));
  }
  let threw = 0;
  for (const t of ['insurer_appeal', 'medical_necessity_request'] as LetterType[]) {
    try {
      buildLetter(input(t));
    } catch {
      threw++;
    }
  }
  check('appeal and records letters are refused from a bill (they come with the denial flow)', threw === 2);
  let noFindings = false;
  try {
    buildLetter({ ...input('billing_dispute'), findings: [] });
  } catch {
    noFindings = true;
  }
  check('a dispute with nothing to dispute is refused', noFindings);
  const askOnly = buildLetter({ ...input('billing_dispute'), findings: input('billing_dispute').findings.map((f) => ({ ...f, tone: 'ask' as const })) });
  check('questions only: "I have questions about these charges", no "disputing"', askOnly.items[0] === 'I have questions about these charges:' && !/disputing/.test(askOnly.opening));

  let synthOk = 0;
  let synthN = 0;
  const bad: string[] = [];
  for (let s = 1; s <= 40; s++) {
    const b = makeBill(s);
    const bill: ConfirmedBill = {
      confirmedAt: '2026-10-16T00:00:00Z',
      header: { patientName: b.patientName, provider: b.provider, accountNumber: b.accountNumber, statementDate: b.statementDate, serviceFrom: b.serviceFrom, serviceTo: b.serviceTo, totalChargesUsd: b.totalChargesUsd, amountDueUsd: b.amountDueUsd },
      lines: b.lines.map((l) => ({ ...l, box: null })),
    };
    const i = input('billing_dispute', bill);
    if (!i.findings.length) continue;
    synthN++;
    const l = await codeLetterDrafter.draft(i);
    const p = letterProblems(l, i);
    if (!p.length) synthOk++;
    else bad.push(`${b.id}: ${p[0]}`);
  }
  check(`synthetic: every dispute letter honors the contract (${synthOk}/${synthN})`, synthOk === synthN && synthN > 20, bad.slice(0, 3).join(' | '));

  // ---------- The one model sentence ----------
  check('guard: a plain cooperative sentence passes', boundedSentenceProblems('I would like to resolve this quickly and keep my account in good standing.').length === 0);
  for (const [why, s] of [
    ['a number', 'I have paid 3 bills on time.'],
    ['a dollar amount', 'I want to pay the right amount, not $5.'],
    ['a name', 'I spoke with Maria in billing last week.'],
    ['legal wording', 'I would rather not involve an attorney.'],
    ['a threat', 'I demand that you fix this at once.'],
    ['an em dash', `I want to fix this ${String.fromCharCode(0x2014)} soon.`],
    ['a placeholder', 'Please call me at {phone}.'],
    ['too long', `I would like to resolve this ${'very '.repeat(50)}soon.`],
  ]) check(`guard: refuses ${why}`, boundedSentenceProblems(s).length > 0);

  const prompts: string[] = [];
  const stub = (answers: (string | Error)[]) => async (p: string) => {
    prompts.push(p);
    const a = answers.shift() ?? 'x';
    if (a instanceof Error) throw a;
    return a;
  };
  const good = 'I would like to resolve this quickly and keep my account in good standing.';
  const m1 = await modelLetterDrafter(stub([good])).draft(input('billing_dispute'));
  check('model drafter: a good sentence goes in after the opening', m1.body.includes(`line by line and I am disputing these charges. ${good} Here is what I found:`) && !m1.usedFallback && m1.drafter === 'code-templates+model-sentence');
  check('model drafter: the letter still honors the contract', letterProblems(m1, input('billing_dispute')).length === 0);
  const m2 = await modelLetterDrafter(stub(['I spoke with Maria about the $186.', good])).draft(input('billing_dispute'));
  check('model drafter: one regeneration with the problems listed', m2.body.includes(good) && prompts.some((p) => p.includes('was rejected because')));
  const code = await codeLetterDrafter.draft(input('billing_dispute'));
  const m3 = await modelLetterDrafter(stub(['Call our attorney.', 'Pay 5 now.'])).draft(input('billing_dispute'));
  check('model drafter: two bad sentences, the code letter goes out unchanged (fallback)', m3.usedFallback && m3.body === code.body && m3.drafter === 'code-templates');
  const m4 = await modelLetterDrafter(stub([new Error('timeout'), new Error('timeout')])).draft(input('billing_dispute'));
  check('model drafter: model down, the code letter goes out', m4.usedFallback && m4.body === code.body);
  check('model drafter: the model is never told a name, account, service, date or amount', prompts.every((p) => !/Luis|Moreno|RGH|4471902|blood|room|\$|2026|Riverbend/i.test(p)), prompts[0]);

  // ---------- Freeze: hash + PDF ----------
  const h1 = letterHash(dispute);
  check('freeze: the hash is stable and changes with any edit', h1 === letterHash({ ...dispute }) && h1 !== letterHash({ ...dispute, body: dispute.body.replace('186', '187') }) && /^[0-9a-f]{64}$/.test(h1));
  const pdf = await letterPdf(dispute, 'October 16, 2026');
  const text = (await pdfTextWords(pdf)).map((w) => w.text).join(' ');
  check('freeze: the PDF carries the letter, the amounts and the footer', Buffer.from(pdf.slice(0, 5)).toString() === '%PDF-' && ['RGH-4471902', '$186.00', '$412.00', '$2,950.00', 'Not', 'legal', 'advice.', 'Luis', 'Moreno'].every((s) => text.includes(s)), text.slice(0, 200));
  const long = await letterPdf({ ...dispute, body: Array.from({ length: 60 }, () => dispute.body.split('\n\n')[1]).join('\n\n') }, 'October 16, 2026');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: long });
  const pages = (await task.promise).numPages;
  await task.destroy();
  check('freeze: a long letter flows onto more pages', pages > 1, String(pages));
  const odd = await letterPdf({ ...dispute, body: 'Name: Łukasz Żółć' }, 'October 16, 2026');
  check('freeze: characters the PDF font lacks do not break the PDF', odd.length > 500);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
