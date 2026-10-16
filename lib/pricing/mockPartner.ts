// Mock partner API (M07-AC3). Local only: no real partner's name, terms,
// endpoints or prices appear anywhere in this repo. Every record here is
// an obvious fixture (MOCKDRUG, NDC 00000-...). Tests use the in-process
// fetch (no network); scripts/mock_partner_api.ts serves the same handler
// on 127.0.0.1 for manual runs.
//
// Scenarios: valid, paginated, 401, 429 (then OK), 500 (then OK when
// `recover`), timeout, malformed JSON, stale prices, unknown NDC.

import type { SourceConfig } from './configAdapter';

export type MockScenario =
  | 'valid'
  | 'paginated'
  | 'unauthorized'
  | 'rate_limited'
  | 'server_error'
  | 'server_error_then_ok'
  | 'timeout'
  | 'malformed'
  | 'stale'
  | 'unknown_ndc';

export const MOCK_BASE = 'https://mock-partner.invalid';
export const MOCK_API_KEY_ENV = 'MOCK_PARTNER_API_KEY';
export const MOCK_NDC = '00000000001';

const TODAY = '2026-10-16';

function record(i: number, observed = TODAY) {
  return {
    product_ndc: MOCK_NDC,
    product_name: 'MOCKDRUG 10 MG TABLET',
    cash_price: (12.5 + i).toFixed(2),
    qty: 30,
    pharmacy: { npi: String(1000000000 + i), zip: '10001' },
    price_date: observed,
    quote_id: `mock-${i}`,
  };
}

const PAGE_SIZE = 2;
const ALL = [0, 1, 2, 3, 4].map((i) => record(i));

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// Requests seen, for assertions. Header values are recorded as "present"
// or "absent" only, never the value.
export interface MockLog {
  calls: { path: string; params: Record<string, string>; auth: 'present' | 'absent' }[];
}

export function createMockPartnerFetch(scenario: MockScenario, log: MockLog = { calls: [] }): typeof fetch {
  let hits = 0;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init?.headers);
    const params = Object.fromEntries(url.searchParams.entries());
    log.calls.push({ path: url.pathname, params, auth: headers.get('x-api-key') ? 'present' : 'absent' });
    hits++;

    if (scenario === 'timeout') {
      // Never answers; only the caller's abort ends it.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    }
    if (!headers.get('x-api-key') || scenario === 'unauthorized') return json({ error: 'unauthorized' }, 401);
    if (scenario === 'rate_limited' && hits === 1) return json({ error: 'slow down' }, 429, { 'retry-after': '1' });
    if (scenario === 'server_error') return json({ error: 'boom' }, 500);
    if (scenario === 'server_error_then_ok' && hits === 1) return json({ error: 'boom' }, 503);
    if (scenario === 'malformed') return new Response('{"data": [ {"product_ndc": ', { status: 200, headers: { 'content-type': 'application/json' } });

    if (url.pathname === '/v1/quote') {
      if (scenario === 'unknown_ndc' || params.ndc !== MOCK_NDC) return json({ data: [] });
      if (scenario === 'stale') return json({ data: [record(0, '2025-01-02')] });
      return json({ data: [record(0), record(1)] });
    }
    if (url.pathname === '/v1/prices') {
      if (scenario === 'paginated') {
        const page = Number(params.page ?? '1');
        return json({ data: ALL.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) });
      }
      if (scenario === 'stale') return json({ data: ALL.map((r) => ({ ...r, price_date: '2025-01-02' })) });
      return json({ data: ALL.slice(0, PAGE_SIZE) });
    }
    return json({ error: 'not found' }, 404);
  };
  return impl as typeof fetch;
}

// The config a real adapter would ship with, pointed at the mock.
export function mockSourceConfig(mode: 'bulk' | 'quote', overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    key: 'mock_partner',
    displayName: 'Pricing partner (mock)',
    mode,
    enabled: true,
    url: mode === 'bulk' ? `${MOCK_BASE}/v1/prices` : `${MOCK_BASE}/v1/quote`,
    auth: { type: 'api_key', header: 'x-api-key', env: MOCK_API_KEY_ENV },
    pagination: mode === 'bulk' ? { type: 'page', pageParam: 'page', sizeParam: 'per_page', size: PAGE_SIZE } : { type: 'none' },
    recordsPath: 'data',
    quoteParams: { ndc: 'ndc', quantity: 'qty', zip: 'zip' },
    fieldMap: {
      ndc: 'product_ndc',
      drug_name: 'product_name',
      price: 'cash_price',
      quantity: 'qty',
      observed_at: 'price_date',
      record_ref: 'quote_id',
      pharmacy_npi: 'pharmacy.npi',
      pharmacy_zip: 'pharmacy.zip',
    },
    priceType: 'cash',
    unit: 'per_fill',
    ...overrides,
  };
}
