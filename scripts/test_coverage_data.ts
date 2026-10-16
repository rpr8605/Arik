// Free data loaders Part B (docs/kimi/free_data_loaders.md): Medicare
// Coverage Database documents built per the MCD data dictionary, codes
// only (no CPT descriptions), HTML stripped, drafts and retired rules never
// offered, and getCoverageRule's selection. Fixtures only, no network.
// Run: npx tsx scripts/test_coverage_data.ts

import { buildMacDocs, buildNcdDocs, excerpt, isProcedureCode, nextThursday, pickCoverageRules, stripHtml } from '../lib/data/coverage';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const states = [
  { state_id: '1', state_abbrev: 'FL' },
  { state_id: '2', state_abbrev: 'GA' },
  { state_id: '3', state_abbrev: 'TX' },
];
const contractors = [
  { contractor_id: '10', contractor_type_id: '1', contractor_version: '1', contractor_bus_name: 'Fixture MAC One ', contractor_number: '09102' },
  { contractor_id: '11', contractor_type_id: '1', contractor_version: '1', contractor_bus_name: 'Fixture MAC Two', contractor_number: '04412' },
];
const contractorJurisdiction = [
  { contractor_id: '10', contractor_type_id: '1', contractor_version: '1', state_id: '1' },
  { contractor_id: '11', contractor_type_id: '1', contractor_version: '1', state_id: '3' },
];
const lcdDocs = [
  { lcd_id: '30001', lcd_version: '7', title: 'Fixture <b>Sleep</b> Devices', status: 'A', display_id: '', rev_eff_date: '2026-01-01 00:00:00', orig_det_eff_date: '2015-10-01 00:00:00', date_retired: '', ent_det_end_date: '', indication: '<p>For any item to be covered, it must be reasonable &amp; necessary.</p><ul><li>Rule one.</li></ul>' },
  { lcd_id: '30002', lcd_version: '1', title: 'Fixture Draft Rule', status: 'P', display_id: '39999', rev_eff_date: '', orig_det_eff_date: '', date_retired: '', ent_det_end_date: '', indication: '' },
  { lcd_id: '30003', lcd_version: '3', title: 'Fixture Two-MAC Rule', status: 'A', display_id: '', rev_eff_date: '2025-05-01', orig_det_eff_date: '', date_retired: '', ent_det_end_date: '', indication: 'Covered when documented.' },
];
const lcd = buildMacDocs('LCD', {
  docs: lcdDocs,
  xContractor: [
    { lcd_id: '30001', lcd_version: '7', contractor_id: '10', contractor_type_id: '1', contractor_version: '1' },
    { lcd_id: '30003', lcd_version: '3', contractor_id: '10', contractor_type_id: '1', contractor_version: '1' },
    { lcd_id: '30003', lcd_version: '3', contractor_id: '11', contractor_type_id: '1', contractor_version: '1' },
  ],
  primaryJurisdiction: [
    { lcd_id: '30001', lcd_version: '7', state_id: '1' },
    { lcd_id: '30001', lcd_version: '7', state_id: '2' },
    { lcd_id: '30003', lcd_version: '3', state_id: '2' },
  ],
  hcpc: [
    { lcd_id: '30001', lcd_version: '7', hcpc_code_id: 'E0601', range: 'N', long_description: 'COPYRIGHTED CPT TEXT' },
    { lcd_id: '30001', lcd_version: '7', hcpc_code_id: '94660', range: 'B', long_description: 'COPYRIGHTED CPT TEXT' },
    { lcd_id: '30001', lcd_version: '7', hcpc_code_id: 'not-a-code', range: 'N' },
  ],
  contractors,
  contractorJurisdiction,
  states,
});
const [a, draft, two] = lcd;
check('LCD id gets the "L" prefix; a draft gets "DL" + display_id and is marked', a.display_id === 'L30001' && draft.display_id === 'DL39999' && draft.is_draft);
check('one contractor: states from the document primary jurisdiction', a.jurisdictions.join() === 'FL,GA');
check('several contractors: states from each contractor jurisdiction (not the primary table)', two.jurisdictions.join() === 'FL,TX', two.jurisdictions.join());
check('contractor named with its number, trimmed', a.contractors[0] === 'Fixture MAC One (09102)');
check('codes kept as numbers only, invalid ones dropped, no descriptions anywhere', a.hcpcs_codes.join() === '94660,E0601' && !JSON.stringify(lcd).includes('COPYRIGHTED'));
check('HTML stripped and entities decoded in title and excerpt', a.title === 'Fixture Sleep Devices' && a.citation_excerpt === 'For any item to be covered, it must be reasonable & necessary.\nRule one.'.replace(/\s+/g, ' '));
check('effective date = the current revision date', a.effective_date === '2026-01-01');
check('MCD page URL with id and version', a.source_url === 'https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=30001&ver=7');

const art = buildMacDocs('Article', {
  docs: [{ article_id: '50001', article_version: '2', title: 'Billing and Coding: Fixture', status: 'A', display_id: '', article_eff_date: '2026-02-01', article_end_date: '', date_retired: '', description: '<p>Billing text.</p>' }],
  xContractor: [{ article_id: '50001', article_version: '2', contractor_id: '11', contractor_type_id: '1', contractor_version: '1' }],
  primaryJurisdiction: [{ article_id: '50001', article_version: '2', state_id: '3' }],
  hcpc: [{ article_id: '50001', article_version: '2', hcpc_code_id: 'J9271', range: 'N' }],
  icd10Covered: [{ article_id: '50001', article_version: '2' }, { article_id: '50001', article_version: '2' }],
  related: [{ article_id: '50001', article_version: '2', r_lcd_id: '30001' }],
  contractors,
  contractorJurisdiction,
  states,
})[0];
check('Article: "A" prefix, ICD-10 codes counted not stored, linked to its LCD', art.display_id === 'A50001' && art.icd10_codes_count === 2 && art.related_documents.join() === 'L30001');

const ncd = buildNcdDocs([
  { NCD_id: '36', NCD_vrsn_num: '4', NCD_mnl_sect: '20.10', NCD_mnl_sect_title: 'Cardiac Rehabilitation Programs - RETIRED', NCD_efctv_dt: '2023-04-10 00:00:00', NCD_trmntn_dt: '', indctn_lmtn: 'x', itm_srvc_desc: '' },
  { NCD_id: '359', NCD_vrsn_num: '1', NCD_mnl_sect: '20.10.1', NCD_mnl_sect_title: 'Cardiac Rehabilitation Programs for Chronic Heart Failure', NCD_efctv_dt: '2014-02-18', NCD_trmntn_dt: '', indctn_lmtn: '<p>Covered.</p>', itm_srvc_desc: '' },
  { NCD_id: '9', NCD_vrsn_num: '2', NCD_mnl_sect: '1.1', NCD_mnl_sect_title: 'Old rule', NCD_efctv_dt: '2010-01-01', NCD_trmntn_dt: '2020-01-01', indctn_lmtn: '', itm_srvc_desc: '' },
]);
check('NCD: national, "NCD <section>" id', ncd[1].national && ncd[1].display_id === 'NCD 20.10.1');
check('NCD retired by termination date or by "RETIRED" in the title', ncd[0].status === 'R' && ncd[2].status === 'R' && ncd[1].status === 'A');

check('procedure codes: CPT, Category II/III, HCPCS Level II', ['99213', '0001F', '0042T', 'E0601', 'J9271'].every(isProcedureCode) && !['9921', 'Eliquis', 'Z00.00'].some(isProcedureCode));
check('excerpt keeps whole sentences under the limit', (excerpt('One sentence here. '.repeat(60), 120) ?? '').endsWith('here. ...'));
check('stripHtml drops scripts and tags', stripHtml('<script>x()</script><b>Hi</b>&nbsp;there') === 'Hi there');
check('next check = the next Thursday (MCD publishes Thursdays)', nextThursday('2026-10-16') === '2026-10-22' && nextThursday('2026-10-15') === '2026-10-22');

// --- getCoverageRule selection ---
const all = [...lcd, art, ...ncd];
const asOf = '2026-10-16';
const fl = pickCoverageRules(all, { code: 'E0601', text: null, state: 'FL', asOf });
check('code lookup: the LCD in force for that state', fl.length === 1 && fl[0].displayId === 'L30001' && fl[0].matchedBy === 'code' && fl[0].version === 7);
check('code lookup outside the jurisdiction: nothing', pickCoverageRules(all, { code: 'E0601', text: null, state: 'TX', asOf }).length === 0);
check('drafts are never offered as the rule in force', !pickCoverageRules(all, { code: null, text: 'Fixture Draft', state: 'FL', asOf }).some((h) => h.displayId.startsWith('D')));
const cardiac = pickCoverageRules(all, { code: null, text: 'cardiac rehabilitation', state: null, asOf });
check('name lookup: national rules, retired NCD left out', cardiac.map((h) => h.displayId).join() === 'NCD 20.10.1');
check('not yet effective: left out', pickCoverageRules([{ ...a, effective_date: '2027-01-01' }], { code: 'E0601', text: null, state: 'FL', asOf }).length === 0);
check('each hit carries id, version, date and the MCD link', fl[0].effectiveDate === '2026-01-01' && fl[0].url.includes('lcdid=30001&ver=7'));

console.log(failures === 0 ? '\nCOVERAGE DATA: ALL PASS' : `\nCOVERAGE DATA: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
