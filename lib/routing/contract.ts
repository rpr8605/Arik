// The routing contract suite (M24 step 8): the checks EVERY routing
// provider must pass, the mock here and the real partner's adapter in the
// private repo (with recorded, scrubbed sandbox fixtures standing in for
// each scenario). Returns results; the caller prints and exits.

import { RoutingProviderError, newRoutingReference, type RxRoutingProvider } from './provider';

export type ContractScenario = 'valid' | 'unauthorized' | 'rate_limited' | 'server_error' | 'timeout' | 'malformed' | 'unknown_ndc';

export interface ContractFixture {
  ndc: string;          // an NDC the provider knows
  unknownNdc: string;   // one it doesn't
  zip: string;
  quantity: number;
}

export interface ContractResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// Money words that must never appear as a field on anything a provider
// returns (no money for routing, ever).
export const MONEY_FIELD = /fee|commission|referral|affiliate|rebate|kickback|compensation|bounty|incentive/i;

function moneyKeys(obj: unknown, path = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => [
    ...(MONEY_FIELD.test(k) ? [`${path}${k}`] : []),
    ...moneyKeys(v, `${path}${k}.`),
  ]);
}

async function failsWith(p: Promise<unknown>, kinds: string[]): Promise<{ ok: boolean; got: string }> {
  try {
    await p;
    return { ok: false, got: 'no error' };
  } catch (e) {
    const got = e instanceof RoutingProviderError ? e.kind : `non-routing error: ${(e as Error)?.name}`;
    return { ok: e instanceof RoutingProviderError && kinds.includes(e.kind), got };
  }
}

export async function runRoutingContract(providerFor: (s: ContractScenario) => RxRoutingProvider, fx: ContractFixture): Promise<ContractResult[]> {
  const out: ContractResult[] = [];
  const add = (name: string, pass: boolean, detail?: string) => out.push({ name, pass, detail });

  // valid
  const p = providerFor('valid');
  const dests = await p.listDestinations(fx.ndc, { zip: fx.zip });
  add('valid: destinations returned and validated', dests.length > 0 && dests.every((d) => /^\d{10}$/.test(d.npi) && /^\d{5}$/.test(d.zip)), `${dests.length}`);
  const q = dests[0] ? await p.quote(fx.ndc, fx.quantity, dests[0]) : null;
  add('valid: quote for the same NDC and destination, price above zero', !!q && q.ndc === fx.ndc && q.destinationId === dests[0].destinationId && q.priceUsd > 0);
  const ref = newRoutingReference();
  const intent = dests[0] ? await p.createRoutingIntent(ref, dests[0]) : null;
  add('valid: routing intent created, carrying our opaque reference', !!intent && intent.reference === ref && intent.status === 'created');
  const status = intent ? await p.getStatus(intent.intentId) : null;
  add('valid: status read back for the same intent', !!status && status.intentId === intent!.intentId && status.reference === ref);
  const money = [...moneyKeys(dests), ...moneyKeys(q), ...moneyKeys(intent), ...moneyKeys(status)];
  add('no fee, referral, commission or affiliate field on anything returned', money.length === 0, money.join(', '));

  // unknown NDC
  const u = providerFor('unknown_ndc');
  const none = await u.listDestinations(fx.unknownNdc, { zip: fx.zip });
  add('unknown NDC: no destinations, not an error', none.length === 0);
  const noQuote = dests[0] ? await u.quote(fx.unknownNdc, fx.quantity, dests[0]) : null;
  add('unknown NDC: no quote, not an error', noQuote === null);

  // failures
  const r401 = await failsWith(providerFor('unauthorized').listDestinations(fx.ndc, { zip: fx.zip }), ['unauthorized']);
  add('401: unauthorized', r401.ok, r401.got);
  const r500 = await failsWith(providerFor('server_error').listDestinations(fx.ndc, { zip: fx.zip }), ['unavailable']);
  add('500: unavailable after retries', r500.ok, r500.got);
  const rTimeout = await failsWith(providerFor('timeout').listDestinations(fx.ndc, { zip: fx.zip }), ['timeout']);
  add('timeout: times out, never hangs', rTimeout.ok, rTimeout.got);
  const rBad = await failsWith(providerFor('malformed').listDestinations(fx.ndc, { zip: fx.zip }), ['malformed']);
  add('malformed: rejected at the boundary, never coerced', rBad.ok, rBad.got);
  let rateOk = false;
  try {
    rateOk = (await providerFor('rate_limited').listDestinations(fx.ndc, { zip: fx.zip })).length > 0;
  } catch (e) {
    rateOk = e instanceof RoutingProviderError && e.kind === 'rate_limited';
  }
  add('429: honored (retried after Retry-After, or reported as rate_limited)', rateOk);
  return out;
}
