// Mock routing partner (M24 step 8). Local only, obvious fixtures: no real
// partner's name, endpoints, pharmacies or prices. NPIs 1000000001.., NDC
// 00000000001 (MOCKDRUG), zips 10001/10002. Tests use the in-process fetch.
//
// Scenarios: valid, unauthorized (401), rate_limited (429 then OK),
// server_error (500), timeout, malformed, unknown_ndc.

import type { RoutingPartnerConfig } from './httpProvider';

export type RoutingMockScenario = 'valid' | 'unauthorized' | 'rate_limited' | 'server_error' | 'timeout' | 'malformed' | 'unknown_ndc';

export const ROUTING_MOCK_BASE = 'https://mock-routing.invalid/v1';
export const ROUTING_MOCK_KEY_ENV = 'MOCK_ROUTING_API_KEY';
export const ROUTING_MOCK_NDC = '00000000001';

const DESTINATIONS = [
  { destinationId: 'd-1', pharmacyName: 'Mock Pharmacy One', npi: '1000000001', ncpdp: '1000001', address: '1 Sample St, New York, NY', zip: '10001', phone: '(555) 555-0141', fax: '(555) 555-0142', mailOrder: false, lat: 40.7506, lng: -73.9972 },
  { destinationId: 'd-2', pharmacyName: 'Mock Mail Pharmacy', npi: '1000000002', ncpdp: null, address: '2 Sample Ave, New York, NY', zip: '10002', phone: '(555) 555-0143', fax: null, mailOrder: true, lat: 40.7157, lng: -73.9863 },
];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export interface RoutingMockLog {
  calls: { method: string; path: string; params: Record<string, string>; body: string | null; auth: 'present' | 'absent' }[];
}

export function createMockRoutingFetch(scenario: RoutingMockScenario, log: RoutingMockLog = { calls: [] }): typeof fetch {
  let hits = 0;
  const intents = new Map<string, { intentId: string; reference: string; destinationId: string; status: string; updatedAt: string }>();
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init?.headers);
    const params = Object.fromEntries(url.searchParams.entries());
    const body = typeof init?.body === 'string' ? init.body : null;
    log.calls.push({ method: init?.method ?? 'GET', path: url.pathname, params, body, auth: headers.get('x-api-key') ? 'present' : 'absent' });
    hits++;
    if (scenario === 'timeout') {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        }),
      );
    }
    if (!headers.get('x-api-key') || scenario === 'unauthorized') return json({ error: 'unauthorized' }, 401);
    if (scenario === 'rate_limited' && hits === 1) return json({ error: 'slow down' }, 429, { 'retry-after': '1' });
    if (scenario === 'server_error') return json({ error: 'boom' }, 500);
    if (scenario === 'malformed') return json({ data: [{ destinationId: 'd-x', pharmacyName: 'X', npi: '12', zip: 'abc' }] });

    const path = url.pathname.replace('/v1', '');
    if (path === '/destinations') {
      return json({ data: scenario === 'unknown_ndc' || params.ndc !== ROUTING_MOCK_NDC ? [] : DESTINATIONS });
    }
    if (path === '/quote') {
      if (scenario === 'unknown_ndc' || params.ndc !== ROUTING_MOCK_NDC) return json({ error: 'not found' }, 404);
      return json({ data: { destinationId: params.destinationId, ndc: params.ndc, quantity: Number(params.quantity), priceUsd: params.destinationId === 'd-2' ? 21.5 : 24, observedAt: '2026-10-16', expiresAt: null } });
    }
    if (path === '/intents' && (init?.method ?? 'GET') === 'POST') {
      const b = JSON.parse(body ?? '{}');
      const intent = { intentId: `i-${intents.size + 1}`, reference: b.reference, destinationId: b.destinationId, status: 'created', updatedAt: '2026-10-16T12:00:00Z' };
      intents.set(intent.intentId, intent);
      return json({ data: intent });
    }
    const m = /^\/intents\/(.+)$/.exec(path);
    if (m) {
      const i = intents.get(decodeURIComponent(m[1]));
      return i ? json({ data: { ...i, status: 'sent_to_prescriber' } }) : json({ error: 'not found' }, 404);
    }
    return json({ error: 'not found' }, 404);
  };
  return impl as typeof fetch;
}

export function mockRoutingConfig(): RoutingPartnerConfig {
  return {
    key: 'routing partner (mock)',
    baseUrl: ROUTING_MOCK_BASE,
    auth: { type: 'api_key', header: 'x-api-key', env: ROUTING_MOCK_KEY_ENV },
  };
}
