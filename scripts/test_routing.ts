// Prescription routing Part B (docs/kimi/rx_routing_build.md), mock only:
// the contract suite against the mock provider, boundary validation, data
// minimization, neutrality, no-money rules, kill switch plan, disclosure.
// No network: the mock is an in-process fetch.
// Run: npx tsx scripts/test_routing.ts

import { createHttpRoutingProvider } from '../lib/routing/httpProvider';
import { createMockRoutingFetch, mockRoutingConfig, ROUTING_MOCK_KEY_ENV, ROUTING_MOCK_NDC, type RoutingMockLog } from '../lib/routing/mockRoutingPartner';
import { runRoutingContract, MONEY_FIELD, type ContractScenario } from '../lib/routing/contract';
import { newRoutingReference, validateDestination, validateIntent, validateQuote } from '../lib/routing/provider';
import { rankDestinations, type DestinationOption } from '../lib/routing/rank';
import { planRoutingAction, routingAuditStatement } from '../lib/routing/admin';
import { publicRoutingDisclosure } from '../lib/routing/disclosure';
import { resetBreakers } from '../lib/pricing/http';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const SECRET = 'rk_test_never_logged_4410';
const env = { [ROUTING_MOCK_KEY_ENV]: SECRET };
const http = { sleep: async () => {}, timeoutMs: 40, maxRetries: 1, random: () => 0.5 };

(async () => {
  // --- The contract suite, run against the mock ---
  const results = await runRoutingContract(
    (s: ContractScenario) => {
      resetBreakers();
      return createHttpRoutingProvider(mockRoutingConfig(), { env, http: { ...http, fetchImpl: createMockRoutingFetch(s) } });
    },
    { ndc: ROUTING_MOCK_NDC, unknownNdc: '11111111111', zip: '10001', quantity: 30 },
  );
  for (const r of results) check(`contract: ${r.name}`, r.pass, r.pass ? '' : r.detail ?? '');

  // --- Data minimization: what the partner receives ---
  resetBreakers();
  const log: RoutingMockLog = { calls: [] };
  const p = createHttpRoutingProvider(mockRoutingConfig(), { env, http: { ...http, fetchImpl: createMockRoutingFetch('valid', log) } });
  const [d] = await p.listDestinations(ROUTING_MOCK_NDC, { zip: '10001' });
  const ref = newRoutingReference();
  await p.createRoutingIntent(ref, d);
  const post = log.calls.find((c) => c.method === 'POST');
  check('intent request carries only the opaque reference and the destination', post?.body === JSON.stringify({ reference: ref, destinationId: d.destinationId }), post?.body ?? '');
  check('destination lookup sends only NDC and zip', log.calls[0].params.ndc === ROUTING_MOCK_NDC && Object.keys(log.calls[0].params).sort().join() === 'ndc,zip');
  check('the reference is random, not a case id or patient detail', /^arik-[0-9a-f]{20}$/.test(ref) && newRoutingReference() !== ref);
  check('auth header sent (mock records presence only)', log.calls.every((c) => c.auth === 'present'));

  // --- Boundary validation ---
  check('destination: bad NPI rejected', !validateDestination({ destinationId: 'x', pharmacyName: 'P', npi: '123', address: 'a', zip: '10001', mailOrder: false }).ok);
  check('destination: missing mailOrder rejected (never defaulted)', !validateDestination({ destinationId: 'x', pharmacyName: 'P', npi: '1234567890', address: 'a', zip: '10001' }).ok);
  check('quote: zero price rejected', !validateQuote({ destinationId: 'x', ndc: ROUTING_MOCK_NDC, quantity: 30, priceUsd: 0, observedAt: '2026-10-16' }).ok);
  check('quote: hyphenated NDC normalized to 11 digits', (validateQuote({ destinationId: 'x', ndc: '0000-0000-01', quantity: 30, priceUsd: 5, observedAt: '2026-10-16' }) as any).value?.ndc === '00000000001');
  check('intent: unknown status rejected', !validateIntent({ intentId: 'i', reference: 'r', destinationId: 'd', status: 'paid', updatedAt: '2026-10-16T00:00:00Z' }).ok);

  // --- Neutrality (M24 step 9): affiliation never changes the order ---
  const dest = (id: string, npi: string, lat: number, lng: number, mailOrder = false) => ({ destinationId: id, pharmacyName: `P ${id}`, npi, ncpdp: null, address: 'a', zip: '10001', phone: null, fax: null, mailOrder, lat, lng });
  const quote = (id: string, price: number, observedAt = '2026-10-15') => ({ destinationId: id, ndc: ROUTING_MOCK_NDC, quantity: 30, priceUsd: price, observedAt, expiresAt: null });
  const base: DestinationOption[] = [
    { destination: dest('a', '1000000003', 40.75, -73.99), quote: quote('a', 24), sourceLabel: 'S' },
    { destination: dest('b', '1000000004', 40.80, -73.95), quote: quote('b', 21.5), sourceLabel: 'S' },
    { destination: dest('c', '1000000005', 40.70, -74.00), quote: quote('c', 21.5), sourceLabel: 'S' },
    { destination: dest('m', '1000000006', 41.5, -72.0, true), quote: quote('m', 9), sourceLabel: 'S' },
    { destination: dest('s', '1000000007', 40.75, -73.99), quote: quote('s', 5, '2026-09-01'), sourceLabel: 'S' },
  ];
  const patient = { location: { lat: 40.7506, lng: -73.9972 }, mailOrderOk: false, asOf: '2026-10-16T12:00:00Z' };
  const plain = rankDestinations(base, patient);
  const flags = [true, false];
  let identical = true;
  for (const a of flags) for (const b of flags) {
    const toggled = base.map((o, i) => ({ ...o, affiliated: i % 2 === 0 ? a : b, partnerLabel: a ? 'routing partner (mock)' : null }));
    identical &&= JSON.stringify(rankDestinations(toggled, patient)) === JSON.stringify(plain);
  }
  check('neutrality: identical order and output with affiliation toggled every way', identical);
  check('ranking output carries no partner identity', !Object.keys(plain[0]).some((k) => /partner|affiliat/i.test(k)));
  check('order: cheaper first, then nearer among equal prices', plain.map((r) => r.destinationId).slice(0, 3).join() === 'c,b,a', plain.map((r) => r.destinationId).join());
  check('mail order left out when the patient did not want it', !plain.some((r) => r.mailOrder));
  check('a stale price is shown without a number and ranks last', plain.at(-1)?.destinationId === 's' && plain.at(-1)?.priceUsd === null);

  // --- No money for routing ---
  check('the money-word guard catches fee, referral, commission, affiliate', ['referral_fee', 'commissionUsd', 'affiliateId', 'rebate'].every((k) => MONEY_FIELD.test(k)));

  // --- Kill switch and purge ---
  const plan = planRoutingAction('purge', 'pid');
  check('purge disables the partner first, then deletes its intents', /enabled = false/.test(plan[0].sql) && plan[1].counts === 'intents_deleted');
  check('enable flips only enabled (the DB still requires a data use agreement date)', planRoutingAction('enable', 'pid').length === 1 && /enabled = true/.test(planRoutingAction('enable', 'pid')[0].sql));
  check('routing audit holds counts only', routingAuditStatement('purge', 'pid', { intents_deleted: 2 }).params[2] === '{"intents_deleted":2}');

  // --- Public disclosure, generated from the table ---
  const disc = publicRoutingDisclosure([
    { partner_label: 'routing partner (mock)', enabled: false, compensation_to_arik: 'none' },
    { partner_label: 'Partner B', enabled: true, compensation_to_arik: 'none' },
  ]);
  check('disclosure lists enabled partners only, by label', disc.labels.join() === 'Partner B');
  check('disclosure states Arik receives nothing for routing', /Arik receives nothing for routing/.test(disc.statement));
  check('no partners enabled -> says so', publicRoutingDisclosure([]).labels.length === 0 && /No routing partners/.test(publicRoutingDisclosure([]).none));
  check('no em dashes in the disclosure', !/—/.test(JSON.stringify(disc)));

  console.log(failures === 0 ? '\nROUTING: ALL PASS' : `\nROUTING: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
