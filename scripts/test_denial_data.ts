// Free data loaders Part A (docs/kimi/free_data_loaders.md): the TiC PUF
// reader on a fixture, suppressed values, the prior auth template import
// with the EXAMPLE row skipped, lookups carrying source and year, and the
// response layer never turning these numbers into a personal prediction.
// No network, no database.
// Run: npx tsx scripts/test_denial_data.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSharedStrings, parseSheetRows, rowsToObjects } from '../lib/data/xlsx';
import { parseCsv } from '../lib/data/csv';
import { aggregateTic, describeDenialStats, parseTicValue, summarizeDenialRow, validatePriorAuthRow, TIC_SOURCE_LABEL } from '../lib/data/denial';
import { buildAllowedFacts, findUnmatchedClaims } from '../lib/groundingGuard';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// --- XLSX fixture: shared strings + a sheet with a title row, a legend,
// the header, two plans of one issuer, one of another, and a blank row.
const shared = parseSharedStrings(
  '<sst><si><t>Individual Marketplace QHPs</t></si><si><t>State</t></si><si><t>Issuer_Name</t></si><si><t>Issuer_ID</t></si>' +
    '<si><t>Issuer_Claims_Received_In_Network</t></si><si><t>Issuer_Claims_Denied_In_Network</t></si><si><t>Plan_Number_Claims_Denied_Referral_Required</t></si>' +
    '<si><t>Plan_Number_Claims_Denied_Other</t></si><si><t>Fixture Health &amp; Co</t></si><si><r><t>Sample </t></r><r><t>Mutual</t></r></si>' +
    '<si><t>**</t></si><si><t>N/A</t></si><si><t>Issuer_Claims_Received_Out_of_Network</t></si><si><t>Issuer_Claims_Denied_Out_of_Network</t></si></sst>',
);
check('shared strings: entities and rich-text runs', shared[8] === 'Fixture Health & Co' && shared[9] === 'Sample Mutual');
const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c></row>
<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>4</v></c><c r="E3" t="s"><v>5</v></c><c r="F3" t="s"><v>6</v></c><c r="G3" t="s"><v>7</v></c><c r="H3" t="s"><v>12</v></c><c r="I3" t="s"><v>13</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>MO</t></is></c><c r="B4" t="s"><v>8</v></c><c r="C4"><v>11111</v></c><c r="D4"><v>1000</v></c><c r="E4"><v>150</v></c><c r="F4"><v>12</v></c><c r="G4"><v>30</v></c><c r="H4"><v>200</v></c><c r="I4"><v>50</v></c></row>
<row r="5"><c r="A5" t="inlineStr"><is><t>MO</t></is></c><c r="B5" t="s"><v>8</v></c><c r="C5"><v>11111</v></c><c r="D5"><v>1000</v></c><c r="E5"><v>150</v></c><c r="F5" t="s"><v>10</v></c><c r="G5"><v>5</v></c><c r="H5"><v>200</v></c><c r="I5"><v>50</v></c></row>
<row r="6"><c r="A6" t="inlineStr"><is><t>KS</t></is></c><c r="B6" t="s"><v>9</v></c><c r="C6"><v>22222</v></c><c r="D6" t="s"><v>10</v></c><c r="E6"><v>7</v></c><c r="F6" t="s"><v>11</v></c><c r="G6" t="s"><v>11</v></c><c r="H6"><v>3</v></c><c r="I6"><v>1</v></c></row>
<row r="7"><c r="A7"/><c r="B7"/></row>
</sheetData></worksheet>`;
const objs = rowsToObjects(parseSheetRows(sheet, shared), (r) => Object.values(r).includes('Issuer_ID'));
check('sheet: header found below the title, blank rows dropped', objs.length === 3 && objs[0].Issuer_Name === 'Fixture Health & Co');

// --- Values as the PUF writes them ---
check('"**" = suppressed, stored as null', JSON.stringify(parseTicValue('**')) === '{"value":null,"flag":"suppressed"}');
check('"*" = not available, "***" = not required, "N/A" = not applicable', parseTicValue('*').flag === 'not_available' && parseTicValue('***').flag === 'not_required' && parseTicValue('N/A').flag === 'not_applicable');
check('numbers with commas parse; negatives and words never coerced', parseTicValue('1,234').value === 1234 && parseTicValue('-3').flag === 'unparseable' && parseTicValue('lots').flag === 'unparseable');

// --- Aggregation per issuer ---
const { issuers, skipped } = aggregateTic(objs, { market: 'individual_qhp', planYear: 2024, fileYear: 2026 });
const mo = issuers.find((i) => i.issuer_id === '11111')!;
const ks = issuers.find((i) => i.issuer_id === '22222')!;
check('one row per issuer and state; plan year is the year the data covers', issuers.length === 2 && mo.plan_year === 2024 && mo.file_year === 2026 && skipped.length === 0);
check('issuer-level counts taken once, not summed across plans', mo.claims_received_in === 1000 && mo.claims_denied_in === 150);
check('plan-level reasons summed across the issuer plans', mo.denied_other === 35 && mo.plans_count === 2);
check('a suppressed plan reason makes the sum a floor (reasons_partial)', mo.denied_prior_auth === 12 && mo.reasons_partial === true);
check('suppressed issuer value stored as null with its flag', ks.claims_received_in === null && ks.value_flags.claims_received_in === 'suppressed');
check('N/A reasons stay null and are not counted as partial', ks.denied_prior_auth === null && ks.reasons_partial === false);

// --- Prior auth template import ---
const tpl = parseCsv(readFileSync(join(__dirname, '..', 'docs', 'research', 'prior_auth_metrics_template.csv'), 'utf8'));
check('template has every column and exactly one EXAMPLE row', tpl.header.includes('captured_by') && tpl.rows.length === 1);
check('import skips the EXAMPLE row', 'skip' in validatePriorAuthRow(tpl.rows[0].values, tpl.rows[0].line));
const good = { example: '', payer: 'Plan A', program: 'MA', reporting_level: 'contract', reporting_unit: 'H1', state: 'MO', report_year: '2025', pct_standard_approved: '91.2', pct_standard_denied: '8.8', pct_standard_approved_after_appeal: '', pct_expedited_approved: '', pct_expedited_denied: '', avg_decision_time: '4.5', median_decision_time: '', decision_time_unit: 'days', source_url: 'https://plan-a.example/pa-metrics', retrieved_date: '2026-04-02', captured_by: 'manual' };
const ok = validatePriorAuthRow(good, 2);
check('a valid row is accepted with numbers as reported', 'row' in ok && ok.row.pct_standard_approved === 91.2 && ok.row.avg_decision_time === 4.5 && ok.row.pct_expedited_denied === null);
for (const [field, val, why] of [
  ['program', 'Commercial', 'program'],
  ['pct_standard_denied', '140', 'percent'],
  ['decision_time_unit', '', 'unit'],
  ['source_url', 'plan website', 'source_url'],
  ['retrieved_date', '04/02/2026', 'retrieved_date'],
  ['report_year', '2019', 'report_year'],
] as const) {
  const r = validatePriorAuthRow({ ...good, [field]: val }, 7);
  check(`bad ${field} rejected with the line number, never coerced`, 'error' in r && r.error.startsWith('line 7:') && r.error.includes(why === 'percent' ? 'percent' : why), 'error' in r ? r.error : 'accepted');
}
const csvTricky = parseCsv('a,b\n"x, y","say ""hi"""\n\n1,2\n');
check('CSV: quoted commas, doubled quotes, blank lines', csvTricky.rows.length === 2 && csvTricky.rows[0].values.a === 'x, y' && csvTricky.rows[0].values.b === 'say "hi"');

// --- Lookups carry their source and year; wording is never personal ---
const row = { ...mo, claims_received_out: 0, claims_denied_out: 0, issuer_name: 'Fixture Health & Co', value_flags: {} };
const s = summarizeDenialRow(row);
const src = { label: TIC_SOURCE_LABEL(2024), url: 'https://download.cms.gov/marketplace-puf/2026/transparency-in-coverage-puf.zip', dataYear: 2024 };
const said = describeDenialStats(s, src);
check('summary: denial rate from the insurer totals', s.denialRatePct === 15 && s.claimsDenied === 150 && s.claimsReceived === 1000);
check('description names the source and the data year', said.includes('plan year 2024') && said.includes('in 2024') && said.includes('Source: CMS Transparency in Coverage'));
check('description says these are totals, not a prediction', /not a prediction for any one claim/.test(said));
check('description never phrases it as a personal chance', !/your (claim|chance|appeal)|chance (that|of) your|\d+% chance/i.test(said), said);
const withheld = describeDenialStats(summarizeDenialRow({ ...ks, value_flags: { claims_received_in: 'suppressed' } }), src);
check('withheld totals: says so instead of computing a rate', /isn't public/.test(withheld) && !/% of the claims/.test(withheld));

// --- Grounding guard ---
const facts = buildAllowedFacts({ retrievedContext: { denial_stats: s, source: src }, profile: null });
const fine = 'Fixture Health & Co denied 15% of the claims it received in 2024 (150 of 1000), per CMS.';
check('guard accepts the lookup numbers when they are in the context', findUnmatchedClaims(fine, facts).length === 0, findUnmatchedClaims(fine, facts).join(', '));
for (const bad of [
  'There is a 15% chance your claim is denied.',
  'The odds that your appeal succeeds are good here.',
  'Based on this, your claim will be denied.',
  'Your appeal is likely to be approved.',
]) {
  check(`guard rejects a personal prediction: "${bad}"`, findUnmatchedClaims(bad, facts).some((x) => x.startsWith('personal prediction')));
}
check('guard still allows plain insurer facts about appeals', !findUnmatchedClaims('Many people who appeal win; this insurer overturned some appeals in 2024.', facts).some((x) => x.startsWith('personal')));

console.log(failures === 0 ? '\nDENIAL DATA: ALL PASS' : `\nDENIAL DATA: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
