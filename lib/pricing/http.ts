// Hardened HTTP client for price sources (M07-AC1, Appendix B2 Part B).
// Every partner or public-data call goes through this: a per-request
// timeout (AbortController), retry on 5xx and network errors with
// exponential backoff plus jitter, 429 handling that honors Retry-After,
// and a per-source circuit breaker so a failing source is skipped fast
// instead of slowing every chat turn.
//
// Errors never carry response bodies, request bodies, headers or query
// strings: only the source key, a status and a short reason. That is
// what the no-leak test (test_partner_readiness.ts) checks.

export interface HttpClientOptions {
  sourceKey: string;
  timeoutMs?: number;          // per attempt; default 8000
  maxRetries?: number;         // retries after the first try; default 2
  baseBackoffMs?: number;      // default 250
  maxBackoffMs?: number;       // cap for any single wait; default 5000
  breakerThreshold?: number;   // consecutive failures that open the breaker; default 5
  breakerCooldownMs?: number;  // how long it stays open; default 60000
  // Seams for tests: no network, no real clock.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export type HttpFailureKind = 'timeout' | 'network' | 'http_4xx' | 'http_5xx' | 'rate_limited' | 'circuit_open';

export class SourceHttpError extends Error {
  constructor(
    readonly sourceKey: string,
    readonly kind: HttpFailureKind,
    readonly status: number | null,
  ) {
    super(`source ${sourceKey}: ${kind}${status != null ? ` (${status})` : ''}`);
    this.name = 'SourceHttpError';
  }
}

interface BreakerState {
  failures: number;
  openUntil: number;
}

// Breaker state is per source key and per process.
const breakers = new Map<string, BreakerState>();

export function resetBreakers(): void {
  breakers.clear();
}

export function breakerOpen(sourceKey: string, now = Date.now()): boolean {
  const b = breakers.get(sourceKey);
  return !!b && b.openUntil > now;
}

// Retry-After is either delta-seconds or an HTTP date.
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export function backoffMs(attempt: number, base: number, cap: number, random: () => number): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  // "Full jitter": anywhere between half and all of the exponential step.
  return Math.round(exp / 2 + random() * (exp / 2));
}

export function createHttpClient(opts: HttpClientOptions) {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRetries = opts.maxRetries ?? 2;
  const base = opts.baseBackoffMs ?? 250;
  const cap = opts.maxBackoffMs ?? 5000;
  const threshold = opts.breakerThreshold ?? 5;
  const cooldown = opts.breakerCooldownMs ?? 60000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const key = opts.sourceKey;

  function recordFailure() {
    const b = breakers.get(key) ?? { failures: 0, openUntil: 0 };
    b.failures += 1;
    if (b.failures >= threshold) b.openUntil = now() + cooldown;
    breakers.set(key, b);
  }
  function recordSuccess() {
    breakers.set(key, { failures: 0, openUntil: 0 });
  }

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    if (breakerOpen(key, now())) throw new SourceHttpError(key, 'circuit_open', null);
    let last: SourceHttpError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response | null = null;
      try {
        res = await doFetch(url, { ...init, signal: controller.signal });
      } catch (e) {
        const aborted = (e as Error)?.name === 'AbortError' || controller.signal.aborted;
        last = new SourceHttpError(key, aborted ? 'timeout' : 'network', null);
      } finally {
        clearTimeout(timer);
      }
      if (res) {
        if (res.ok) {
          recordSuccess();
          return res;
        }
        if (res.status === 429) {
          last = new SourceHttpError(key, 'rate_limited', 429);
          const wait = parseRetryAfter(res.headers.get('retry-after'), now());
          if (attempt < maxRetries) {
            // A Retry-After longer than the cap is not worth waiting for in
            // a chat turn: give up now and let the caller fall back.
            if (wait != null && wait > cap) break;
            await sleep(wait ?? backoffMs(attempt, base, cap, random));
            continue;
          }
          break;
        }
        if (res.status >= 500) {
          last = new SourceHttpError(key, 'http_5xx', res.status);
        } else {
          // 4xx other than 429 will not get better by retrying (401, 404...).
          recordFailure();
          throw new SourceHttpError(key, 'http_4xx', res.status);
        }
      }
      if (attempt < maxRetries) await sleep(backoffMs(attempt, base, cap, random));
    }
    recordFailure();
    throw last ?? new SourceHttpError(key, 'network', null);
  }

  return { request };
}
