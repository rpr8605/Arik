// The DEMO implementations of the production interfaces: the scripted
// walkthrough pieces (sample documents, stored extraction, fixture
// findings, fixture letters), behind the same interfaces as the real
// ones so the contract tests hold both to the same rules. DEMO_MODE picks
// these; production picks lib/production/real/*.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BILL_FLOW } from '../walkthrough/flows';
import { LETTERS } from '../walkthrough/letters';
import { SAMPLE_DOCS } from '../demo/sampleDocs';
import {
  LETTER_FOOTER,
  type BillChecks,
  type Box,
  type ConfirmedBill,
  type DocumentSource,
  type DraftLetter,
  type ExtractedDocument,
  type Extractor,
  type Field,
  type Finding,
  type LetterDrafter,
  type LetterInput,
  type SourceDocument,
} from './types';

export const demoDocumentSource: DocumentSource = {
  name: 'demo-samples',
  async get(ref: string): Promise<SourceDocument> {
    const doc = SAMPLE_DOCS.find((d) => d.id === ref);
    if (!doc?.image) throw new Error(`no sample document "${ref}"`);
    const bytes = await readFile(join(process.cwd(), 'public', doc.image));
    return { bytes: new Uint8Array(bytes), mime: 'image/svg+xml', filename: doc.image.split('/').pop()!, origin: 'sample' };
  },
};

// Rows of the sample hospital bill (public/demo/docs/luis-hospital-bill.svg,
// 600x800): the stored extraction the walkthrough's "Reading..." shows.
const ROW_Y0 = 245;
const ROW_H = 34;
const rowBox = (i: number): Box => ({ page: 1, x: 1, y: Math.round(((ROW_Y0 + i * ROW_H - 2) / 800) * 10000) / 100, w: 98, h: Math.round(((ROW_H + 2) / 800) * 10000) / 100 });
const f = <T>(value: T, box: Box | null = null): Field<T> => ({ value, confidence: 1, box });

const LUIS_ROWS: [string, string, string, number, number][] = [
  ['2026-09-03', '99284', 'Emergency room visit', 1, 2480],
  ['2026-09-03', '85025', 'Blood count test', 1, 186],
  ['2026-09-03', '85025', 'Blood count test', 1, 186],
  ['2026-09-03', '80053', 'Blood chemistry panel, full', 1, 398],
  ['2026-09-03', '80048', 'Blood chemistry panel, basic', 1, 412],
  ['2026-09-03', '71046', 'Chest X-ray', 1, 640],
  ['2026-09-03', '0120', 'Room and board (per day)', 3, 8850],
  ['2026-09-04', '96374', 'IV medicine push', 1, 310],
];

export const LUIS_EXTRACTION: ExtractedDocument = {
  docType: 'itemized_bill',
  header: {
    patientName: f('Luis Moreno'),
    provider: f('Riverbend General Hospital'),
    accountNumber: f('RGH-4471902'),
    statementDate: f('2026-09-20'),
    serviceFrom: f('2026-09-03'),
    serviceTo: f('2026-09-05'),
    totalChargesUsd: f(13462),
    amountDueUsd: f(6282),
  },
  lines: LUIS_ROWS.map(([date, code, description, units, charge], i) => ({
    date: f(date),
    code: f(code),
    description: f(description),
    units: f(units),
    chargeUsd: f(charge),
    box: rowBox(i),
  })),
  reader: 'demo-stored',
  textChars: 600,
};

export const demoExtractor: Extractor = {
  name: 'demo-stored',
  allowsRealPatientData: true,  // it reads nothing; it returns stored fixtures
  async extract(doc: SourceDocument): Promise<ExtractedDocument> {
    if (doc.filename === 'luis-hospital-bill.svg') return LUIS_EXTRACTION;
    throw new Error(`no stored extraction for ${doc.filename}`);
  },
};

export function confirm(doc: ExtractedDocument, at = new Date().toISOString()): ConfirmedBill {
  const h = doc.header;
  return {
    confirmedAt: at,
    header: {
      patientName: h.patientName.value,
      provider: h.provider.value,
      accountNumber: h.accountNumber.value,
      statementDate: h.statementDate.value,
      serviceFrom: h.serviceFrom.value,
      serviceTo: h.serviceTo.value,
      totalChargesUsd: h.totalChargesUsd.value,
      amountDueUsd: h.amountDueUsd.value,
    },
    lines: doc.lines.map((l) => ({ date: l.date.value, code: l.code.value, description: l.description.value, units: l.units.value, chargeUsd: l.chargeUsd.value, box: l.box })),
  };
}

// The walkthrough's scripted findings for the hospital bill (findings 1 to
// 3; finding 4 is on the doctor's bill).
const LINES_FOR: Record<number, number[]> = { 1: [1, 2], 2: [3, 4], 3: [6] };
const RULE_FOR: Record<number, string> = { 1: 'duplicate_charge', 2: 'ncci_ptp', 3: 'room_days' };

export const demoBillChecks: BillChecks = {
  name: 'demo-fixture',
  async run(_bill: ConfirmedBill): Promise<Finding[]> {
    return BILL_FLOW.sequences.findings
      .filter((s): s is Extract<typeof s, { kind: 'finding' }> => s.kind === 'finding' && s.n in LINES_FOR)
      .map((s) => ({ id: `demo-${s.n}`, lines: LINES_FOR[s.n], tone: s.tone, amountUsd: s.amountUsd, plainText: s.text, ruleId: RULE_FOR[s.n], dataVersion: 'demo-fixture' }));
  },
};

export const demoLetterDrafter: LetterDrafter = {
  name: 'demo-fixture',
  async draft(input: LetterInput): Promise<DraftLetter> {
    const l = input.type === 'itemized_bill_request' ? LETTERS['luis-itemized'] : LETTERS['luis-dispute'];
    const phone = input.patient.phone ?? 'the number on file';
    return {
      type: input.type,
      subject: l.subject,
      body: l.paragraphs.map((p) => p.replaceAll('{phone}', phone)).join('\n\n'),
      footer: LETTER_FOOTER,
      drafter: 'demo-fixture',
      usedFallback: false,
    };
  },
};
