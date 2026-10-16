// NADAC adapter (build ticket 2026-10-01) - the first real source.
//
// SOURCE: CMS publishes NADAC as ONE DATASET PER YEAR on data.medicaid.gov
//   ("NADAC (National Average Drug Acquisition Cost) 2026", ...). The id
//   changes every January, so the current one is looked up by title in
//   the metastore (resolveNadacDatasetId); the constant below is the
//   fallback. (2026-10-16: the id used before, d5eaf378..., is the 2021
//   dataset, latest as_of 2021-12-29; the 2026 dataset is fbb83258...,
//   1,238,214 rows, latest as_of 2026-10-14 - all verified live.)
//   Page:     https://data.medicaid.gov/dataset/<id>
//   API:      POST https://data.medicaid.gov/api/1/datastore/query/<id>/0
//             body {"limit":N,"offset":M,"conditions":[...]} ->
//             {results: [...], count, schema}. Server-side conditions
//             verified live 2026-10-16: {"property":"ndc","value":[...],
//             "operator":"in"} and {"property":"as_of_date","value":
//             "2026-07-20","operator":">="}.
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
//   pricing_unit    -> pricing_unit     ['EA' | 'ML' | 'GM'], verified in the
//                                        CMS NADAC Data Field Definitions
//                                        (Myers and Stauffer, rev. Jan 2021):
//                                        "Indicates the pricing unit for the
//                                        associated NDC ('ML', 'GM' or 'EA')".
//                                        unit = 'per_unit' (price is per EA/ML/GM)
//   as_of_date      -> as_of            [ISO, the weekly file the row is from]
//   classification_for_rate_setting -> rate_class ['B' | 'G' | 'B-ANDA' |
//                                        'B-BIO', same definitions doc;
//                                        anything else -> null]
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
//   - Any pricing_unit other than EA/ML/GM is REJECTED (never coerced).
//   - explanation_code / otc /
//     pharmacy_type_indicator / corresponding_generic_drug_* : captured
//     in the raw payload (raw_price_ingest) but not mapped; semantics
//     beyond the observed "G"/"1"/"N"/"C/I" values are UNVERIFIED.

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

export const NADAC_2026_DATASET_ID = 'fbb83258-11c7-47f5-8b18-5f8e79f7e704';
export const nadacDatasetUrl = (id: string) => `https://data.medicaid.gov/dataset/${id}`;
export const nadacApiUrl = (id: string) => `https://data.medicaid.gov/api/1/datastore/query/${id}/0`;
export const NADAC_DATASET_URL = nadacDatasetUrl(NADAC_2026_DATASET_ID);
export const NADAC_API_URL = nadacApiUrl(NADAC_2026_DATASET_ID);
export const NADAC_PRICING_UNITS = ['EA', 'ML', 'GM'] as const;

// Pure: pick the dataset id for a year from the metastore item list.
export function pickNadacDataset(items: { identifier?: string; title?: string }[], year: number): string | null {
  const want = `NADAC (National Average Drug Acquisition Cost) ${year}`;
  return items.find((i) => (i.title ?? '').trim() === want)?.identifier ?? null;
}

export async function resolveNadacDatasetId(year = new Date().getUTCFullYear()): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS * 3);
  try {
    const res = await fetch('https://data.medicaid.gov/api/1/metastore/schemas/dataset/items', { signal: controller.signal });
    if (!res.ok) return NADAC_2026_DATASET_ID;
    return pickNadacDataset((await res.json()) as { identifier?: string; title?: string }[], year) ?? NADAC_2026_DATASET_ID;
  } catch {
    return NADAC_2026_DATASET_ID;
  } finally {
    clearTimeout(timer);
  }
}

// Live pulls are bounded by default: the dataset is >1M rows and the
// runner is not a bulk mirror. Use conditions for filtered pulls.
export interface NadacFetchOptions extends AdapterFetchOptions {
  limit?: number;
  offset?: number;
  datasetId?: string;
  conditions?: { property: string; value: unknown; operator: string }[];
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
    const res = await fetch(nadacApiUrl(opts.datasetId ?? NADAC_2026_DATASET_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: opts.limit ?? LIVE_DEFAULT_LIMIT,
        offset: opts.offset ?? 0,
        ...(opts.conditions ? { conditions: opts.conditions } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`NADAC API ${res.status}`);
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
    if (!(NADAC_PRICING_UNITS as readonly string[]).includes(pricingUnit)) {
      return reject(`unsupported pricing_unit: ${JSON.stringify(row.pricing_unit)}`);
    }
    const asOf = row.as_of_date == null ? null : requireIsoDate(row.as_of_date);
    if (row.as_of_date != null && !asOf) return reject(`unparseable as_of_date: ${JSON.stringify(row.as_of_date)}`);
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
      pricing_unit: pricingUnit as 'EA' | 'ML' | 'GM',
      as_of: asOf,
      rate_class: ['B', 'G', 'B-ANDA', 'B-BIO'].includes(String(row.classification_for_rate_setting ?? '').trim().toUpperCase())
        ? String(row.classification_for_rate_setting).trim().toUpperCase()
        : null,
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
