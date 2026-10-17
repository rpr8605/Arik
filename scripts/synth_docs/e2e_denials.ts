// End to end on the SYNTHETIC denial letters (.data/synth, from
// generate.ts): the real path a denial takes, with no database and no
// model: read (on-server reader, text layer or OCR) -> denial draft ->
// "Looks right" with no edits (the same parseConfirmedDenial the API runs)
// -> checks -> every letter that fits, through the letter contract.
// Scores which fields survive the trip from a PDF, scan or photo.
//
//   npx tsx scripts/synth_docs/e2e_denials.ts [--limit 12]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onServerExtractor, terminateOcr } from '../../lib/production/real/readers';
import { parseDenialText } from '../../lib/rules/denials/parse';
import { parseConfirmedDenial } from '../../lib/rules/denials/confirm';
import { runDenialChecks } from '../../lib/rules/denials/checks';
import { buildDenialLetter, denialLetterOptions, denialLetterProblems } from '../../lib/letters/denialTemplates';
import { joinBody } from '../../lib/letters/templates';
import { LETTER_FOOTER } from '../../lib/production/types';

const SYNTH = join(__dirname, '..', '..', '.data', 'synth');
const li = process.argv.indexOf('--limit');
const limit = li > 0 ? Number(process.argv[li + 1]) : 12;
const FIELDS = ['docType', 'noticeDate', 'dateOfService', 'claimNumber', 'serviceCode', 'category', 'planFunding', 'carc', 'deadlineDays'] as const;

async function main() {
  const t0 = Date.now();
  const truths = readdirSync(SYNTH).filter((f) => /^denial-\d+\.json$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).slice(0, limit);
  const score: Record<string, number> = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  let docs = 0;
  let letters = 0;
  let lettersOk = 0;
  const notes: string[] = [];
  for (const tf of truths) {
    if (Date.now() - t0 > 200_000) {
      notes.push('stopped at the 200s cap');
      break;
    }
    const t = JSON.parse(readFileSync(join(SYNTH, tf), 'utf8'));
    const bytes = readFileSync(join(SYNTH, t.file));
    const reading = await onServerExtractor.extract({ bytes: new Uint8Array(bytes), mime: t.file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', filename: t.file, origin: 'synthetic' });
    docs++;
    const draft = reading.text ? parseDenialText(reading.text) : null;
    const got: Record<string, boolean> = {
      docType: reading.docType === 'denial_letter',
      noticeDate: draft?.noticeDate === t.letterDate,
      dateOfService: draft?.dateOfService === t.serviceDate,
      claimNumber: draft?.claimNumber === t.claimNumber,
      serviceCode: draft?.serviceCode === t.code,
      category: draft?.category === t.category,
      planFunding: draft?.planFunding === t.planFunding,
      carc: (draft?.carcCodes.join() ?? '') === (t.carc ?? ''),
      deadlineDays: draft?.letterDeadlineDays === t.appealDays,
    };
    for (const f of FIELDS) if (got[f]) score[f]++;
    const missed = FIELDS.filter((f) => !got[f]);
    console.log(`${t.id} (${t.quality}): ${missed.length ? `missed ${missed.join(', ')}` : 'all fields'}`);
    if (!draft) continue;
    // The patient would fix a missed date on the confirm screen; with no
    // date the confirm step refuses, as it should.
    const confirmed = parseConfirmedDenial(draft, new Date('2026-12-31T12:00:00Z'));
    if ('error' in confirmed) {
      notes.push(`${t.id}: confirm refused (${confirmed.error}), the patient would fill it in`);
      continue;
    }
    const { flags } = runDenialChecks(confirmed.denial, '2026-10-17');
    for (const type of denialLetterOptions(confirmed.denial, flags)) {
      const input = { type, patient: { name: t.memberName, phone: null }, denial: confirmed.denial, flags, context: { coverageRules: null, planDocumentOnFile: false }, date: '2026-10-17' };
      const parts = buildDenialLetter(input);
      const probs = denialLetterProblems({ subject: parts.subject, body: joinBody(parts), footer: LETTER_FOOTER }, input);
      letters++;
      if (probs.length === 0) lettersOk++;
      else notes.push(`${t.id} ${type}: ${probs.join('; ')}`);
    }
  }
  await terminateOcr();
  console.log(`\n${docs} denial letters read in ${Math.round((Date.now() - t0) / 1000)}s`);
  for (const f of FIELDS) console.log(`  ${f}: ${score[f]}/${docs}`);
  console.log(`letters honoring the contract: ${lettersOk}/${letters}`);
  for (const n of notes) console.log(`  note: ${n}`);
  process.exit(lettersOk === letters ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await terminateOcr().catch(() => {});
  process.exit(1);
});
