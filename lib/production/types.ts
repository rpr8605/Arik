// Production interfaces (docs/kimi/PRODUCTION_PLAN.md, Phases 2 to 4;
// plan: docs/kimi/PLAN_PHASES_2_4.md). Every step of the bill flow sits
// behind one of these, with the demo implementation and the real one side
// by side (lib/production/demo.ts, lib/production/real/*) and the same
// contract tests for both (scripts/test_production_contracts.ts).

import type { BillSituation } from '../rules/bills/rights';

// ---------- Get the document ----------

export interface SourceDocument {
  bytes: Uint8Array;
  mime: string;               // application/pdf, image/png, image/jpeg, image/svg+xml
  filename: string;
  origin: 'sample' | 'upload' | 'synthetic';
}

export interface DocumentSource {
  readonly name: string;
  get(ref: string): Promise<SourceDocument>;
}

// ---------- Read it ----------

export type DocType = 'itemized_bill' | 'summary_bill' | 'eob' | 'denial_letter' | 'insurance_card' | 'pharmacy_receipt' | 'unknown';

// Page position in percent of the page (0..100), page 1-based. Feeds the
// highlight boxes, as in the demo walkthrough.
export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Field<T> {
  value: T | null;
  confidence: number;         // 0..1
  box: Box | null;
}

export interface ExtractedLine {
  date: Field<string>;        // ISO YYYY-MM-DD
  code: Field<string>;        // CPT/HCPCS/revenue code as printed (numbers only)
  description: Field<string>;
  units: Field<number>;
  chargeUsd: Field<number>;
  box: Box | null;            // the whole row
}

export interface ExtractedHeader {
  patientName: Field<string>;
  provider: Field<string>;
  accountNumber: Field<string>;
  statementDate: Field<string>;
  serviceFrom: Field<string>;
  serviceTo: Field<string>;
  totalChargesUsd: Field<number>;
  amountDueUsd: Field<number>;
}

export interface ExtractedDocument {
  docType: DocType;
  header: ExtractedHeader;
  lines: ExtractedLine[];
  reader: string;             // which Extractor produced it
  textChars: number;          // how much text the reader found
  text?: string;              // the page text, row by row: kept for denial letters and EOBs (lib/rules/denials/parse.ts reads it)
}

export interface Extractor {
  readonly name: string;
  // false for any reader that sends the document outside this server
  // without a BAA (a vision model today): synthetic documents only.
  readonly allowsRealPatientData: boolean;
  extract(doc: SourceDocument): Promise<ExtractedDocument>;
}

// ---------- The patient confirms it ----------

// What the checks run on: the extraction after "Looks right", with any
// edits the patient made. Nothing downstream runs on unconfirmed data.
export interface ConfirmedBill {
  confirmedAt: string;
  header: { [K in keyof ExtractedHeader]: ExtractedHeader[K]['value'] };
  lines: { date: string | null; code: string | null; description: string | null; units: number | null; chargeUsd: number | null; box: Box | null }[];
  goodFaithEstimateUsd?: number | null;   // entered by the patient, if they were given one
}

// ---------- Find problems ----------

export interface Finding {
  id: string;
  lines: number[];            // indexes into ConfirmedBill.lines
  tone: 'wrong' | 'ask';
  amountUsd: number | null;   // the amount in question; null for "ask" with no number
  plainText: string;          // plain words, no rule names
  ruleId: string;             // e.g. 'duplicate_charge', 'ncci_ptp'
  dataVersion: string;        // e.g. 'ncci-ptp-2026Q4', 'builtin'
  refsUsd?: number[];         // other dollar figures named in the text (e.g. a good faith estimate), so a letter may cite them
}

export interface BillChecks {
  readonly name: string;
  run(bill: ConfirmedBill, situation?: BillSituation): Promise<Finding[]>;
}

// ---------- Write the letter ----------

export type LetterType = 'itemized_bill_request' | 'billing_dispute' | 'hold_collections' | 'insurer_appeal' | 'medical_necessity_request' | 'financial_assistance_cover';

export interface LetterInput {
  type: LetterType;
  patient: { name: string; phone: string | null; address: string | null };
  recipient: { name: string; address: string | null; fax: string | null };
  bill: ConfirmedBill;
  findings: Finding[];
  date: string;               // ISO
}

export interface DraftLetter {
  type: LetterType;
  subject: string;
  body: string;               // plain text, paragraphs separated by blank lines
  footer: string;
  drafter: string;
  usedFallback: boolean;      // the model draft failed the guard and code wrote it
}

export interface LetterDrafter {
  readonly name: string;
  draft(input: LetterInput): Promise<DraftLetter>;
}

// One footer for every letter, demo or real.
export { LETTER_FOOTER } from '../walkthrough/letters';
