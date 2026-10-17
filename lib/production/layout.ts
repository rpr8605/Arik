// Layout parser (pure): positioned words from any reader (PDF text layer,
// OCR) -> an ExtractedDocument. Readers differ only in how they find the
// words; everything about understanding a bill lives here, so it can be
// tested without a PDF engine or OCR.
//
// Coordinates are page percent (0..100), top-left origin.

import type { Box, DocType, ExtractedDocument, ExtractedLine, Field } from './types';

export interface Word {
  text: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  conf?: number;   // 0..1; text layers are 1
}

// ---------- Normalizing what OCR misreads ----------

// Speckle on scans reads as stray punctuation glued to a token
// ("-.99284", ".J1885", "01/05/2026."). Trim it before parsing.
export const trimNoise = (s: string) => s.trim().replace(/^[^A-Za-z0-9$]+/, '').replace(/[^A-Za-z0-9)%]+$/, '');

// In numeric context, letters OCR confuses with digits.
const DIGITISH: Record<string, string> = { O: '0', o: '0', D: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', B: '8', Z: '2' };
const fixDigits = (s: string) => s.replace(/[OoDIl|iSBZ]/g, (c) => DIGITISH[c] ?? c);

// "$2,644.09", "$2.644.09", "S2,644.09", "-$4,075.19", "2644.09"
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, '').replace(/[.,:;'`]+$/, '');
  if (!/[$S]?-?[$S]?[\dOoIl|]/.test(s)) return null;
  const neg = s.includes('-');
  s = s.replace(/^-/, '').replace(/^[$S]/, '').replace(/^-/, '');
  if (!/^[\dOoIl|.,]+$/.test(s)) return null;
  s = fixDigits(s);
  const m = /^(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$/.exec(s);
  if (!m) return null;
  const n = Number(`${m[1].replace(/[.,]/g, '')}.${m[2]}`);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// 01/05/26, 01/05/2026, O1/O5/2O26 -> 2026-01-05
export function parseDate(raw: string): string | null {
  const s = fixDigits(trimNoise(raw));
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 2000 || yy > 2100) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// CPT (5 digits), HCPCS level II (letter + 4 digits), revenue code (4 digits).
export function parseCode(raw: string): string | null {
  const s = trimNoise(raw);
  if (/^[A-V][\dOoIl|]{4}$/.test(s)) return s[0] + fixDigits(s.slice(1));
  const d = fixDigits(s);
  return /^\d{4,5}$/.test(d) ? d : null;
}

export function parseUnits(raw: string): number | null {
  const d = fixDigits(trimNoise(raw));
  if (!/^\d{1,2}$/.test(d)) return null;
  const n = Number(d);
  return n >= 1 && n <= 99 ? n : null;
}

// ---------- Rows ----------

export interface Row {
  words: Word[];
  text: string;
  box: Box;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function groupRows(words: Word[]): Row[] {
  const ws = words.filter((w) => /[A-Za-z0-9$]/.test(w.text));
  const tol = Math.max(0.35, median(ws.map((w) => w.h)) * 0.55);
  const rows: Word[][] = [];
  for (const w of [...ws].sort((a, b) => a.page - b.page || a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = w.y + w.h / 2;
    const row = rows.find((r) => r[0].page === w.page && Math.abs(r[0].y + r[0].h / 2 - cy) <= tol);
    if (row) row.push(w);
    else rows.push([w]);
  }
  return rows.map((r) => {
    r.sort((a, b) => a.x - b.x);
    const x0 = Math.min(...r.map((w) => w.x));
    const y0 = Math.min(...r.map((w) => w.y));
    const x1 = Math.max(...r.map((w) => w.x + w.w));
    const y1 = Math.max(...r.map((w) => w.y + w.h));
    return { words: r, text: r.map((w) => w.text).join(' '), box: { page: r[0].page, x: x0, y: y0, w: Math.max(0.1, x1 - x0), h: Math.max(0.1, y1 - y0) } };
  });
}

// Undo a small tilt (phone photos): rotate word centers so text lines are
// level. `angleDeg` comes from the reader (e.g. OCR line baselines).
export function deskew(words: Word[], angleDeg: number): Word[] {
  if (!angleDeg || Math.abs(angleDeg) < 0.2) return words;
  const a = (-angleDeg * Math.PI) / 180;
  return words.map((w) => {
    const cx = w.x + w.w / 2 - 50;
    const cy = w.y + w.h / 2 - 50;
    const nx = cx * Math.cos(a) - cy * Math.sin(a) + 50;
    const ny = cx * Math.sin(a) + cy * Math.cos(a) + 50;
    return { ...w, x: nx - w.w / 2, y: ny - w.h / 2 };
  });
}

// ---------- The document ----------

const LABELS = {
  patientName: /^(patient name|guarantor\s*\/?\s*patient|patient|member)\s*:?$/i,
  accountNumber: /^(account\s*(#|number|no\.?)?|acct\.?\s*no\.?)\s*:?$/i,
  claimNumber: /^claim\s*(number|#|no\.?)\s*:?$/i,
  statementDate: /^(statement date|date)\s*:?$/i,
  service: /^(dates of service|service dates|admit\s*-?\s*discharge|visit|date of service)\s*:?$/i,
  total: /^(total charges|total)\s*:?$/i,
  due: /^(amount due|please pay|balance due|amount you owe|total you owe the provider|patient responsibility)\s*:?$/i,
};

const field = <T>(value: T | null, conf = 1, box: Box | null = null): Field<T> => ({ value, confidence: value == null ? 0 : conf, box });
const rowConf = (ws: Word[]) => (ws.length ? ws.reduce((t, w) => t + (w.conf ?? 1), 0) / ws.length : 0);

// Label + value on one row: the label is the words up to a colon (or a
// known label phrase), the value is what follows.
function labelled(rows: Row[], re: RegExp): { value: string; row: Row; words: Word[] } | null {
  for (const r of rows) {
    // Longest label first: "Patient name:" must not stop at "Patient".
    for (let k = Math.min(4, r.words.length - 1); k >= 1; k--) {
      const label = labelText(r.words.slice(0, k));
      if (re.test(label)) {
        const rest = r.words.slice(k);
        return { value: rest.map((w) => trimNoise(w.text)).filter(Boolean).join(' ').trim(), row: r, words: rest };
      }
    }
  }
  return null;
}

// A label anywhere in the row with a value to its right (totals blocks sit
// mid-page).
function labelledAnywhere(rows: Row[], re: RegExp): { words: Word[]; row: Row } | null {
  for (const r of rows) {
    for (let i = 0; i < r.words.length; i++) {
      for (let k = Math.min(6, r.words.length - i - 1); k >= 1; k--) {
        const label = labelText(r.words.slice(i, i + k));
        if (re.test(label) && i + k < r.words.length) return { words: r.words.slice(i + k), row: r };
      }
    }
  }
  return null;
}

export function detectDocType(text: string): DocType {
  const t = text.toLowerCase();
  if (/explanation of benefits|this is not a bill/.test(t)) return 'eob';
  if (/right to appeal|not able to approve|our decision|appeal must|we denied|has been denied|notice of denial|denial of (?:coverage|payment)|coverage determination|organization determination|you can appeal/.test(t)) return 'denial_letter';
  if (/itemized|statement|description/.test(t) && /\$\s?\d/.test(t)) return 'itemized_bill';
  return 'unknown';
}

// Label words as one string: speckle trimmed, "Guarantor /Patient" joined.
const labelText = (ws: Word[]) => ws.map((w) => trimNoise(w.text)).join(' ').replace(/\s*\/\s*/g, '/');

// Who sent it: among the first rows, one that names an organization;
// otherwise the first row that isn't a document title or an address.
const TITLE_ROW = /^(itemized\s+statement|statement|itemized\s+bill|patient\s+statement|explanation\s+of\s+benefits.*|this\s+is\s+not\s+a\s+bill|invoice|sample.*)$/i;
const ORG_ROW = /\b(hospital|medical|center|centre|clinic|health|healthcare|physicians?|associates|group|plan|insurance|mutual|care|practice|laboratory|labs?|imaging|surgery)\b/i;
export function pickProvider(rows: Row[]): Row | null {
  const head = rows.slice(0, 6).filter((r) => !TITLE_ROW.test(r.text.trim()) && !/:/.test(r.text) && !/^\d/.test(r.text.trim()));
  return head.find((r) => ORG_ROW.test(r.text)) ?? head[0] ?? null;
}

export function parseDocument(words: Word[], reader: string): ExtractedDocument {
  const rows = groupRows(words);
  const all = rows.map((r) => r.text).join('\n');
  const docType = detectDocType(all);

  const name = labelled(rows, LABELS.patientName);
  const acct = labelled(rows, LABELS.accountNumber) ?? labelled(rows, LABELS.claimNumber);
  const stmt = labelled(rows, LABELS.statementDate);
  const svc = labelled(rows, LABELS.service);
  const svcDates = (svc?.words ?? []).map((w) => parseDate(w.text)).filter((d): d is string => !!d);
  const total = labelledAnywhere(rows, LABELS.total);
  const due = labelledAnywhere(rows, LABELS.due);
  const moneyOf = (ws: Word[] | undefined) => (ws ?? []).map((w) => parseMoney(w.text)).find((m) => m != null) ?? null;
  const top = pickProvider(rows);
  // Denial letters: the first date on the page is the letter date.
  const firstDate = rows.flatMap((r) => r.words).map((w) => parseDate(w.text)).find((d) => !!d) ?? null;

  const header = {
    patientName: field(name ? name.value.replace(/^dear\s+/i, '').replace(/,$/, '') : null, name ? rowConf(name.words) : 0, name?.row.box ?? null),
    provider: field(top ? top.text : null, top ? rowConf(top.words) : 0, top?.box ?? null),
    accountNumber: field(acct ? acct.value.split(' ')[0] : null, acct ? rowConf(acct.words) : 0, acct?.row.box ?? null),
    statementDate: field((stmt ? parseDate(stmt.value.split(' ')[0]) : null) ?? (docType === 'denial_letter' ? firstDate : null), stmt ? rowConf(stmt.words) : 0.6, stmt?.row.box ?? null),
    serviceFrom: field(svcDates[0] ?? null, svc ? rowConf(svc.words) : 0, svc?.row.box ?? null),
    serviceTo: field(svcDates[1] ?? svcDates[0] ?? null, svc ? rowConf(svc.words) : 0, svc?.row.box ?? null),
    totalChargesUsd: field(moneyOf(total?.words), total ? rowConf(total.words) : 0, total?.row.box ?? null),
    amountDueUsd: field(moneyOf(due?.words), due ? rowConf(due.words) : 0, due?.row.box ?? null),
  };

  // Line items: rows with a code and an amount, not a label row.
  const labelRow = new Set([name, acct, stmt, svc].filter(Boolean).map((x) => x!.row));
  const totalsY = Math.min(...[total?.row.box.y, due?.row.box.y].filter((v): v is number => v != null), 101);
  const lines: ExtractedLine[] = [];
  for (const r of rows) {
    if (labelRow.has(r) || r.box.y >= totalsY - 0.3) continue;
    const toks = r.words;
    const monies = toks.map((w, i) => ({ i, v: parseMoney(w.text) })).filter((m) => m.v != null && m.v >= 0);
    if (!monies.length) continue;
    const dateTok = toks.map((w, i) => ({ i, v: parseDate(w.text) })).find((d) => d.v);
    const codeTok = toks.map((w, i) => ({ i, v: dateTok?.i === i ? null : parseCode(w.text) })).find((c) => c.v);
    if (!codeTok && !dateTok) continue;
    // Bills: one amount per row. EOBs: billed, allowed, paid, you owe -> billed is first.
    const charge = docType === 'eob' ? monies[0] : monies[monies.length - 1];
    const used = new Set([dateTok?.i, codeTok?.i, ...monies.map((m) => m.i)]);
    const unitTok = toks.map((w, i) => ({ i, v: used.has(i) ? null : parseUnits(w.text) })).reverse().find((u) => u.v);
    if (unitTok) used.add(unitTok.i);
    const desc = toks.filter((_, i) => !used.has(i)).map((w) => w.text).join(' ').trim();
    const c = rowConf(toks);
    lines.push({
      date: field(dateTok?.v ?? (docType === 'eob' ? header.serviceFrom.value : null), c, r.box),
      code: field(codeTok?.v ?? null, c, r.box),
      description: field(desc || null, c, r.box),
      units: field(docType === 'eob' ? 1 : unitTok?.v ?? 1, unitTok ? c : 0.5, r.box),
      chargeUsd: field(charge.v!, c, r.box),
      box: r.box,
    });
  }
  return { docType, header, lines, reader, textChars: all.replace(/\s/g, '').length, text: all };
}
