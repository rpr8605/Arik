// NADAC adapter (build ticket 2026-10-01) - the first real source.
//
// SOURCE (verified live 2026-10-01, HTTP 200, limit=2 probe):
//   Dataset:  NADAC (National Average Drug Acquisition Cost), CMS
//   Page:     https://data.medicaid.gov/dataset/d5eaf378-dcef-5779-83de-acdd8347d68e
//   API:      POST https://data.medicaid.gov/api/1/datastore/query/d5eaf378-dcef-5779-83de-acdd8347d68e/0
//             body {"limit":N,"offset":M} -> {results: [...], count, schema}
//             (verified: count was 1,293,586 rows; key names below are
//             exactly as returned by the API)
//   Cadence:  updated weekly (per medicaid.gov retail-price-survey page),
//             which is why db/022 sets max_staleness_hours = 2160 (~90d).
//
// FIELD MAPPING (API key -> NormalizedPrice; source of each mapping):
//   ndc_description -> drug_name        [API key, verified live]
//   ndc             -> ndc              [11-digit string, verified live; also
//                                        passes normalizeNdc() so hyphenated
//                                        10-digit forms in file dumps work]
//   nadac_per_unit  -> price            [numeric STRING, e.g. "0.16400";
//                                        schema block: decimal(10,5), verified]
//   effective_date  -> observed_at      [ISO "2020-12-23" from the API,
//                                        verified; the dataset PAGE renders
//                                        US format (12/17/2025) - display
//                                        only, the API is ISO]
//   pricing_unit    -> unit             ["EA" observed; mapped to 'per_unit']
//   (constant)      -> price_type       'acquisition_benchmark': NADAC is the
//                                        average invoice price pharmacies pay
//                                        wholesalers (medicaid.gov retail-price-
//                                        survey page), NOT a patient price
//   (constant)      -> pharmacy_npi/zip null: NADAC is a national average,
//                                        no pharmacy identity exists
//   (constant)      -> expires_at       null: freshness is governed by
//                                        price_sources.max_staleness_hours
//   ndc + effective_date -> source_record_ref (stable natural identity)
//
// UNVERIFIED (marked, not guessed):
//   - pricing_unit values other than "EA" (e.g. "GM"/"ML" for non-solid
//     forms): observed in CMS docs but not probed live. Rows with a unit
//     other than EA are REJECTED (never coerced) until the field
//     definitions doc is checked. CMS "NADAC Data Field Definitions" is
//     linked from https://www.medicaid.gov/medicaid/prescription-drugs/retail-price-survey
//     (link target itself UNVERIFIED - not fetched).
//   - classification_for_rate_setting / explanation_code / otc /
//     pharmacy_type_indicator / corresponding_generic_drug_* : captured
//     in the raw payload (raw_price_ingest) but not mapped; semantics
//     beyond the observed "G"/"1"/"N"/"C/I" values are UNVERIFIED.
//   - DKAN server-side filtering (conditions/operator syntax for
//     drug-name-filtered pulls): NOT verified. fetch() live mode pulls
//     bounded pages only; filtered pulls are a follow-up.

import { readFile } from 'node:fs/promises';
import {
  normalizeNdc,
  requireIsoDate,
  requirePositiveUsd,
  type AdapterFetchOptions,
  type NormalizedBatch,
  type NormalizedPrice,
  type PriceSourceAdapter,
  type RejectedRecord,
} from '../adapter';

export const NADAC_DATASET_URL =
  'https://data.medicaid.gov/dataset/d5eaf378-dcef-5779-83de-acdd8347d68e';
export const NADAC_API_URL =
  'https://data.medicaid.gov/api/1/datastore/query/d5eaf378-dcef-5779-83de-acdd8347d68e/0';

// Live pulls are bounded by default: the dataset is >1M rows and the
// runner is not a bulk mirror. Filtered pulls need the DKAN conditions
// syntax (UNVERIFIED - see header).
export interface NadacFetchOptions extends AdapterFetchOptions {
  limit?: number;
  offset?: number;
}
const LIVE_DEFAULT_LIMIT = 5000;
const LIVE_TIMEOUT_MS = 30_000; // standing rule: every fetch is bounded

interface NadacRow {
  ndc_description?: unknown;
  ndc?: unknown;
  nadac_per_unit?: unknown;
  effective_date?: unknown;
  pricing_unit?: unknown;
  [k: string]: unknown;
}

async function fetchLive(opts: NadacFetchOptions): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const res = await fetch(NADAC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: opts.limit ?? LIVE_DEFAULT_LIMIT,
        offset: opts.offset ?? 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`NADAC API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    if (!Array.isArray(json?.results)) {
      throw new Error('NADAC API response missing results[] - shape changed?');
    }
    return json.results;
  } finally {
    clearTimeout(timer);
  }
}

// File mode: a local JSON dump, either the DKAN envelope ({results:[...]})
// or a bare array of rows. Tests use this path; no network, ever.
async function fetchFromFile(path: string): Promise<unknown[]> {
  const json = JSON.parse(await readFile(path, 'utf8'));
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results)) return json.results;
  throw new Error(`fixture ${path}: expected an array or {results: [...]}`);
}

// The runner resolves the price_sources.id for 'nadac' and constructs
// the adapter with it; normalize() stamps it on every accepted row.
export function createNadacAdapter(sourceId: string): PriceSourceAdapter {
  function normalizeRow(row: NadacRow, rejects: RejectedRecord[]): NormalizedPrice | null {
    const reject = (reason: string) => {
      rejects.push({ reason, raw: row });
      return null;
    };
    const ndc = normalizeNdc(row.ndc);
    if (!ndc) return reject(`unparseable ndc: ${JSON.stringify(row.ndc)}`);
    const drugName = typeof row.ndc_description === 'string' ? row.ndc_description.trim() : '';
    if (!drugName) return reject('missing ndc_description');
    const price = requirePositiveUsd(row.nadac_per_unit);
    if (price === null) return reject(`unparseable or non-positive nadac_per_unit: ${JSON.stringify(row.nadac_per_unit)}`);
    const observedAt = requireIsoDate(row.effective_date);
    if (!observedAt) return reject(`unparseable effective_date: ${JSON.stringify(row.effective_date)}`);
    const pricingUnit = typeof row.pricing_unit === 'string' ? row.pricing_unit.trim().toUpperCase() : '';
    if (pricingUnit !== 'EA') {
      // See header: non-EA units are not coerced until the CMS field
      // definitions are verified.
      return reject(`unsupported pricing_unit: ${JSON.stringify(row.pricing_unit)}`);
    }
    return {
      ndc,
      drug_name: drugName,
      price,
      unit: 'per_unit',
      quantity: 1,
      price_type: 'acquisition_benchmark',
      pharmacy_npi: null,
      pharmacy_zip: null,
      observed_at: observedAt,
      expires_at: null,
      source_id: sourceId,
      source_record_ref: `${ndc}|${observedAt}`,
    };
  }

  return {
    id: 'nadac',
    displayName: 'CMS NADAC (National Average Drug Acquisition Cost)',
    enabled: true,
    async fetch(options: NadacFetchOptions = {}) {
      return options.file ? fetchFromFile(options.file) : fetchLive(options);
    },
    normalize(raw: unknown[]): NormalizedBatch {
      const rejected: RejectedRecord[] = [];
      const accepted: NormalizedPrice[] = [];
      for (const row of raw) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          rejected.push({ reason: 'record is not an object', raw: row });
          continue;
        }
        const normalized = normalizeRow(row as NadacRow, rejected);
        if (normalized) accepted.push(normalized);
      }
      return { accepted, rejected };
    },
  };
}
