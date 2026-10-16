// Pure layout parser (lib/production/layout.ts): OCR digit repair, noise
// trimming, row grouping, labels (longest first, split by OCR), deskew and a
// whole bill, an EOB and a denial letter built from positioned words.
// Run: npx tsx scripts/test_layout.ts

import { deskew, detectDocType, groupRows, parseCode, parseDate, parseDocument, parseMoney, parseUnits, trimNoise, type Word } from '../lib/production/layout';
import { extractionProblems } from '../lib/production/contracts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// Lay out text rows as words: each row is a string, words split on spaces,
// x advancing by character count. Row y every 3% from 5%.
function page(rows: string[], tilt = 0): Word[] {
  const out: Word[] = [];
  rows.forEach((r, i) => {
    let x = 8;
    for (const t of r.split(' ').filter(Boolean)) {
      out.push({ text: t, page: 1, x, y: 5 + i * 3 + (x * tilt), w: t.length * 0.9, h: 1.6, conf: 0.95 });
      x += t.length * 0.9 + 0.9;
    }
  });
  return out;
}

check('money: OCR letters repaired', parseMoney('$1,O26.5O') === 1026.5 && parseMoney('S70.59') === 70.59);
check('money: trailing punctuation ignored', parseMoney('$246.52.') === 246.52);
check('money: not money', parseMoney('Emergency') === null);
check('date: two-digit year', parseDate('01/05/26') === '2026-01-05');
check('date: speckle around it', parseDate('.01/O5/2026.') === '2026-01-05');
check('date: impossible date refused', parseDate('13/45/2026') === null);
check('code: CPT and HCPCS', parseCode('99284') === '99284' && parseCode('J1885') === 'J1885' && parseCode('.J1885') === 'J1885');
check('code: words are not codes', parseCode('visit') === null);
check('units: l reads as 1', parseUnits('l') === 1 && parseUnits('3') === 3 && parseUnits('x') === null);
check('trimNoise keeps the value', trimNoise('-.99284') === '99284' && trimNoise('‘Admit') === 'Admit');

const rows = groupRows([
  { text: 'A', page: 1, x: 5, y: 10, w: 1, h: 1.5, conf: 1 },
  { text: 'B', page: 1, x: 9, y: 10.4, w: 1, h: 1.5, conf: 1 },
  { text: 'C', page: 1, x: 5, y: 14, w: 1, h: 1.5, conf: 1 },
  { text: '-', page: 1, x: 7, y: 10, w: 0.5, h: 1.5, conf: 1 },
]);
check('rows: near lines merge, far lines split, lone punctuation dropped', rows.length === 2 && rows[0].text === 'A B' && rows[1].text === 'C');

const bill = [
  'Pinecrest Valley Hospital',
  'ITEMIZED STATEMENT',
  'Guarantor /Patient: Rosa Fairbairn',
  'Acct No.: CRC-6855326',
  'Date: 01/24/26',
  '‘Admit Discharge: 01/05/26 to 01/07/26',
  'Code Date Description Amount Qty',
  '99283 01/05/26 Emergency visit $1,126.27 1',
  'J2405 01/06/26 Anti-nausea injection $78.84 2',
  '36415 01/05/26 Blood draw $64.33 l',
  'Total charges: $1,269.44',
  'Amount due: $1,069.44',
];
const b = parseDocument(page(bill), 'test');
const h = b.header;
check('bill: type', b.docType === 'itemized_bill', b.docType);
check('bill: split label "Guarantor /Patient" still reads the name', h.patientName.value === 'Rosa Fairbairn', String(h.patientName.value));
check('bill: account', h.accountNumber.value === 'CRC-6855326');
check('bill: statement date from "Date:"', h.statementDate.value === '2026-01-24');
check('bill: service dates with speckle and no dash', h.serviceFrom.value === '2026-01-05' && h.serviceTo.value === '2026-01-07');
check('bill: totals', h.totalChargesUsd.value === 1269.44 && h.amountDueUsd.value === 1069.44);
check('bill: three lines, codes, units', b.lines.length === 3 && b.lines.map((l) => l.code.value).join() === '99283,J2405,36415' && b.lines.map((l) => l.units.value).join() === '1,2,1');
check('bill: line charges', b.lines.map((l) => l.chargeUsd.value).join() === '1126.27,78.84,64.33');
check('bill: output honors the extraction contract', extractionProblems(b).length === 0, extractionProblems(b).join('; '));

const tilted = parseDocument(deskew(page(bill, 0.02), Math.atan(0.02) * 180 / Math.PI), 'test');
check('deskew: a tilted page reads the same lines', tilted.lines.length === 3 && tilted.header.totalChargesUsd.value === 1269.44);

const eob = parseDocument(page([
  'Bluefin Health Plan',
  'EXPLANATION OF BENEFITS - THIS IS NOT A BILL',
  'Member: Noor Brambleton',
  'Claim number: BF-1188',
  'Service Date Code Billed Allowed You owe',
  '01/05/26 99284 $2,700.27 $812.00 $150.00',
]), 'test');
check('eob: type, member, claim', eob.docType === 'eob' && eob.header.patientName.value === 'Noor Brambleton' && eob.header.accountNumber.value === 'BF-1188');
check('eob: the billed amount is the first money on the line', eob.lines.length === 1 && eob.lines[0].chargeUsd.value === 2700.27);

const denial = parseDocument(page([
  'Bluefin Health Plan',
  '01/21/2026',
  'Dear Noor Brambleton,',
  'Our decision: we are not able to approve this request.',
  'Your appeal must reach us within 60 days of the',
  'date of this letter.',
]), 'test');
check('denial: type and the letter date (a "date of this letter" row is not a label)', denial.docType === 'denial_letter' && denial.header.statementDate.value === '2026-01-21', String(denial.header.statementDate.value));
check('denial: no line items', denial.lines.length === 0);
check('unknown text stays unknown', detectDocType('hello world') === 'unknown');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
