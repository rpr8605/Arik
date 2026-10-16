// Benchmark-only answer (DRUG_DATA_TOP200.md Step 5): a NADAC figure is
// always worded as what pharmacies pay, never the patient's price, with a
// "no verified price" line and exactly one next step.
// Run: npx tsx scripts/test_benchmark_answer.ts

import { benchmarkOnlyAnswer, summarizeBenchmarks } from '../lib/benchmarkAnswer';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const rows = [
  { price_usd: '0.04210', pricing_unit: 'EA', as_of_date: '2026-10-14' },
  { price_usd: '0.06800', pricing_unit: 'EA', as_of_date: '2026-10-14' },
  { price_usd: '0.09000', pricing_unit: 'EA', as_of_date: '2026-10-07' },   // older week: ignored
  { price_usd: '1.50000', pricing_unit: 'ML', as_of_date: '2026-10-14' },   // a second unit: its own line
];
const s = summarizeBenchmarks(rows);
check('latest week only, one line per unit (most rows first), low to high', s?.asOf === '2026-10-14' && s.units[0].unit === 'EA' && s.units[0].low === 0.0421 && s.units[0].high === 0.068 && s.units[1].unit === 'ML', JSON.stringify(s));
const mixed = [
  { price_usd: '0.02283', pricing_unit: 'EA', as_of_date: '2026-10-14', rate_class: 'G' },
  { price_usd: '0.06926', pricing_unit: 'EA', as_of_date: '2026-10-14', rate_class: 'G' },
  { price_usd: '19.11', pricing_unit: 'EA', as_of_date: '2026-10-14', rate_class: 'B' },
];
check('a generic uses NADAC generic rows, not the brand version', JSON.stringify(summarizeBenchmarks(mixed, false)?.units) === '[{"unit":"EA","low":0.02283,"high":0.06926}]');
check('a brand uses its brand rows', summarizeBenchmarks(mixed, true)?.units[0].low === 19.11);

const generic = benchmarkOnlyAnswer({ drug: 'Atorvastatin Calcium', isBrand: false, rows: rows.slice(0, 3), lang: 'en' })!;
check('says there is no verified price you would pay', generic.startsWith("I don't have a verified price you'd pay for Atorvastatin Calcium yet."));
check('benchmark worded as what PHARMACIES pay, with NADAC and the week', /pharmacies pay about \$0\.04 to \$0\.07 per pill or unit for it \(NADAC, the government's survey of what pharmacies pay, week of October 14, 2026\)/.test(generic), generic);
check('cash is usually higher', /Cash prices are usually higher than that\./.test(generic));
check('30 pills at the lowest rate is pharmacy cost arithmetic, not a 30-day supply', /At that rate, 30 pills cost the pharmacy from \$1\.26\./.test(generic) && !/30-day/.test(generic));
check('generic: one next step, the pharmacy script', (generic.match(/Next step/g) ?? []).length === 1 && /What's your cash price for Atorvastatin Calcium\?/.test(generic));
check('never says "your price" or "you pay $"', !/your price|you pay \$|you'd pay \$|costs you/i.test(generic));

const brand = benchmarkOnlyAnswer({ drug: 'Ozempic', isBrand: true, rows: [{ price_usd: '342.5', pricing_unit: 'ML', as_of_date: '2026-10-14' }], lang: 'en' })!;
check('brand: next step is checking manufacturer programs', /Next step: I'll check for manufacturer programs for Ozempic\./.test(brand));
check('per milliliter, single figure, no "30" line for liquids', /about \$342\.50 per milliliter/.test(brand) && !/At that rate/.test(brand), brand);

const es = benchmarkOnlyAnswer({ drug: 'Atorvastatin Calcium', isBrand: false, rows: rows.slice(0, 3), lang: 'es' })!;
const both = benchmarkOnlyAnswer({ drug: 'Ozempic', isBrand: true, rows: [{ price_usd: '33.13', pricing_unit: 'EA', as_of_date: '2026-10-14' }, { price_usd: '331.9', pricing_unit: 'ML', as_of_date: '2026-10-14' }], lang: 'en' })!;
check('tablets and pens: both units named, never mixed into one figure', /about \$33\.13 per pill or unit, and about \$331\.90 per milliliter/.test(both), both);
check('Spanish: same shape', /^Todavía no tengo un precio verificado/.test(es) && /las farmacias pagan entre \$0\.04 y \$0\.07 por pastilla o unidad/.test(es) && /Siguiente paso: pregunte en la farmacia/.test(es), es);
check('no em dashes in either language', !/—/.test(generic + brand + es));
check('no usable rows -> null (the no-data answer is used instead)', benchmarkOnlyAnswer({ drug: 'X', isBrand: false, rows: [{ price_usd: '0', pricing_unit: 'EA', as_of_date: '2026-10-14' }, { price_usd: '1', pricing_unit: 'OZ', as_of_date: '2026-10-14' }], lang: 'en' }) === null);

console.log(failures === 0 ? '\nBENCHMARK ANSWER: ALL PASS' : `\nBENCHMARK ANSWER: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
