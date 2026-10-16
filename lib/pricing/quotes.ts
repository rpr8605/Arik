// Live price quotes for chat (M07-AC4). Every enabled quote-mode source is
// asked in parallel through its adapter (hardened client underneath), with
// a short-lived cache. A source that fails, times out or is circuit-open is
// reported by its public label and the chat answers from everything else:
// a partner failing never fails the chat.
//
// Quote rows enter ranking as price rows and pass the same consent and
// staleness partition as every other source (lib/pricing/enforcement.ts).

import type { NormalizedPrice, PriceQuoteAdapter, QuoteRequest } from './adapter';

export interface QuoteOutcome {
  prices: NormalizedPrice[];
  unavailable: string[];   // public labels of sources that didn't answer
}

export interface QuoteCache {
  get(key: string): NormalizedPrice[] | undefined;
  set(key: string, v: NormalizedPrice[]): void;
}

export function createQuoteCache(ttlMs = 10 * 60 * 1000, now: () => number = Date.now, maxEntries = 500): QuoteCache {
  const m = new Map<string, { v: NormalizedPrice[]; until: number }>();
  return {
    get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (e.until <= now()) {
        m.delete(key);
        return undefined;
      }
      return e.v;
    },
    set(key, v) {
      if (m.size >= maxEntries) m.delete(m.keys().next().value as string);
      m.set(key, { v, until: now() + ttlMs });
    },
  };
}

const quoteKey = (a: PriceQuoteAdapter, r: QuoteRequest) => `${a.id}|${r.ndc}|${r.quantity}|${r.zip ?? ''}`;

export async function getQuotes(
  adapters: PriceQuoteAdapter[],
  requests: QuoteRequest[],
  opts: { cache?: QuoteCache } = {},
): Promise<QuoteOutcome> {
  const out: QuoteOutcome = { prices: [], unavailable: [] };
  if (adapters.length === 0 || requests.length === 0) return out;
  await Promise.all(
    adapters.map(async (a) => {
      let failed = false;
      for (const r of requests) {
        const key = quoteKey(a, r);
        const cached = opts.cache?.get(key);
        if (cached) {
          out.prices.push(...cached);
          continue;
        }
        try {
          const batch = await a.quote(r);
          opts.cache?.set(key, batch.accepted);
          out.prices.push(...batch.accepted);
        } catch {
          // The error itself is never surfaced: it could name an endpoint.
          failed = true;
        }
      }
      if (failed && !out.unavailable.includes(a.displayName)) out.unavailable.push(a.displayName);
    }),
  );
  return out;
}

// A quote as a price row the ranking engine already understands.
export function quoteToPriceRow(p: NormalizedPrice, drugId: string) {
  return {
    drug_id: drugId,
    price_type: p.price_type,
    price_usd: p.price,
    supply_days: null,
    unit_count: p.quantity,
    ndc: p.ndc,
    price_source_id: p.source_id,
    observed_at: p.observed_at,
    expires_at: p.expires_at,
    sources: null,
  };
}

export function unavailableNote(names: string[], lang: 'en' | 'es'): string {
  if (names.length === 0) return '';
  const list = names.join(', ');
  return lang === 'es'
    ? `\n\nNo incluí precios de ${list} porque no respondió en este momento.`
    : `\n\nPrices from ${list} aren't included because it didn't answer just now.`;
}
