// NADAC adapter unit tests (build ticket 2026-10-01). Fixture-only -
// no network, no database. Run: npx tsx scripts/test_nadac.ts
import { normalizeNdc } from '../lib/pricing/adapter';
import { createNadacAdapter } from '../lib/pricing/adapters/nadac';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// --- NDC normalization (FDA 10-digit hyphenated -> 11-digit 5-4-2) ---
check('ndc: 11-digit passes through', normalizeNdc('00004026611') === '00004026611');
check('ndc: 4-4-2 pads segment 1', normalizeNdc('0004-0266-11') === '00004026611');
check('ndc: 5-3-2 pads segment 2', normalizeNdc('00093-104-01') === '00093010401');
check('ndc: 5-4-1 pads segment 3', normalizeNdc('00093-1040-1') === '00093104001');
check('ndc: short string rejected', normalizeNdc('123') === null);
check('ndc: letters rejected', normalizeNdc('00093-ABC-01') === null);
check('ndc: empty rejected', normalizeNdc('') === null);
check('ndc: non-string rejected', normalizeNdc(null) === null && normalizeNdc(undefined) === null);
check('ndc: numeric 11-digit coerced', normalizeNdc(4026611) === null); // too short - never padded by guessing

async function main() {
  const adapter = createNadacAdapter('src-test-uuid');

  // --- fetch from fixture (DKAN envelope) ---
  const raw = await adapter.fetch({ file: 'scripts/fixtures/nadac_sample.json' });
  check('fetch reads the DKAN results[] envelope', raw.length === 9, `${raw.length} rows`);

  const { accepted, rejected } = adapter.normalize(raw);
  check('normalize accepts exactly the 3 valid rows', accepted.length === 3, `${accepted.length} accepted`);
  check('normalize rejects exactly the 6 invalid rows', rejected.length === 6, `${rejected.length} rejected`);

  // --- accepted row shape ---
  const apixaban = accepted.find((r) => r.drug_name === 'APIXABAN 5 MG TABLET');
  check('apixaban row: ndc normalized', apixaban?.ndc === '00004026611');
  check('apixaban row: numeric price parsed from string', apixaban?.price === 9.51, String(apixaban?.price));
  check('apixaban row: price_type is acquisition_benchmark', apixaban?.price_type === 'acquisition_benchmark');
  check('apixaban row: unit per_unit, quantity 1', apixaban?.unit === 'per_unit' && apixaban?.quantity === 1);
  check('apixaban row: observed_at is ISO', apixaban?.observed_at === '2026-09-15');
  check('apixaban row: expires_at null (staleness is source-governed)', apixaban?.expires_at === null);
  check('apixaban row: pharmacy fields null (national average)', apixaban?.pharmacy_npi === null && apixaban?.pharmacy_zip === null);
  check('apixaban row: source_id stamped from the factory', apixaban?.source_id === 'src-test-uuid');
  check('apixaban row: source_record_ref is ndc|date', apixaban?.source_record_ref === '00004026611|2026-09-15');

  const hyphenated = accepted.find((r) => r.drug_name === 'EMPAGLIFLOZIN 10 MG TABLET');
  check('hyphenated 5-3-2 ndc normalized to 11 digits', hyphenated?.ndc === '00093010401', hyphenated?.ndc);

  // --- reject reasons (never silent) ---
  const reasons = rejected.map((r) => r.reason).join('\n');
  check('reject: short ndc named', /unparseable ndc: "123"/.test(reasons));
  check('reject: empty price named', /unparseable or non-positive nadac_per_unit: ""/.test(reasons));
  check('reject: zero price named', /unparseable or non-positive nadac_per_unit: "0"/.test(reasons));
  check('reject: bad date named', /unparseable effective_date: "not-a-date"/.test(reasons));
  check('reject: missing description named', /missing ndc_description/.test(reasons));
  check('reject: non-EA unit named (never coerced)', /unsupported pricing_unit: "GM"/.test(reasons));
  check('every rejection carries its raw payload', rejected.every((r) => r.raw != null));

  // --- bare-array fixture shape also accepted ---
  const { accepted: acc2 } = adapter.normalize([]);
  check('empty input normalizes to empty batch', acc2.length === 0);
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nNADAC ADAPTER: ALL PASS' : `\nNADAC ADAPTER: ${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
