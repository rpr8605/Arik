// A routing partner over HTTP (M24 step 8), built on the M07 hardened
// client (timeouts, retries, 429, circuit breaker) and the shared auth from
// the config template. The partner's own field names are turned into
// Arik's shapes by `map` functions the private adapters repo supplies;
// everything is validated at the boundary after mapping.

import { createHttpClient, SourceHttpError, type HttpClientOptions } from '../pricing/http';
import { createAuth, getPath, type SourceAuth } from '../pricing/configAdapter';
import {
  RoutingProviderError,
  validateDestination,
  validateIntent,
  validateQuote,
  type RoutingDestination,
  type RoutingFailureKind,
  type RoutingIntent,
  type RoutingLocation,
  type RoutingQuote,
  type RxRoutingProvider,
} from './provider';

export interface RoutingPartnerConfig {
  key: string;                // routing_partners.partner_label
  baseUrl: string;
  auth: SourceAuth;
  paths?: { destinations?: string; quote?: string; intents?: string };
  map?: {
    destinations?: (body: unknown) => unknown[];
    quote?: (body: unknown) => unknown | null;
    intent?: (body: unknown) => unknown;
  };
}

function kindOf(e: unknown): RoutingFailureKind {
  if (e instanceof SourceHttpError) {
    if (e.kind === 'http_4xx') return e.status === 404 ? 'not_found' : 'unauthorized';
    if (e.kind === 'rate_limited') return 'rate_limited';
    if (e.kind === 'timeout') return 'timeout';
    if (e.kind === 'circuit_open') return 'circuit_open';
    return 'unavailable';
  }
  return 'malformed';
}

export function createHttpRoutingProvider(
  cfg: RoutingPartnerConfig,
  deps: { env: Record<string, string | undefined>; http?: Omit<HttpClientOptions, 'sourceKey'> },
): RxRoutingProvider {
  const client = createHttpClient({ sourceKey: `routing:${cfg.key}`, ...(deps.http ?? {}) });
  const auth = createAuth(cfg.key, cfg.auth, deps.env, client, deps.http?.now ?? Date.now);
  const paths = { destinations: '/destinations', quote: '/quote', intents: '/intents', ...(cfg.paths ?? {}) };
  const fail = (kind: RoutingFailureKind): never => {
    throw new RoutingProviderError(cfg.key, kind);
  };

  async function call(path: string, params: Record<string, string>, init: RequestInit = {}): Promise<unknown> {
    const u = new URL(cfg.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    let res: Response;
    try {
      res = await client.request(u.toString(), {
        ...init,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(await auth.headers()) },
      });
    } catch (e) {
      return fail(kindOf(e));
    }
    try {
      return await res.json();
    } catch {
      return fail('malformed');
    }
  }

  return {
    partnerLabel: cfg.key,

    async listDestinations(ndc: string, location: RoutingLocation): Promise<RoutingDestination[]> {
      let body: unknown;
      try {
        body = await call(paths.destinations, { ndc, ...(location.zip ? { zip: location.zip } : {}) });
      } catch (e) {
        if (e instanceof RoutingProviderError && e.kind === 'not_found') return [];
        throw e;
      }
      const raw = cfg.map?.destinations ? cfg.map.destinations(body) : (getPath(body, 'data') as unknown[]);
      if (!Array.isArray(raw)) fail('malformed');
      const out: RoutingDestination[] = [];
      for (const r of raw) {
        const v = validateDestination(r);
        if (!v.ok) fail('malformed');
        else out.push(v.value);
      }
      return out;
    },

    async quote(ndc: string, quantity: number, destination: RoutingDestination): Promise<RoutingQuote | null> {
      let body: unknown;
      try {
        body = await call(paths.quote, { ndc, quantity: String(quantity), destinationId: destination.destinationId });
      } catch (e) {
        if (e instanceof RoutingProviderError && e.kind === 'not_found') return null;
        throw e;
      }
      const raw = cfg.map?.quote ? cfg.map.quote(body) : getPath(body, 'data');
      if (raw == null) return null;
      const v = validateQuote(raw);
      if (!v.ok) return fail('malformed');
      if (v.value.destinationId !== destination.destinationId || v.value.ndc !== ndc) return fail('malformed');
      return v.value;
    },

    async createRoutingIntent(reference: string, destination: RoutingDestination): Promise<RoutingIntent> {
      // Only the opaque reference and the destination go out. No patient data.
      const body = await call(paths.intents, {}, { method: 'POST', body: JSON.stringify({ reference, destinationId: destination.destinationId }) });
      const v = validateIntent(cfg.map?.intent ? cfg.map.intent(body) : getPath(body, 'data'));
      if (!v.ok) return fail('malformed');
      return v.value;
    },

    async getStatus(intentId: string): Promise<RoutingIntent> {
      const body = await call(`${paths.intents}/${encodeURIComponent(intentId)}`, {});
      const v = validateIntent(cfg.map?.intent ? cfg.map.intent(body) : getPath(body, 'data'));
      if (!v.ok) return fail('malformed');
      return v.value;
    },
  };
}
