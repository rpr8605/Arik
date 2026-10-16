// "Looks right" (lib/production/confirm.ts) and the on-server reading's
// upload summary (layoutToExtraction in lib/documentIntake.ts). Pure.
// Run: npx tsx scripts/test_confirm_bill.ts

import { LUIS_EXTRACTION } from '../lib/production/demo';
import { draftFromReading, parseConfirmedBill } from '../lib/production/confirm';
import { documentReader, layoutToExtraction } from '../lib/documentIntake';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const draft = draftFromReading(LUIS_EXTRACTION);
const ok = parseConfirmedBill(draft, new Date('2026-10-16T00:00:00Z'));
check('the reading, confirmed as-is, is accepted', 'bill' in ok && ok.bill.lines.length === 8 && ok.bill.header.accountNumber === 'RGH-4471902' && ok.bill.confirmedAt === '2026-10-16T00:00:00.000Z');
check('boxes carry through for the highlights', 'bill' in ok && ok.bill.lines[0].box?.page === 1);

const bad = (name: string, mutate: (d: any) => void) => {
  const d = JSON.parse(JSON.stringify(draft));
  mutate(d);
  const r = parseConfirmedBill(d);
  check(`refused: ${name}`, 'error' in r, 'error' in r ? r.error : 'accepted');
};
bad('no lines array', (d) => delete d.lines);
bad('a negative charge', (d) => (d.lines[0].chargeUsd = -1));
bad('a charge as text', (d) => (d.lines[0].chargeUsd = '186'));
bad('fractional units', (d) => (d.lines[0].units = 1.5));
bad('a date that is not a date', (d) => (d.lines[0].date = '2026-02-31x'));
bad('a code that is not a code', (d) => (d.lines[0].code = '99284; drop table'));
bad('service dates out of order', (d) => ((d.header.serviceFrom = '2026-09-05'), (d.header.serviceTo = '2026-09-03')));
bad('a huge description', (d) => (d.lines[0].description = 'x'.repeat(500)));
bad('too many lines', (d) => (d.lines = Array.from({ length: 301 }, () => d.lines[0])));
bad('a box that is not a box', (d) => (d.lines[0].box = { page: 'one' }));

const blanks = parseConfirmedBill({ header: { accountNumber: '', statementDate: '' }, lines: [{ code: ' j1885 ', date: '', units: '', chargeUsd: 70.594 }] });
check('blanks become null, codes are trimmed and uppercased, cents rounded', 'bill' in blanks && blanks.bill.header.accountNumber === null && blanks.bill.lines[0].code === 'J1885' && blanks.bill.lines[0].date === null && blanks.bill.lines[0].units === null && blanks.bill.lines[0].chargeUsd === 70.59);

const ex = layoutToExtraction(LUIS_EXTRACTION);
check('upload summary from the on-server reading: type, hospital, amount you owe', ex.doc_type === 'itemized_bill' && ex.institution_name === 'Riverbend General Hospital' && ex.total_amount_usd === 6282 && ex.payer_name === null);
check('upload summary keeps the full reading and the reader name', ex.layout === LUIS_EXTRACTION && ex.reader === 'demo-stored');
check('upload summary never invents prose', ex.summary === null && ex.denial_reason === null);
const denial = layoutToExtraction({ ...LUIS_EXTRACTION, docType: 'denial_letter', lines: [] });
check('a denial letter names the plan as payer, not as the institution', denial.doc_type === 'denial_letter' && denial.payer_name === 'Riverbend General Hospital' && denial.institution_name === null && denial.total_amount_usd === null);
check('an unknown document is "other"', layoutToExtraction({ ...LUIS_EXTRACTION, docType: 'unknown' }).doc_type === 'other');

const prev = process.env.DOCUMENT_READER;
delete process.env.DOCUMENT_READER;
const d1 = documentReader();
process.env.DOCUMENT_READER = ' Model ';
const d2 = documentReader();
process.env.DOCUMENT_READER = 'vision';
const d3 = documentReader();
if (prev == null) delete process.env.DOCUMENT_READER;
else process.env.DOCUMENT_READER = prev;
check('the on-server reader is the default; the model reader only when asked for by name', d1 === 'on-server' && d2 === 'model' && d3 === 'on-server');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
