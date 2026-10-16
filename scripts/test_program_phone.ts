// Program phone choice (lib/programPhone.ts): a number shows only for a
// program the ranking engine offers, best path first, and never from a
// blocked, pending or not-applicable row.
// Run: npx tsx scripts/test_program_phone.ts

import { pickProgramPhone } from '../lib/programPhone';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const rows = [
  { title: 'Card', support_phone: '1-555-555-0101', sources: { url: 'https://example.test/card' } },
  { title: 'DTP', support_phone: '1-555-555-0102', support_phone_source_url: 'https://example.test/support', support_phone_hours: 'Monday to Friday, 8 AM to 8 PM ET', sources: { url: 'https://example.test/release' } },
  { title: 'PAP', support_phone: ' 1-555-555-0103 ', sources: { url: 'https://example.test/pap' } },
  { title: 'Trial', support_phone: '1-555-555-0104', sources: null },
  { title: 'NoPhone', support_phone: null },
];

const DTP = { title: 'DTP' };
const PAP = { title: 'PAP' };

let p = pickProgramPhone({ winner: DTP, ranked: [DTP, PAP], bridges: [] }, rows);
check('best path number wins', p?.number === '1-555-555-0102' && p?.program === 'DTP');
check('cites the page the number came from, not the price source', p?.sourceUrl === 'https://example.test/support');
check('carries the hours the page states', p?.hours === 'Monday to Friday, 8 AM to 8 PM ET');

p = pickProgramPhone({ winner: { title: 'NoPhone' }, ranked: [{ title: 'NoPhone' }, PAP], bridges: [] }, rows);
check('winner without a number: next ranked program with one, trimmed', p?.number === '1-555-555-0103' && p?.program === 'PAP');
check('no stored source page: falls back to the row source, no hours', p?.sourceUrl === 'https://example.test/pap' && p?.hours === null);

p = pickProgramPhone({ winner: null, ranked: [], bridges: [{ title: 'Trial' }] }, rows);
check('only a bridge offered: its number is used', p?.program === 'Trial');

p = pickProgramPhone({ winner: PAP, ranked: [PAP], bridges: [] }, rows);
check('a pending/blocked row (Card, not ranked) never lends its number', p?.program === 'PAP');

check('nothing ranked: no number', pickProgramPhone({ winner: null, ranked: [], bridges: [] }, rows) === null);
check('no ranking ran: no number', pickProgramPhone(null, rows) === null);
check('ranked row with a blank number: no number', pickProgramPhone({ ranked: [{ title: 'X' }] }, [{ title: 'X', support_phone: '  ' }]) === null);

console.log(failures === 0 ? '\nPROGRAM PHONE: ALL PASS' : `\nPROGRAM PHONE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
