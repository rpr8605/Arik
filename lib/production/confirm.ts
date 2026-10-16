// "Looks right": the patient's confirmed copy of what the reader found,
// possibly edited. Pure. The API takes it from the browser, so every field
// is checked here before anything runs on it (M09-AC4: nothing downstream
// runs on unconfirmed data, and nothing runs on malformed data either).

import type { Box, ConfirmedBill, ExtractedDocument } from './types';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 300;

const str = (v: unknown, max: number) => (v == null || v === '' ? null : typeof v === 'string' && v.length <= max ? v.trim() : undefined);
const date = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
const num = (v: unknown, max: number) => (v == null || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : undefined);
const box = (v: unknown): Box | null | undefined => {
  if (v == null) return null;
  const b = v as Box;
  return typeof b === 'object' && [b.page, b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? { page: b.page, x: b.x, y: b.y, w: b.w, h: b.h } : undefined;
};

export function parseConfirmedBill(body: unknown, now = new Date()): { bill: ConfirmedBill } | { error: string } {
  const b = body as { header?: Record<string, unknown>; lines?: unknown[] } | null;
  if (!b || typeof b !== 'object' || !b.header || !Array.isArray(b.lines)) return { error: 'header and lines are required' };
  if (b.lines.length > MAX_LINES) return { error: `at most ${MAX_LINES} lines` };
  const h = b.header;
  const header = {
    patientName: str(h.patientName, 200),
    provider: str(h.provider, 200),
    accountNumber: str(h.accountNumber, 60),
    statementDate: date(h.statementDate),
    serviceFrom: date(h.serviceFrom),
    serviceTo: date(h.serviceTo),
    totalChargesUsd: num(h.totalChargesUsd, 10_000_000),
    amountDueUsd: num(h.amountDueUsd, 10_000_000),
  };
  const bad = Object.entries(header).find(([, v]) => v === undefined);
  if (bad) return { error: `header.${bad[0]} is not valid` };
  if (header.serviceFrom && header.serviceTo && header.serviceTo < header.serviceFrom) return { error: 'service dates are out of order' };
  const lines: ConfirmedBill['lines'] = [];
  for (let i = 0; i < b.lines.length; i++) {
    const l = b.lines[i] as Record<string, unknown>;
    if (!l || typeof l !== 'object') return { error: `line ${i} is not valid` };
    const line = {
      date: date(l.date),
      code: l.code == null || l.code === '' ? null : typeof l.code === 'string' && /^[A-Za-z0-9]{4,5}$/.test(l.code.trim()) ? l.code.trim().toUpperCase() : undefined,
      description: str(l.description, 200),
      units: l.units == null || l.units === '' ? null : Number.isInteger(l.units) && (l.units as number) > 0 && (l.units as number) <= 1000 ? (l.units as number) : undefined,
      chargeUsd: num(l.chargeUsd, 10_000_000),
      box: box(l.box),
    };
    const badField = Object.entries(line).find(([, v]) => v === undefined);
    if (badField) return { error: `line ${i} ${badField[0]} is not valid` };
    lines.push(line as ConfirmedBill['lines'][number]);
  }
  return { bill: { confirmedAt: now.toISOString(), header: header as ConfirmedBill['header'], lines } };
}

// What the "Here's what I read" screen starts from: the reader's output as
// a draft the patient edits.
export function draftFromReading(doc: ExtractedDocument) {
  const h = doc.header;
  return {
    header: Object.fromEntries(Object.entries(h).map(([k, f]) => [k, f.value])),
    lines: doc.lines.map((l) => ({ date: l.date.value, code: l.code.value, description: l.description.value, units: l.units.value, chargeUsd: l.chargeUsd.value, box: l.box })),
  };
}
