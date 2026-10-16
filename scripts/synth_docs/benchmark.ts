// Reader benchmark on the SYNTHETIC library only (.data/synth, made by
// generate.ts). Scores each reader against the ground truth, per field and
// per quality (clean / scan / photo). The vision reader is capped by spend:
// it stops before the running cost (from OpenRouter usage x the tier's max
// prices) passes --budget (default $1.90, under the owner's $2 cap).
//
//   npx tsx --env-file=.env.local scripts/synth_docs/benchmark.ts --reader on-server|vision [--limit 60] [--budget 1.9]
//
// Writes .data/synth/benchmark-<reader>.json and prints a summary.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onServerExtractor, terminateOcr, visionExtractor } from '../../lib/production/real/readers';
import { MODEL_TIERS } from '../../lib/modelConfig';
import type { ExtractedDocument, SourceDocument } from '../../lib/production/types';

const DIR = join(__dirname, '..', '..', '.data', 'synth');
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const readerName = arg('--reader', 'on-server');
const limit = Number(arg('--limit', '60'));
const budget = Number(arg('--budget', '1.9'));

let spend = 0;
const price = MODEL_TIERS.extraction.maxPrice;
const extractor = readerName === 'vision'
  ? visionExtractor((u) => {
      spend += (u.promptTokens / 1e6) * price.prompt + (u.completionTokens / 1e6) * price.completion;
    })
  : onServerExtractor;

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const eqMoney = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005;

interface Tally {
  [field: string]: { ok: number; n: number };
}
const tally: Record<string, Tally> = {};
const bump = (q: string, f: string, ok: boolean) => {
  tally[q] ??= {};
  tally[q][f] ??= { ok: 0, n: 0 };
  tally[q][f].n++;
  if (ok) tally[q][f].ok++;
  tally.all ??= {};
  tally.all[f] ??= { ok: 0, n: 0 };
  tally.all[f].n++;
  if (ok) tally.all[f].ok++;
};

const misses: { id: string; field: string; want: unknown; got: unknown }[] = [];
const miss = (id: string, field: string, ok: boolean, want: unknown, got: unknown) => {
  if (!ok && misses.length < 60) misses.push({ id, field, want, got });
  return ok;
};
function score(q: string, truth: any, out: ExtractedDocument) {
  bump(q, 'docType', out.docType === truth.docType);
  const h = out.header;
  if (truth.docType === 'itemized_bill') {
    bump(q, 'patientName', miss(truth.id, 'patientName', norm(h.patientName.value) === norm(truth.patientName), truth.patientName, h.patientName.value));
    bump(q, 'accountNumber', norm(h.accountNumber.value) === norm(truth.accountNumber));
    bump(q, 'statementDate', miss(truth.id, 'statementDate', h.statementDate.value === truth.statementDate, truth.statementDate, h.statementDate.value));
    bump(q, 'serviceDates', miss(truth.id, 'serviceDates', h.serviceFrom.value === truth.serviceFrom && h.serviceTo.value === truth.serviceTo, [truth.serviceFrom, truth.serviceTo], [h.serviceFrom.value, h.serviceTo.value]));
    bump(q, 'totalCharges', eqMoney(h.totalChargesUsd.value, truth.totalChargesUsd));
    bump(q, 'amountDue', eqMoney(h.amountDueUsd.value, truth.amountDueUsd));
  } else if (truth.docType === 'eob') {
    bump(q, 'patientName', norm(h.patientName.value) === norm(truth.memberName));
    bump(q, 'accountNumber', norm(h.accountNumber.value) === norm(truth.claimNumber));
  } else if (truth.docType === 'denial_letter') {
    bump(q, 'statementDate', miss(truth.id, 'letterDate', h.statementDate.value === truth.letterDate, truth.letterDate, h.statementDate.value));
  }
  if (truth.docType === 'itemized_bill' || truth.docType === 'eob') {
    const want = truth.docType === 'eob'
      ? truth.lines.map((l: any) => ({ code: l.code, date: truth.serviceDate, units: 1, chargeUsd: l.billedUsd }))
      : truth.lines;
    const got = out.lines.map((l) => ({ code: l.code.value, date: l.date.value, units: l.units.value, chargeUsd: l.chargeUsd.value, used: false }));
    bump(q, 'lineCount', got.length === want.length);
    for (const w of want) {
      // Match on amount first (unique enough), then code.
      const m = got.find((g) => !g.used && eqMoney(g.chargeUsd, w.chargeUsd) && (w.code == null || norm(g.code) === norm(w.code))) ?? got.find((g) => !g.used && eqMoney(g.chargeUsd, w.chargeUsd));
      if (m) m.used = true;
      bump(q, 'line.found', !!m);
      bump(q, 'line.code', !!m && norm(m.code) === norm(w.code));
      bump(q, 'line.date', !!m && m.date === w.date);
      bump(q, 'line.units', !!m && m.units === w.units);
      bump(q, 'line.charge', !!m);
    }
  }
}

async function main() {
  const truths = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('benchmark')).sort().slice(0, limit);
  const t0 = Date.now();
  let done = 0;
  let stoppedForBudget = false;
  const perDoc: { id: string; quality: string; ms: number; error?: string }[] = [];
  for (const tf of truths) {
    if (readerName === 'vision' && spend >= budget) {
      stoppedForBudget = true;
      break;
    }
    if (Date.now() - t0 > 200_000) break; // stay inside the 4-minute rule; rerun with --skip to continue
    const truth = JSON.parse(readFileSync(join(DIR, tf), 'utf8'));
    const bytes = readFileSync(join(DIR, truth.file));
    const doc: SourceDocument = { bytes: new Uint8Array(bytes), mime: truth.file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', filename: truth.file, origin: 'synthetic' };
    const s = Date.now();
    try {
      score(truth.quality, truth, await extractor.extract(doc));
      perDoc.push({ id: truth.id, quality: truth.quality, ms: Date.now() - s });
    } catch (e) {
      perDoc.push({ id: truth.id, quality: truth.quality, ms: Date.now() - s, error: (e as Error).message.slice(0, 120) });
      bump(truth.quality, 'docType', false);
    }
    done++;
  }
  await terminateOcr();
  const pct = (t: { ok: number; n: number }) => `${Math.round((t.ok / t.n) * 100)}% (${t.ok}/${t.n})`;
  const summary = Object.fromEntries(Object.entries(tally).map(([q, t]) => [q, Object.fromEntries(Object.entries(t).map(([f, v]) => [f, pct(v)]))]));
  const result = {
    reader: readerName,
    documents: done,
    seconds: Math.round((Date.now() - t0) / 1000),
    spendUsd: Math.round(spend * 10000) / 10000,
    stoppedForBudget,
    errors: perDoc.filter((d) => d.error),
    summary,
    misses,
  };
  writeFileSync(join(DIR, `benchmark-${readerName}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, errors: result.errors.length, misses: misses.length }, null, 1));
}

main().catch((e) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
