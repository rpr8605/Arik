// Config-driven adapter template (M07-AC2, Appendix B2 Part B). A new
// price source is a config entry, not new code: auth (API key, bearer
// token or OAuth client credentials), pagination (page, offset or cursor),
// where the records live in the response, and a field map. Credentials
// come only from env vars NAMED in the config; startup fails fast when an
// enabled source is missing one (checkSourceEnv, M07-AC6). Calls go
// through the hardened client (lib/pricing/http.ts).
//
// No affiliate, referral or tracking fields exist here. A source's extra
// fields are never mapped; there is nothing to map them to.

import {
  normalizeNdc,
  requireIsoDate,
  requirePositiveUsd,
  type NormalizedBatch,
  type NormalizedPrice,
  type PriceQuoteAdapter,
  type PriceType,
  type QuoteRequest,
  type RejectedRecord,
} from './adapter';
import { createHttpClient, type HttpClientOptions } from './http';

export type SourceAuth =
  | { type: 'none' }
  | { type: 'api_key'; header: string; env: string }
  | { type: 'bearer'; env: string }
  | { type: 'oauth_client_credentials'; tokenUrl: string; clientIdEnv: string; clientSecretEnv: string; scope?: string };

export type SourcePagination =
  | { type: 'none' }
  | { type: 'page'; pageParam: string; sizeParam: string; size: number; firstPage?: number }
  | { type: 'offset'; offsetParam: string; limitParam: string; limit: number }
  | { type: 'cursor'; cursorParam: string; nextCursorPath: string };

export interface SourceFieldMap {
  ndc: string;
  drug_name: string;
  price: string;
  observed_at: string;
  record_ref: string;
  quantity?: string;
  expires_at?: string;
  pharmacy_npi?: string;
  pharmacy_zip?: string;
}

export interface SourceConfig {
  key: string;               // price_sources.name
  displayName: string;       // public label
  mode: 'bulk' | 'quote';
  enabled: boolean;
  url: string;               // list endpoint (bulk) or quote endpoint
  auth: SourceAuth;
  pagination: SourcePagination;
  recordsPath: string;       // dot path to the array of records ('' = the body is the array)
  quoteParams?: { ndc: string; quantity: string; zip: string };
  fieldMap: SourceFieldMap;
  priceType: PriceType;
  unit: 'per_unit' | 'per_fill' | 'per_month';
  maxPages?: number;         // hard stop for bulk pulls; default 50
}

// Env var NAMES a config needs (never values).
export function requiredEnv(c: SourceConfig): string[] {
  switch (c.auth.type) {
    case 'api_key':
    case 'bearer':
      return [c.auth.env];
    case 'oauth_client_credentials':
      return [c.auth.clientIdEnv, c.auth.clientSecretEnv];
    default:
      return [];
  }
}

// M07-AC6: fail fast at startup. Lists missing NAMES only.
export function checkSourceEnv(configs: SourceConfig[], env: Record<string, string | undefined>): { ok: boolean; missing: { source: string; vars: string[] }[] } {
  const missing = configs
    .filter((c) => c.enabled)
    .map((c) => ({ source: c.key, vars: requiredEnv(c).filter((n) => !env[n] || env[n]!.trim() === '') }))
    .filter((m) => m.vars.length > 0);
  return { ok: missing.length === 0, missing };
}

export function assertSourceEnv(configs: SourceConfig[], env: Record<string, string | undefined>): void {
  const r = checkSourceEnv(configs, env);
  if (!r.ok) {
    throw new Error(`price source env missing: ${r.missing.map((m) => `${m.source} needs ${m.vars.join(', ')}`).join('; ')}`);
  }
}

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: any = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// One raw record -> a normalized row, or a reject with a reason. Never
// coerces: a missing or malformed field is a reject. The raw record is kept
// on the reject for the staging table only; it is never logged.
export function normalizeRecord(record: unknown, c: SourceConfig, sourceId: string): NormalizedPrice | RejectedRecord {
  const f = c.fieldMap;
  const ndc = normalizeNdc(getPath(record, f.ndc) as string);
  if (!ndc) return { reason: 'bad ndc', raw: record };
  const drugName = getPath(record, f.drug_name);
  if (typeof drugName !== 'string' || drugName.trim() === '') return { reason: 'missing drug name', raw: record };
  const price = requirePositiveUsd(getPath(record, f.price));
  if (price == null) return { reason: 'bad price', raw: record };
  const observed = requireIsoDate(getPath(record, f.observed_at));
  if (!observed) return { reason: 'bad observed date', raw: record };
  let expires: string | null = null;
  if (f.expires_at) {
    const v = getPath(record, f.expires_at);
    if (v != null) {
      expires = requireIsoDate(v);
      if (!expires) return { reason: 'bad expiry date', raw: record };
    }
  }
  let quantity: number | null = null;
  if (f.quantity) {
    const q = Number(getPath(record, f.quantity));
    if (!Number.isFinite(q) || q <= 0) return { reason: 'bad quantity', raw: record };
    quantity = q;
  }
  const ref = getPath(record, f.record_ref);
  if (ref == null || String(ref).trim() === '') return { reason: 'missing record ref', raw: record };
  const npiRaw = f.pharmacy_npi ? getPath(record, f.pharmacy_npi) : null;
  if (npiRaw != null && !/^\d{10}$/.test(String(npiRaw))) return { reason: 'bad pharmacy npi', raw: record };
  const zipRaw = f.pharmacy_zip ? getPath(record, f.pharmacy_zip) : null;
  if (zipRaw != null && !/^\d{5}$/.test(String(zipRaw))) return { reason: 'bad pharmacy zip', raw: record };
  return {
    ndc,
    drug_name: drugName.trim(),
    price,
    unit: c.unit,
    quantity,
    price_type: c.priceType,
    pharmacy_npi: npiRaw != null ? String(npiRaw) : null,
    pharmacy_zip: zipRaw != null ? String(zipRaw) : null,
    observed_at: observed,
    expires_at: expires,
    source_id: sourceId,
    source_record_ref: String(ref),
  };
}

export function normalizeRecords(records: unknown[], c: SourceConfig, sourceId: string): NormalizedBatch {
  const out: NormalizedBatch = { accepted: [], rejected: [] };
  for (const r of records) {
    const n = normalizeRecord(r, c, sourceId);
    if ('reason' in n) out.rejected.push(n);
    else out.accepted.push(n);
  }
  return out;
}

export class SourceParseError extends Error {
  constructor(readonly sourceKey: string, reason: string) {
    super(`source ${sourceKey}: ${reason}`);
    this.name = 'SourceParseError';
  }
}

// Auth headers for a source (M07-AC2), shared by price and routing
// adapters. Values come from env vars NAMED in the config; an OAuth token
// is fetched once and reused until shortly before it expires.
export function createAuth(
  sourceKey: string,
  auth: SourceAuth,
  env: Record<string, string | undefined>,
  client: { request: (url: string, init?: RequestInit) => Promise<Response> },
  now: () => number = Date.now,
) {
  let oauthToken: { value: string; until: number } | null = null;
  async function headers(): Promise<Record<string, string>> {
    if (auth.type === 'api_key') return { [auth.header]: env[auth.env] ?? '' };
    if (auth.type === 'bearer') return { Authorization: `Bearer ${env[auth.env] ?? ''}` };
    if (auth.type === 'oauth_client_credentials') {
      if (oauthToken && oauthToken.until > now()) return { Authorization: `Bearer ${oauthToken.value}` };
      const body = new URLSearchParams({ grant_type: 'client_credentials' });
      if (auth.scope) body.set('scope', auth.scope);
      const basic = Buffer.from(`${env[auth.clientIdEnv] ?? ''}:${env[auth.clientSecretEnv] ?? ''}`).toString('base64');
      const res = await client.request(auth.tokenUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      let j: unknown;
      try {
        j = await res.json();
      } catch {
        throw new SourceParseError(sourceKey, 'malformed JSON');
      }
      const token = getPath(j, 'access_token');
      if (typeof token !== 'string' || !token) throw new SourceParseError(sourceKey, 'token response without access_token');
      const ttl = Number(getPath(j, 'expires_in'));
      oauthToken = { value: token, until: now() + (Number.isFinite(ttl) && ttl > 30 ? (ttl - 30) * 1000 : 300000) };
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }
  return { headers };
}

export interface ConfigAdapterDeps {
  env: Record<string, string | undefined>;
  http?: Omit<HttpClientOptions, 'sourceKey'>;
}

export function createConfigAdapter(c: SourceConfig, sourceId: string, deps: ConfigAdapterDeps) {
  const client = createHttpClient({ sourceKey: c.key, ...(deps.http ?? {}) });
  const auth = createAuth(c.key, c.auth, deps.env, client, deps.http?.now ?? Date.now);
  const authHeaders = auth.headers;

  async function readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new SourceParseError(c.key, 'malformed JSON');
    }
  }

  async function getPage(params: Record<string, string>): Promise<unknown> {
    const u = new URL(c.url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await client.request(u.toString(), { headers: { Accept: 'application/json', ...(await authHeaders()) } });
    return readJson(res);
  }

  function recordsOf(body: unknown): unknown[] {
    const recs = getPath(body, c.recordsPath);
    if (!Array.isArray(recs)) throw new SourceParseError(c.key, 'records not found at the configured path');
    return recs;
  }

  // Bulk: every page, bounded by maxPages.
  async function* fetchBulk(): AsyncGenerator<unknown[]> {
    const max = c.maxPages ?? 50;
    const p = c.pagination;
    if (p.type === 'none') {
      yield recordsOf(await getPage({}));
      return;
    }
    if (p.type === 'page') {
      for (let i = 0; i < max; i++) {
        const recs = recordsOf(await getPage({ [p.pageParam]: String((p.firstPage ?? 1) + i), [p.sizeParam]: String(p.size) }));
        if (recs.length > 0) yield recs;
        if (recs.length < p.size) return;
      }
      return;
    }
    if (p.type === 'offset') {
      for (let i = 0; i < max; i++) {
        const recs = recordsOf(await getPage({ [p.offsetParam]: String(i * p.limit), [p.limitParam]: String(p.limit) }));
        if (recs.length > 0) yield recs;
        if (recs.length < p.limit) return;
      }
      return;
    }
    let cursor: string | null = null;
    for (let i = 0; i < max; i++) {
      const body = await getPage(cursor ? { [p.cursorParam]: cursor } : {});
      const recs = recordsOf(body);
      if (recs.length > 0) yield recs;
      const next = getPath(body, p.nextCursorPath);
      if (typeof next !== 'string' || next === '') return;
      cursor = next;
    }
  }

  async function quote(req: QuoteRequest): Promise<NormalizedBatch> {
    const qp = c.quoteParams;
    if (!qp) throw new SourceParseError(c.key, 'quote params not configured');
    const params: Record<string, string> = { [qp.ndc]: req.ndc, [qp.quantity]: String(req.quantity) };
    if (req.zip) params[qp.zip] = req.zip;
    return normalizeRecords(recordsOf(await getPage(params)), c, sourceId);
  }

  const asQuote: PriceQuoteAdapter = { id: c.key, displayName: c.displayName, mode: 'quote', quote };
  return { config: c, fetchBulk, quote, asQuote };
}
