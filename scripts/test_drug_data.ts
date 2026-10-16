// Drug data depth (docs/kimi/DRUG_DATA_TOP200.md): pure parsing and
// matching on small fixtures. No network, no database.
// Run: npx tsx scripts/test_drug_data.ts

import {
  componentsIn,
  displayBrand,
  fdaDate,
  genericComponents,
  latestYear,
  matchExistingDrug,
  nadacWindowStart,
  packagesFor,
  parseGazetteer,
  parseTsv,
  productsFor,
  rxcuiFrom,
  substancesMatch,
  topBySpending,
  type FdaProduct,
} from '../lib/drugdata/parse';
import { createNadacAdapter, pickNadacDataset, NADAC_2026_DATASET_ID } from '../lib/pricing/adapters/nadac';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// --- Part D grouping (CMS rows are per presentation) ---
const row = (b: string, g: string, s: number, m = 'Overall') => ({ Brnd_Name: b, Gnrc_Name: g, Mftr_Name: m, Tot_Spndng_2023: '1', Tot_Spndng_2024: String(s) });
const partd = [
  row('Humira(Cf) Pen', 'Adalimumab', 400),
  row('Humira Pen', 'Adalimumab', 300),
  row('Humira(Cf)', 'Adalimumab', 100),
  row('Humira(Cf) Pen', 'Adalimumab', 999, 'AbbVie US LLC'),
  row('Dupixent Pen', 'Dupilumab', 200),
  row('Dupixent Syringe', 'Dupilumab', 150),
  row('Atorvastatin Calcium', 'Atorvastatin Calcium', 500),
  row('Lipitor', 'Atorvastatin Calcium', 50),
  row('Novolog Flexpen', 'Insulin Aspart', 120),
  row('Novolog Mix 70-30 Flexpen', 'Insulin Aspart Prot/Insuln Asp', 90),
  row('Insulin Lispro', 'Insulin Lispro', 80),
  row('Insulin Glargine', 'Insulin Glargine', 70),
  row('Stelara*', 'Ustekinumab', 60),
  row('Zero', 'Zero', 0),
];
check('latest year read from the columns', latestYear(partd[0]) === 2024);
const top = topBySpending(partd, 2024, 20);
const by = (b: string) => top.find((t) => t.brand === b);
check('presentations of one brand are one drug (Humira: 3 Overall rows summed)', by('Humira')?.spending === 800 && by('Humira')?.members.length === 3);
check('manufacturer rows are not counted (only Overall)', !top.some((t) => t.spending > 999));
check('Dupixent pen + syringe -> "Dupixent"', by('Dupixent')?.spending === 350);
check('"Stelara*" -> "Stelara"', !!by('Stelara'));
check('a generic and its brand stay separate drugs', !!by('Atorvastatin Calcium') && !!by('Lipitor'));
check('different insulins stay separate', !!by('Insulin Lispro') && !!by('Insulin Glargine'));
check('a mix product with the same brand word gets its full CMS name', !!by('Novolog') && !!by('Novolog Mix 70-30 Flexpen'));
check('ranked by summed spending, zero-spend rows dropped', top[0].brand === 'Humira' && top[0].rank === 1 && !by('Zero'));
check('display brand keeps CMS capitalization', displayBrand('Humira(Cf) Pen') === 'Humira' && displayBrand('Trelegy Ellipta') === 'Trelegy');

// --- Generic components ---
check('salt words dropped: "Atorvastatin Calcium" -> atorvastatin', genericComponents('Atorvastatin Calcium').join() === 'atorvastatin');
check('combination split on "/" (CMS truncation kept)', genericComponents('Fluticasone/Umeclidin/Vilanter').join() === 'fluticasone,umeclidin,vilanter');
check('insulins keep both words', genericComponents('Insulin Aspart').join() === 'insulin aspart');

// --- Matching existing drugs ---
const existing = [
  { id: 'a', name: 'atorvastatin', brand_names: ['Lipitor'], generic_name: null },
  { id: 'n', name: 'Fiasp / NovoLog (insulin)', brand_names: null, generic_name: null },
  { id: 'e', name: 'Eliquis', brand_names: ['Eliquis'], generic_name: null },
];
check('generic entry matches an existing generic by ingredients', JSON.stringify(matchExistingDrug({ brand: 'Atorvastatin Calcium', generic: 'Atorvastatin Calcium' }, existing)) === '{"id":"a"}');
check('brand entry matches an alias (Lipitor)', JSON.stringify(matchExistingDrug({ brand: 'Lipitor', generic: 'Atorvastatin Calcium' }, existing)) === '{"id":"a"}');
check('brand entry matches a whole word of a combined demo name (NovoLog)', JSON.stringify(matchExistingDrug({ brand: 'Novolog', generic: 'Insulin Aspart' }, existing)) === '{"id":"n"}');
check('no match -> create', 'create' in matchExistingDrug({ brand: 'Ozempic', generic: 'Semaglutide' }, existing));
const two = [...existing, { id: 'x', name: 'Atorvastatin Calcium', brand_names: null, generic_name: null }];
check('two candidates -> ambiguous (review, never guessed)', 'ambiguous' in matchExistingDrug({ brand: 'Atorvastatin Calcium', generic: 'Atorvastatin Calcium' }, two));

// --- FDA NDC Directory ---
check('substances: single ingredient with a salt form', substancesMatch('Atorvastatin Calcium', 'ATORVASTATIN CALCIUM TRIHYDRATE'));
check('substances: a combination is not the single drug (Caduet)', !substancesMatch('Atorvastatin Calcium', 'AMLODIPINE BESYLATE; ATORVASTATIN CALCIUM TRIHYDRATE'));
check('substances: NovoLog Mix is not NovoLog', !substancesMatch('Insulin Aspart', 'INSULIN ASPART PROTAMINE; INSULIN ASPART') && substancesMatch('Insulin Aspart', 'INSULIN ASPART'));
check('substances: truncated CMS combo matches FDA (Trelegy)', substancesMatch('Fluticasone/Umeclidin/Vilanter', 'FLUTICASONE FUROATE; UMECLIDINIUM BROMIDE; VILANTEROL TRIFENATATE'));
check('substances: insulin lispro is not insulin glargine', !substancesMatch('Insulin Lispro', 'INSULIN GLARGINE'));

const productTsv = [
  'PRODUCTID\tPRODUCTNDC\tPRODUCTTYPENAME\tPROPRIETARYNAME\tNONPROPRIETARYNAME\tDOSAGEFORMNAME\tROUTENAME\tMARKETINGCATEGORYNAME\tLABELERNAME\tSUBSTANCENAME\tACTIVE_NUMERATOR_STRENGTH\tACTIVE_INGRED_UNIT\tENDMARKETINGDATE',
  'P1\t0003-0894\tHUMAN PRESCRIPTION DRUG\tEliquis\tapixaban\tTABLET, FILM COATED\tORAL\tNDA\tE.R. Squibb\tAPIXABAN\t5\tmg/1\t',
  'P2\t0071-0155\tHUMAN PRESCRIPTION DRUG\tLipitor\tatorvastatin calcium\tTABLET\tORAL\tNDA\tPfizer\tATORVASTATIN CALCIUM TRIHYDRATE\t40\tmg/1\t',
  'P3\t0000-1111\tHUMAN PRESCRIPTION DRUG\tAtorvastatin Calcium\tatorvastatin calcium\tTABLET\tORAL\tANDA\tGeneric Co\tATORVASTATIN CALCIUM TRIHYDRATE\t20\tmg/1\t',
  'P4\t0069-2150\tHUMAN PRESCRIPTION DRUG\tCaduet\tamlodipine besylate and atorvastatin calcium\tTABLET\tORAL\tNDA\tPfizer\tAMLODIPINE BESYLATE; ATORVASTATIN CALCIUM TRIHYDRATE\t5; 10\tmg/1; mg/1\t',
  'P5\t0000-2222\tHUMAN OTC DRUG\tAtorvastatin OTC\tatorvastatin\tTABLET\tORAL\tOTC\tX\tATORVASTATIN\t10\tmg/1\t',
].join('\n');
const products = parseTsv(productTsv) as unknown as FdaProduct[];
check('TSV parsed with headers', products.length === 5 && products[0].PROPRIETARYNAME === 'Eliquis');
check('brand entry -> its own products only (Eliquis)', productsFor({ brand: 'Eliquis', generic: 'Apixaban' }, products).map((p) => p.PRODUCTID).join() === 'P1');
check('generic entry -> every single-ingredient Rx product (brand + generic), not Caduet, not OTC', productsFor({ brand: 'Atorvastatin Calcium', generic: 'Atorvastatin Calcium' }, products).map((p) => p.PRODUCTID).join() === 'P2,P3');
check('brand entry Lipitor -> only Lipitor', productsFor({ brand: 'Lipitor', generic: 'Atorvastatin Calcium' }, products).map((p) => p.PRODUCTID).join() === 'P2');
const packages = parseTsv(['PRODUCTID\tPRODUCTNDC\tNDCPACKAGECODE\tPACKAGEDESCRIPTION\tENDMARKETINGDATE', 'P1\t0003-0894\t0003-0894-21\t60 TABLET in 1 BOTTLE\t', 'P1\t0003-0894\tbad-code\tx\t', 'P1\t0003-0894\t0003-0894-70\t100 TABLET\t20251231', 'P9\tx\t1234-5678-90\ty\t'].join('\n'));
const pk = packagesFor([products[0]], packages);
check('package codes -> 11-digit NDCs (4-4-2 padded)', pk.rows.map((r) => r.ndc11).join() === '00003089421,00003089470');
check('unparseable package code goes to review, never guessed', pk.unparseable.join() === 'bad-code');
check('packages of other products are ignored', !pk.rows.some((r) => r.product_ndc === 'x'));
check('marketing end date read from YYYYMMDD', pk.rows[1].marketing_end_date === '2025-12-31' && fdaDate('2026') === null);
check('strength joins number and unit', pk.rows[0].strength === '5 mg/1');

// Qualifiers, suffixes, kits, salt-only names, brand exclusion.
check('biologic suffix dropped: Risankizumab-Rzaa matches RISANKIZUMAB', substancesMatch('Risankizumab-Rzaa', 'RISANKIZUMAB'));
check('comma qualifier dropped: Insulin Glargine,Hum.Rec.Anlog', substancesMatch('Insulin Glargine,Hum.Rec.Anlog', 'INSULIN GLARGINE'));
check('parenthetical and /PF dropped', genericComponents('Insulin Aspart (Niacinamide)').join() === 'insulin aspart' && genericComponents('Varicella-Zoster Ge/As01b/PF').length === 2);
check('salt-only name keeps its words: Potassium Chloride', substancesMatch('Potassium Chloride', 'POTASSIUM CHLORIDE'));
const kit = parseTsv('PRODUCTID\tPRODUCTTYPENAME\tPROPRIETARYNAME\tNONPROPRIETARYNAME\tSUBSTANCENAME\nK1\tHUMAN PRESCRIPTION DRUG\tHumira\tadalimumab\t\nK2\tHUMAN PRESCRIPTION DRUG\tOther\tadalimumab\t') as unknown as FdaProduct[];
check('a kit (no substance) matches its brand by nonproprietary name', productsFor({ brand: 'Humira', generic: 'Adalimumab' }, kit).map((p) => p.PRODUCTID).join() === 'K1');
check('a generic entry never matches a kit with no substance', productsFor({ brand: 'Adalimumab', generic: 'Adalimumab' }, kit).length === 0);
check('a generic entry leaves a separately ranked brand alone', productsFor({ brand: 'Atorvastatin Calcium', generic: 'Atorvastatin Calcium' }, products, new Set(['lipitor'])).map((p) => p.PRODUCTID).join() === 'P3');

// --- RxNorm ---
check('rxcui: one id', JSON.stringify(rxcuiFrom({ idGroup: { rxnormId: ['1364436'] } })) === '{"rxcui":"1364436"}');
check('rxcui: none -> review', 'none' in rxcuiFrom({ idGroup: {} }));
check('rxcui: several -> review', 'ambiguous' in rxcuiFrom({ idGroup: { rxnormId: ['1', '2'] } }));

// --- Census gazetteer (tab-delimited, padded last column) ---
const gaz = parseGazetteer('GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                               \n00601\t166836392\t799202\t64.416\t0.309\t18.180555\t-66.749961                      \n1234\t1\t1\t1\t1\t1\t1\n99999\t1\t1\t1\t1\t95\t1\n');
check('gazetteer: valid ZCTA kept, bad zip and impossible latitude dropped', gaz.length === 1 && gaz[0].zip === '00601' && Math.abs(gaz[0].lng + 66.749961) < 1e-9);
check('gazetteer 2025 format (pipe-delimited) parsed', parseGazetteer('GEOID|GEOIDFQ|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG\n00601|860Z200US00601|1|1|1|1|18.180555|-66.749961\n').length === 1);

// --- NADAC ---
check('NADAC window: 12 weeks before the latest as-of', nadacWindowStart('2026-10-14') === '2026-07-22');
check('NADAC dataset picked by year title', pickNadacDataset([{ identifier: 'old', title: 'NADAC (National Average Drug Acquisition Cost) 2021' }, { identifier: NADAC_2026_DATASET_ID, title: 'NADAC (National Average Drug Acquisition Cost) 2026' }], 2026) === NADAC_2026_DATASET_ID);
check('NADAC dataset: unknown year -> null (fallback used)', pickNadacDataset([], 2031) === null);
const nadac = createNadacAdapter('src').normalize([
  { ndc: '00169413212', ndc_description: 'OZEMPIC 2 MG/3 ML PEN', nadac_per_unit: '342.50000', effective_date: '2026-09-23', pricing_unit: 'ML', as_of_date: '2026-10-14' },
  { ndc: '00000000002', ndc_description: 'CREAM X', nadac_per_unit: '1.2', effective_date: '2026-09-23', pricing_unit: 'GM', as_of_date: '2026-10-14' },
  { ndc: '00000000003', ndc_description: 'Y', nadac_per_unit: '1.2', effective_date: '2026-09-23', pricing_unit: 'EA', as_of_date: '14/10/2026' },
]);
check('NADAC ML and GM units accepted (CMS field definitions)', nadac.accepted.map((a) => a.pricing_unit).join() === 'ML,GM');
check('NADAC as-of date carried', nadac.accepted[0].as_of === '2026-10-14');
check('NADAC bad as-of date rejected with a reason', nadac.rejected.length === 1 && /as_of_date/.test(nadac.rejected[0].reason));
check('NADAC stays a benchmark, never a patient price', nadac.accepted.every((a) => a.price_type === 'acquisition_benchmark'));

console.log(failures === 0 ? '\nDRUG DATA: ALL PASS' : `\nDRUG DATA: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
