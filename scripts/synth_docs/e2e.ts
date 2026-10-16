// End to end on the SYNTHETIC bills (.data/synth): the real path a bill
// takes, with no database and no model:
//   read (on-server reader) -> "Looks right" with no edits (the same
//   parseConfirmedBill the API runs) -> bill checks -> dispute letter
//   (code templates) -> freeze (hash + PDF).
// Scores how many planted problems survive the whole trip from a picture
// or PDF to the letter, and that every letter honors the contract.
// Reference data: the MUE and fee schedule files in .data/ncci (run
// `npm run ingest -- bill_refs` once to fetch them) and a TEST FIXTURE
// pair (80053 includes 80048), since the real pair files are licensed.
//
//   npx tsx scripts/synth_docs/e2e.ts [--limit 20]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftFromReading, parseConfirmedBill } from '../../lib/production/confirm';
import { letterProblems } from '../../lib/production/contracts';
import { onServerExtractor, terminateOcr } from '../../lib/production/real/readers';
import { realBillChecks } from '../../lib/production/real/billChecks';
import { codeLetterDrafter } from '../../lib/production/real/letterDrafter';
import { letterHash, letterPdf } from '../../lib/letters/freeze';
import { parseMueCsv, parsePfsCsv } from '../../lib/rules/bills/refs';
import type { BillRefs } from '../../lib/rules/bills/checks';
import type { LetterInput } from '../../lib/production/types';

const ROOT = join(__dirname, '..', '..');
const SYNTH = join(ROOT, '.data', 'synth');
const NCCI = join(ROOT, '.data', 'ncci');
const li = process.argv.indexOf('--limit');
const limit = li > 0 ? Number(process.argv[li + 1]) : 20;

function refs(): BillRefs {
  const f = (dir: string, file: string) => join(NCCI, dir, file);
  const oph = f('medicare-ncci-2026-q4-facility-outpatient-hospital-services-mue-table', 'MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv');
  const pfs = f('rvu26d', 'PPRRVU2026_Oct_nonQPP.csv');
  const out: BillRefs = { ptp: { version: 'test-fixture', pairs: [{ col1: '80053', col2: '80048', modifier: 0, effective: '2000-01-01', deleted: null }] } };
  if (existsSync(oph)) out.mue = { version: 'mue-2026q4-outpatient-hospital', byCode: parseMueCsv(readFileSync(oph, 'latin1')).byCode };
  if (existsSync(pfs)) out.pfs = { version: 'pfs-rvu26d', byCode: parsePfsCsv(readFileSync(pfs, 'latin1')).byCode };
  return out;
}

const RULE = { duplicate: 'duplicate_charge', unbundled_panel: 'ncci_ptp', room_days: 'room_days', unlisted_supplies: 'ask_about' } as const;

async function main() {
  const t0 = Date.now();
  const r = refs();
  const checks = realBillChecks(async () => r);
  const truths = readdirSync(SYNTH).filter((f) => /^bill-\d+\.json$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).slice(0, limit);
  const per: { id: string; quality: string; planted: number; found: number; findings: number; letterOk: boolean | null; pdfBytes: number; note?: string }[] = [];
  for (const tf of truths) {
    if (Date.now() - t0 > 200_000) break;
    const truth = JSON.parse(readFileSync(join(SYNTH, tf), 'utf8'));
    const bytes = readFileSync(join(SYNTH, truth.file));
    const reading = await onServerExtractor.extract({ bytes: new Uint8Array(bytes), mime: truth.file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', filename: truth.file, origin: 'synthetic' });
    const confirmed = parseConfirmedBill(draftFromReading(reading));
    if ('error' in confirmed) {
      per.push({ id: truth.id, quality: truth.quality, planted: truth.planted.length, found: 0, findings: 0, letterOk: null, pdfBytes: 0, note: `confirm refused: ${confirmed.error}` });
      continue;
    }
    const bill = confirmed.bill;
    const findings = await checks.run(bill);
    // A planted problem survives if a finding of its kind points at the
    // same charge (matched by code, date and amount: line numbers can
    // shift when a reader drops or adds a row).
    let found = 0;
    for (const p of truth.planted as { kind: keyof typeof RULE; lines: number[]; amountUsd: number | null }[]) {
      const want = (p.kind === 'unbundled_panel' ? [p.lines[1]] : p.lines).map((i) => truth.lines[i]);
      const hit = findings.some((f) => f.ruleId === RULE[p.kind] && want.every((w: any) => f.lines.some((i) => {
        const l = bill.lines[i];
        return l && l.chargeUsd === w.chargeUsd && (w.code == null || l.code === w.code);
      })));
      if (hit) found++;
    }
    let letterOk: boolean | null = null;
    let pdfBytes = 0;
    if (findings.length) {
      const input: LetterInput = { type: 'billing_dispute', patient: { name: bill.header.patientName ?? 'The patient', phone: '(555) 555-0100', address: null }, recipient: { name: bill.header.provider ?? 'the hospital', address: null, fax: null }, bill, findings, date: '2026-10-16' };
      const letter = await codeLetterDrafter.draft(input);
      const problems = letterProblems(letter, input);
      letterOk = problems.length === 0;
      const pdf = await letterPdf(letter, 'October 16, 2026');
      pdfBytes = pdf.length;
      if (!letterOk) per.push({ id: truth.id, quality: truth.quality, planted: truth.planted.length, found, findings: findings.length, letterOk, pdfBytes, note: problems[0] });
      else per.push({ id: truth.id, quality: truth.quality, planted: truth.planted.length, found, findings: findings.length, letterOk, pdfBytes, note: letterHash(letter).slice(0, 12) });
    } else per.push({ id: truth.id, quality: truth.quality, planted: truth.planted.length, found, findings: 0, letterOk, pdfBytes });
  }
  await terminateOcr();
  const sum = (k: 'planted' | 'found') => per.reduce((t, d) => t + d[k], 0);
  const byQ = Object.fromEntries(['clean', 'scan', 'photo'].map((q) => {
    const d = per.filter((x) => x.quality === q);
    return [q, `${d.reduce((t, x) => t + x.found, 0)}/${d.reduce((t, x) => t + x.planted, 0)}`];
  }));
  const letters = per.filter((d) => d.letterOk != null);
  const result = {
    bills: per.length,
    seconds: Math.round((Date.now() - t0) / 1000),
    plantedFound: `${sum('found')}/${sum('planted')}`,
    byQuality: byQ,
    lettersHonorContract: `${letters.filter((d) => d.letterOk).length}/${letters.length}`,
    refused: per.filter((d) => d.note?.startsWith('confirm refused')).length,
    misses: per.filter((d) => d.found < d.planted || d.letterOk === false || d.note?.startsWith('confirm')).map((d) => `${d.id} (${d.quality}) ${d.found}/${d.planted}${d.note && !/^[0-9a-f]{12}$/.test(d.note) ? ` ${d.note}` : ''}`),
  };
  writeFileSync(join(SYNTH, 'e2e.json'), JSON.stringify({ ...result, per }, null, 2));
  console.log(JSON.stringify(result, null, 1));
}

main().catch((e) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
