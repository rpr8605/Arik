// Partner readiness (M07-AC2..AC6, M06-AC1), mock only: the config-driven
// adapter against every mock partner scenario, auth types, pagination,
// the startup env check, no-leak logging, quote fallback and cache, and
// the kill switch / purge plan. No network: the mock is an in-process fetch.
// Run: npx tsx scripts/test_partner_readiness.ts

import { createConfigAdapter, checkSourceEnv, assertSourceEnv, normalizeRecords, requiredEnv, type SourceConfig } from '../lib/pricing/configAdapter';
import { createMockPartnerFetch, mockSourceConfig, MOCK_API_KEY_ENV, MOCK_NDC, type MockLog, type MockScenario } from '../lib/pricing/mockPartner';
import { resetBreakers } from '../lib/pricing/http';
import { createQuoteCache, getQuotes, quoteToPriceRow, unavailableNote } from '../lib/pricing/quotes';
import { enabledQuoteAdapters, QUOTE_SOURCE_CONFIGS } from '../lib/pricing/quoteSources';
import { auditStatement, parseAdminArgs, planAdminAction } from '../lib/pricing/sourceAdmin';
import { partitionPricesForConsent } from '../lib/pricing/enforcement';
import type { PriceQuoteAdapter } from '../lib/pricing/adapter';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const SECRET = 'sk_test_DO_NOT_LEAK_7731';
const env = { [MOCK_API_KEY_ENV]: SECRET };
const fastHttp = { sleep: async () => {}, timeoutMs: 40, maxRetries: 1, random: () => 0.5 };

function adapter(scenario: MockScenario, mode: 'bulk' | 'quote', log?: MockLog, cfg?: Partial<SourceConfig>) {
  resetBreakers();
  return createConfigAdapter(mockSourceConfig(mode, cfg), 'src-uuid', { env, http: { ...fastHttp, fetchImpl: createMockPartnerFetch(scenario, log) } });
}

async function collect(gen: AsyncGenerator<unknown[]>): Promise<unknown[]> {
  const all: unknown[] = [];
  for await (const page of gen) all.push(...page);
  return all;
}

// Capture everything written to the console while fn runs.
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = grab;
  console.warn = grab;
  console.error = grab;
  try {
    await fn();
  } finally {
    Object.assign(console, orig);
  }
  return lines.join('\n');
}

(async () => {
  // --- Scenarios (M07-AC3) ---
  const log: MockLog = { calls: [] };
  const valid = await adapter('valid', 'quote', log).quote({ ndc: MOCK_NDC, quantity: 30, zip: '10001' });
  check('valid quote: 2 prices, normalized and validated', valid.accepted.length === 2 && valid.accepted[0].ndc === MOCK_NDC && valid.accepted[0].price === 12.5 && valid.rejected.length === 0);
  check('quote sends ndc, qty and zip as configured', log.calls[0]?.params.ndc === MOCK_NDC && log.calls[0]?.params.qty === '30' && log.calls[0]?.params.zip === '10001');
  check('api key auth header is sent (mock records presence only)', log.calls[0]?.auth === 'present');
  check('pharmacy NPI and zip carried for pharmacy matching', valid.accepted[0].pharmacy_npi === '1000000000' && valid.accepted[0].pharmacy_zip === '10001');

  const paged = await collect(adapter('paginated', 'bulk').fetchBulk());
  check('paginated bulk pull collects every page (5 records over 3 pages)', paged.length === 5);

  for (const [s, kind] of [['unauthorized', 'http_4xx'], ['server_error', 'http_5xx'], ['timeout', 'timeout']] as const) {
    let err: any = null;
    await adapter(s, 'quote').quote({ ndc: MOCK_NDC, quantity: 30, zip: null }).catch((e) => (err = e));
    check(`${s}: fails with ${kind}, no body or secret in the message`, err?.kind === kind && !String(err?.message).includes(SECRET) && !String(err?.message).includes('boom'), String(err?.message));
  }
  const after429 = await adapter('rate_limited', 'quote').quote({ ndc: MOCK_NDC, quantity: 30, zip: null });
  check('429 then OK: retried after Retry-After and answered', after429.accepted.length === 2);
  const after503 = await adapter('server_error_then_ok', 'quote').quote({ ndc: MOCK_NDC, quantity: 30, zip: null });
  check('503 then OK: retried and answered', after503.accepted.length === 2);

  let parseErr: any = null;
  await adapter('malformed', 'quote').quote({ ndc: MOCK_NDC, quantity: 30, zip: null }).catch((e) => (parseErr = e));
  check('malformed JSON: SourceParseError, no payload in the message', parseErr?.name === 'SourceParseError' && !String(parseErr?.message).includes('product_ndc'));

  const unknown = await adapter('unknown_ndc', 'quote').quote({ ndc: '11111111111', quantity: 30, zip: null });
  check('unknown NDC: no prices, not an error', unknown.accepted.length === 0 && unknown.rejected.length === 0);

  const stale = await adapter('stale', 'quote').quote({ ndc: MOCK_NDC, quantity: 30, zip: null });
  const staleRows = stale.accepted.map((p) => ({ ...quoteToPriceRow(p, 'drug'), price_source_id: 'src-uuid' }));
  const part = partitionPricesForConsent(staleRows, {
    sourcesById: { 'src-uuid': { id: 'src-uuid', name: 'mock_partner', enabled: true, max_staleness_hours: 72, allow_patient_display: true, allow_ai_processing: true } as any },
    now: '2026-10-16T12:00:00Z',
  });
  check('stale prices: accepted by the adapter, then excluded by the staleness gate', stale.accepted.length === 1 && part.allowed.length === 0 && part.excludedStale.length === 1);

  // Field validation at the boundary: rejects, never coerced.
  const cfg = mockSourceConfig('quote');
  const bad = normalizeRecords(
    [
      { product_ndc: 'abc', product_name: 'X', cash_price: '1', qty: 1, price_date: '2026-10-16', quote_id: 'a' },
      { product_ndc: MOCK_NDC, product_name: 'X', cash_price: '-4', qty: 1, price_date: '2026-10-16', quote_id: 'b' },
      { product_ndc: MOCK_NDC, product_name: 'X', cash_price: '4', qty: 1, price_date: '16/10/2026', quote_id: 'c' },
      { product_ndc: MOCK_NDC, product_name: 'X', cash_price: '4', qty: 1, price_date: '2026-10-16', quote_id: 'd', pharmacy: { npi: '12' } },
      { product_ndc: MOCK_NDC, product_name: 'X', cash_price: '4', qty: 1, price_date: '2026-10-16', quote_id: 'e', referral_fee: '2.00', affiliate_id: 'zz' },
    ],
    cfg,
    'src',
  );
  check('bad NDC, negative price, non-ISO date and bad NPI are rejected with reasons', bad.rejected.map((r) => r.reason).join('|') === 'bad ndc|bad price|bad observed date|bad pharmacy npi');
  check('referral/affiliate fields in a record are never mapped', bad.accepted.length === 1 && !('referral_fee' in bad.accepted[0]) && !('affiliate_id' in bad.accepted[0]));

  // --- Auth types (M07-AC2) ---
  const seen: { auth: string | null; url: string }[] = [];
  const echo = (async (u: string, init?: RequestInit) => {
    seen.push({ auth: new Headers(init?.headers).get('authorization'), url: String(u) });
    if (String(u).includes('/token')) return new Response(JSON.stringify({ access_token: 'tok123', expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  resetBreakers();
  await createConfigAdapter(mockSourceConfig('quote', { auth: { type: 'bearer', env: 'B_TOKEN' } }), 's', { env: { B_TOKEN: 'bearer-x' }, http: { ...fastHttp, fetchImpl: echo } }).quote({ ndc: MOCK_NDC, quantity: 1, zip: null });
  check('bearer auth sends Authorization: Bearer <env value>', seen[0]?.auth === 'Bearer bearer-x');
  seen.length = 0;
  const oauth = createConfigAdapter(
    mockSourceConfig('quote', { auth: { type: 'oauth_client_credentials', tokenUrl: 'https://mock-partner.invalid/token', clientIdEnv: 'CID', clientSecretEnv: 'CSEC' } }),
    's',
    { env: { CID: 'id', CSEC: 'sec' }, http: { ...fastHttp, fetchImpl: echo } },
  );
  await oauth.quote({ ndc: MOCK_NDC, quantity: 1, zip: null });
  await oauth.quote({ ndc: MOCK_NDC, quantity: 2, zip: null });
  check('oauth client credentials: token fetched once, reused, sent as Bearer', seen.filter((s) => s.url.includes('/token')).length === 1 && seen.filter((s) => s.auth === 'Bearer tok123').length === 2);

  // --- Pagination types (M07-AC2) ---
  const pages = (style: 'offset' | 'cursor') =>
    (async (u: string) => {
      const p = new URL(String(u)).searchParams;
      const n = style === 'offset' ? Number(p.get('offset') ?? 0) / 2 : Number(p.get('cursor') ?? 0);
      const data = n < 2 ? [{ i: n * 2 }, { i: n * 2 + 1 }] : [{ i: 4 }];
      return new Response(JSON.stringify({ data, next: n < 2 ? String(n + 1) : '' }), { status: 200 });
    }) as unknown as typeof fetch;
  resetBreakers();
  const off = await collect(createConfigAdapter(mockSourceConfig('bulk', { pagination: { type: 'offset', offsetParam: 'offset', limitParam: 'limit', limit: 2 } }), 's', { env, http: { ...fastHttp, fetchImpl: pages('offset') } }).fetchBulk());
  const cur = await collect(createConfigAdapter(mockSourceConfig('bulk', { pagination: { type: 'cursor', cursorParam: 'cursor', nextCursorPath: 'next' } }), 's', { env, http: { ...fastHttp, fetchImpl: pages('cursor') } }).fetchBulk());
  check('offset pagination collects all 5 records', off.length === 5);
  check('cursor pagination follows next until empty (5 records)', cur.length === 5);

  // --- Startup env check (M07-AC6) ---
  const enabledCfg = mockSourceConfig('quote');
  check('required env names come from the config', requiredEnv(enabledCfg).join() === MOCK_API_KEY_ENV);
  const miss = checkSourceEnv([enabledCfg, mockSourceConfig('quote', { key: 'off', enabled: false, auth: { type: 'bearer', env: 'NOPE' } })], {});
  check('enabled source missing its key fails the check; disabled sources are ignored', !miss.ok && miss.missing.length === 1 && miss.missing[0].vars[0] === MOCK_API_KEY_ENV);
  let thrown = '';
  try {
    assertSourceEnv([enabledCfg], { [MOCK_API_KEY_ENV]: '   ' });
  } catch (e) {
    thrown = (e as Error).message;
  }
  check('startup assert throws naming the variable, never a value', thrown.includes(MOCK_API_KEY_ENV) && !thrown.includes(SECRET));
  check('this repo registers no quote source (real partner config lives in the private repo)', QUOTE_SOURCE_CONFIGS.length === 0);
  let looked = false;
  const none = await enabledQuoteAdapters(async () => {
    looked = true;
    return [];
  });
  check('no quote configs -> no adapters and no database lookup', none.length === 0 && !looked);
  const gated = await enabledQuoteAdapters(async () => [{ id: 'x', name: 'mock_partner', enabled: false }], env, [enabledCfg]);
  check('a config whose price_sources row is disabled is not used (kill switch)', gated.length === 0);

  // --- Quotes in chat: fallback + cache (M07-AC4) ---
  const good = adapter('valid', 'quote').asQuote;
  resetBreakers();
  const down: PriceQuoteAdapter = { id: 'down', displayName: 'Pricing partner B', mode: 'quote', quote: async () => { throw new Error('ECONNREFUSED https://secret.endpoint/v1?key=' + SECRET); } };
  let r: Awaited<ReturnType<typeof getQuotes>> = { prices: [], unavailable: [] };
  const logs = await captureLogs(async () => {
    r = await getQuotes([good, down], [{ ndc: MOCK_NDC, quantity: 30, zip: null }]);
  });
  check('one source down: chat still gets the other source prices', r.prices.length === 2);
  check('the failed source is named by its public label only', r.unavailable.join() === 'Pricing partner B');
  check('the patient is told a source did not answer', /Pricing partner B aren't included because it didn't answer/.test(unavailableNote(r.unavailable, 'en')));
  check('Spanish note too', /no respondió/.test(unavailableNote(r.unavailable, 'es')));
  check('no-leak: nothing logged contains the secret, the endpoint or a price', !logs.includes(SECRET) && !logs.includes('secret.endpoint') && !logs.includes('12.5'), logs.slice(0, 120));
  const allDown = await getQuotes([down], [{ ndc: MOCK_NDC, quantity: 30, zip: null }]);
  check('every source down: empty prices, no throw', allDown.prices.length === 0 && allDown.unavailable.length === 1);

  let calls = 0;
  let clock = 0;
  const counting: PriceQuoteAdapter = { id: 'c', displayName: 'C', mode: 'quote', quote: async () => { calls++; return { accepted: valid.accepted, rejected: [] }; } };
  const cache = createQuoteCache(1000, () => clock);
  await getQuotes([counting], [{ ndc: MOCK_NDC, quantity: 30, zip: null }], { cache });
  await getQuotes([counting], [{ ndc: MOCK_NDC, quantity: 30, zip: null }], { cache });
  check('quote cache: a repeat within the TTL does not call the source', calls === 1);
  clock = 2000;
  await getQuotes([counting], [{ ndc: MOCK_NDC, quantity: 30, zip: null }], { cache });
  check('quote cache: after the TTL the source is asked again', calls === 2);

  // --- Kill switch and purge (M07-AC5) ---
  check('admin args: purge <name> parsed', JSON.stringify(parseAdminArgs(['purge', 'mock_partner'])) === '{"action":"purge","source":"mock_partner"}');
  check('admin args: bad action or name refused', 'error' in parseAdminArgs(['drop', 'x']) && 'error' in parseAdminArgs(['purge', 'x; drop table']));
  const plan = planAdminAction('purge', 'sid');
  check('purge disables the source first, then deletes its prices, staging rows and runs', /enabled = false/.test(plan[0].sql) && plan.slice(1).map((p) => p.counts).join() === 'price_points_deleted,raw_rows_deleted,ingest_runs_deleted');
  check('every statement is parameterized by source id', plan.every((p) => p.params[0] === 'sid' && !p.sql.includes('sid')));
  check('disable only flips enabled', planAdminAction('disable', 'sid').length === 1);
  const audit = auditStatement('purge', 'sid', { price_points_deleted: 3 });
  check('audit row holds counts only', audit.params[2] === '{"price_points_deleted":3}');

  console.log(failures === 0 ? '\nPARTNER READINESS: ALL PASS' : `\nPARTNER READINESS: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
