// Synthetic document model (lib/synth/model.ts): reproducible from the seed,
// totals add up, planted problems point at the right lines with the right
// amounts, and nothing real leaks in. Pure.
// Run: npx tsx scripts/test_synth_model.ts

import { makeBill, makeDenial, makeEob } from '../lib/synth/model';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const bills = Array.from({ length: 40 }, (_, i) => makeBill(i + 1));
check('same seed, same document', JSON.stringify(makeBill(7)) === JSON.stringify(makeBill(7)) && JSON.stringify(makeEob(7)) === JSON.stringify(makeEob(7)));
check('bill totals are the sum of the lines, and due = total - paid', bills.every((b) => Math.abs(b.lines.reduce((t, l) => t + l.chargeUsd, 0) - b.totalChargesUsd) < 0.01 && Math.abs(b.totalChargesUsd - b.insurancePaidUsd - b.amountDueUsd) < 0.01));
check('every kind of planted problem appears across 40 seeds', ['duplicate', 'unbundled_panel', 'room_days', 'unlisted_supplies'].every((k) => bills.some((b) => b.planted.some((p) => p.kind === k))));

let ok = true;
for (const b of bills) {
  for (const p of b.planted) {
    const ls = p.lines.map((i) => b.lines[i]);
    if (ls.some((l) => !l)) ok = false;
    else if (p.kind === 'duplicate') ok &&= ls[0].code === ls[1].code && ls[0].date === ls[1].date && ls[0].chargeUsd === ls[1].chargeUsd && p.amountUsd === ls[1].chargeUsd;
    else if (p.kind === 'unbundled_panel') ok &&= ls[0].code === '80053' && ls[1].code === '80048' && p.amountUsd === ls[1].chargeUsd;
    else if (p.kind === 'room_days') {
      const nights = (Date.parse(b.serviceTo) - Date.parse(b.serviceFrom)) / 86400000;
      ok &&= ls[0].code === '0120' && ls[0].units === nights + 1 && Math.abs(ls[0].chargeUsd / ls[0].units - (p.amountUsd ?? 0)) < 0.01;
    } else if (p.kind === 'unlisted_supplies') ok &&= ls[0].code === null && /suppl/i.test(ls[0].description);
  }
}
check('planted problems point at the right lines with the right amounts', ok);
check('no duplicates except the planted ones', bills.every((b) => {
  const keys = b.lines.map((l) => `${l.date}|${l.code}|${l.chargeUsd}`).filter((k) => !k.includes('|null|'));
  const dupCount = keys.length - new Set(keys).size;
  return dupCount === b.planted.filter((p) => p.kind === 'duplicate').length;
}));
const all = JSON.stringify([bills, Array.from({ length: 20 }, (_, i) => [makeEob(i + 1), makeDenial(i + 1)])]);
check('addresses are marked (sample) and phone numbers are 555-01xx', bills.every((b) => b.providerAddress.endsWith('(sample)') && /^\(555\) 555-01\d\d$/.test(b.billingPhone)));
check('no real insurer or hospital names', !/Aetna|Cigna|UnitedHealth|Humana|Anthem|Blue Cross|Kaiser|Mayo|HCA|Optum/.test(all));
check('no em dashes', !all.includes('—'));
check('EOB: you owe = allowed - plan paid per line, and the total adds up', Array.from({ length: 20 }, (_, i) => makeEob(i + 1)).every((e) => e.lines.every((l) => Math.abs(l.allowedUsd - l.planPaidUsd - l.youOweUsd) < 0.01) && Math.abs(e.lines.reduce((t, l) => t + l.youOweUsd, 0) - e.totalYouOweUsd) < 0.01));

console.log(failures === 0 ? '\nSYNTH MODEL: ALL PASS' : `\nSYNTH MODEL: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
