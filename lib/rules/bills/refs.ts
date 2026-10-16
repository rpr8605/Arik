// Parsers for the Medicare reference files the bill checks use. Pure: file
// text in, rows out. Only code numbers and numbers are kept; CPT
// descriptions in these files are AMA copyright and are never stored.
//
// Sources (downloaded by scripts/load_bill_refs.ts into .data/ncci):
// - MUE tables, quarterly, CMS "Medicare NCCI Medically Unlikely Edits":
//   practitioner and facility outpatient hospital CSVs. Columns: code,
//   MUE value, "N <adjudication text>", rationale. Direct downloads.
// - Physician Fee Schedule relative value file (RVU26D, October 2026
//   release), PPRRVU2026_Oct_nonQPP.csv. Direct download.
// - NCCI PTP pair files: behind the AMA license page on cms.gov, so NOT
//   downloaded until the owner accepts that license. The parser follows
//   the published layout (tab-separated: column 1, column 2, prior-to-1996
//   flag, effective YYYYMMDD, deletion YYYYMMDD or *, modifier 0/1/9,
//   rationale). UNVERIFIED against a real file until then.

import type { MueRef, PfsRef, PtpRef } from './checks';

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const CODE = /^[A-Z0-9]\d{3}[A-Z0-9]$/;

export function parseMueCsv(text: string): { byCode: Record<string, MueRef>; rejects: number } {
  const byCode: Record<string, MueRef> = {};
  let rejects = 0;
  for (const line of text.split(/\r?\n/)) {
    const c = splitCsvLine(line);
    if (!CODE.test(c[0] ?? '')) continue;
    const limit = Number(c[1]);
    const mai = Number((c[2] ?? '').trim().charAt(0));
    if (!Number.isInteger(limit) || limit < 0 || ![1, 2, 3].includes(mai)) {
      rejects++;
      continue;
    }
    byCode[c[0]] = { limit, mai: mai as 1 | 2 | 3 };
  }
  return { byCode, rejects };
}

const PAID_STATUS = new Set(['A', 'R', 'T']);

export function parsePfsCsv(text: string): { byCode: Record<string, PfsRef>; conversionFactor: number | null; rejects: number } {
  const lines = text.split(/\r?\n/);
  const h = lines.findIndex((l) => l.startsWith('HCPCS,MOD,'));
  if (h < 1) throw new Error('fee schedule file: header row not found');
  const head = splitCsvLine(lines[h]);
  const above = splitCsvLine(lines[h - 1]);
  // The layout this parser reads; refuse anything else.
  if (head[11] !== 'TOTAL' || head[12] !== 'TOTAL' || head[25] !== 'FACTOR' || above[11] !== 'NON-FACILITY' || above[12] !== 'FACILITY' || head[7] !== 'INDICATOR' || head[9] !== 'INDICATOR') {
    throw new Error('fee schedule file: unexpected column layout');
  }
  const byCode: Record<string, PfsRef> = {};
  let cf: number | null = null;
  let rejects = 0;
  for (const line of lines.slice(h + 1)) {
    const c = splitCsvLine(line);
    if (!CODE.test(c[0] ?? '') || c[1] !== '' || !PAID_STATUS.has(c[3])) continue;
    const nonFac = Number(c[11]);
    const fac = Number(c[12]);
    const factor = Number(c[25]);
    if (!Number.isFinite(nonFac) || !Number.isFinite(fac) || !(factor > 0)) {
      rejects++;
      continue;
    }
    cf ??= factor;
    // "NA": the service isn't paid in that setting; use the other amount.
    const nonFacUsd = Math.round(nonFac * factor * 100) / 100;
    const facUsd = Math.round(fac * factor * 100) / 100;
    byCode[c[0]] = {
      nonFacilityUsd: c[7] === 'NA' ? facUsd : nonFacUsd,
      facilityUsd: c[9] === 'NA' ? nonFacUsd : facUsd,
    };
  }
  return { byCode, conversionFactor: cf, rejects };
}

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

export function parsePtpTxt(text: string): { pairs: PtpRef[]; rejects: number } {
  const pairs: PtpRef[] = [];
  let rejects = 0;
  for (const line of text.split(/\r?\n/)) {
    const c = line.split('\t').map((x) => x.trim());
    if (!CODE.test(c[0] ?? '') || !CODE.test(c[1] ?? '')) continue;
    const effective = ymd(c[3]);
    const deleted = c[4] === '*' || c[4] === '' ? null : ymd(c[4]);
    const modifier = Number(c[5]);
    if (!effective || (c[4] !== '*' && c[4] !== '' && !deleted) || ![0, 1, 9].includes(modifier)) {
      rejects++;
      continue;
    }
    pairs.push({ col1: c[0], col2: c[1], modifier: modifier as 0 | 1 | 9, effective, deleted });
  }
  return { pairs, rejects };
}
