// Pricing ingestion: the source-agnostic adapter contract (build ticket
// 2026-10-01). Every pricing source - NADAC today, partner feeds later -
// implements PriceSourceAdapter. The ONLY caller is the ingest runner
// (scripts/ingest_prices.ts). Ranking never knows which source a row
// came from; consent/staleness enforcement (lib/pricing/enforcement.ts)
// reads price_sources rules uniformly for every source.
//
// Non-negotiables encoded here:
// - Unknown or unparseable records are REJECTED with a reason, never
//   silently coerced (RejectedRecord carries the reason + raw payload).
// - No affiliate, referral, or tracking fields exist in this contract.
//   There is nothing to populate one with, by design.

// What the price IS. 'acquisition_benchmark' (e.g. NADAC) is a market
// benchmark, never a patient-payable price - ranking must not surface it
// as a pathway (lib/ranking.ts price-pathway construction skips it).
export type PriceType =
  | 'acquisition_benchmark'
  | 'cash'
  | 'discount_card'
  | 'manufacturer_program';

export const PRICE_TYPES: readonly PriceType[] = [
  'acquisition_benchmark',
  'cash',
  'discount_card',
  'manufacturer_program',
];

// One normalized price observation, source-agnostic. Field names match
// the price_points columns the ingest runner upserts into.
export interface NormalizedPrice {
  ndc: string;                    // 11 digits, no hyphens (FDA 5-4-2 normalized)
  drug_name: string;              // as the source states it (usually generic)
  price: number;                  // USD, > 0
  unit: string;                   // basis of `price`: 'per_unit' | 'per_fill' | 'per_month'
  quantity: number | null;        // units the price covers when unit != 'per_unit' (e.g. 30 tablets); null when unknown
  price_type: PriceType;
  pharmacy_npi: string | null;    // null for benchmark/national rows
  pharmacy_zip: string | null;
  observed_at: string;            // ISO date (YYYY-MM-DD) the price was observed/effective
  expires_at: string | null;      // ISO date after which the row must not be shown; null = governed by source max_staleness_hours
  source_id: string;              // price_sources.id (uuid) this row was ingested under
  source_record_ref: string;      // stable pointer back to the raw record (file row #, API id) for audit
}

export interface RejectedRecord {
  reason: string;
  raw: unknown;
}

export interface NormalizedBatch {
  accepted: NormalizedPrice[];
  rejected: RejectedRecord[];
}

export interface AdapterFetchOptions {
  // Local file path for fixture/replay runs (tests never touch the
  // network); adapters supporting live pulls read their own URL config.
  file?: string;
}

// Two modes (M06-AC1): a bulk source is pulled on a schedule by the
// ingest runner; a quote source is asked live, per NDC, quantity and zip,
// by the chat (lib/pricing/quotes.ts) with a cache and a fallback.
export type AdapterMode = 'bulk' | 'quote';

export interface QuoteRequest {
  ndc: string;          // 11 digits
  quantity: number;     // units
  zip: string | null;   // 5 digits when known
}

export interface PriceQuoteAdapter {
  readonly id: string;           // price_sources.name
  readonly displayName: string;  // public label, never a partner's name in this repo
  readonly mode: 'quote';
  quote(req: QuoteRequest): Promise<NormalizedBatch>;
}

export interface PriceSourceAdapter {
  // Matches price_sources.name in the DB (db/022).
  readonly id: string;
  readonly displayName: string;
  readonly mode?: 'bulk';
  // Soft contract with the runner: the runner refuses to run an adapter
  // whose price_sources row has enabled = false. This flag is the
  // code-side default when seeding the row.
  readonly enabled: boolean;
  // Pull the raw records. Return shape is source-specific; normalize()
  // is responsible for interpreting it.
  fetch(options?: AdapterFetchOptions): Promise<unknown[]>;
  // Raw records -> normalized rows. Records that cannot be understood
  // are rejected with reasons; nothing is silently coerced.
  normalize(raw: unknown[]): NormalizedBatch;
}

// FDA NDC package-code normalization (10-digit hyphenated -> 11-digit
// 5-4-2): 4-4-2 pads segment 1, 5-3-2 pads segment 2, 5-4-1 pads segment
// 3, each with a LEADING zero. Source: the FDA NDC Directory's package
// code convention (11-digit billing format). Returns null for anything
// that is not already 11 digits or a recognizable 10-digit hyphenated
// form - the caller rejects the record (never guesses).
export function normalizeNdc(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (/^\d{11}$/.test(s)) return s;
  const m = s.match(/^(\d{4,5})-(\d{3,4})-(\d{1,2})$/);
  if (!m) return null;
  const [, a, b, c] = m;
  if (a.length === 4 && b.length === 4 && c.length === 2) return `0${a}${b}${c}`;   // 4-4-2
  if (a.length === 5 && b.length === 3 && c.length === 2) return `${a}0${b}${c}`;   // 5-3-2
  if (a.length === 5 && b.length === 4 && c.length === 1) return `${a}${b}0${c}`;   // 5-4-1
  return null;
}

// Shared field validators so every adapter rejects the same way.
export function requirePositiveUsd(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function requireIsoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}
