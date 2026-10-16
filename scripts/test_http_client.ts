// Hardened HTTP client (M07-AC1): timeouts, 5xx retry with backoff and
// jitter, 429 + Retry-After, circuit breaker. Fake fetch and fake sleep,
// so no network and no real waiting.
// Run: npx tsx scripts/test_http_client.ts

import { backoffMs, breakerOpen, createHttpClient, parseRetryAfter, resetBreakers, SourceHttpError } from '../lib/pricing/http';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

function scripted(statuses: (number | 'hang' | 'neterr')[], headers: Record<string, string> = {}) {
  let i = 0;
  const calls: number[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    const s = statuses[Math.min(i, statuses.length - 1)];
    calls.push(i++);
    if (s === 'hang') {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        }),
      );
    }
    if (s === 'neterr') throw new TypeError('fetch failed');
    return new Response(s === 200 ? '{"ok":true}' : '{"secret_body":"should never leak"}', { status: s, headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function run(name: string, fn: () => Promise<void>) {
  resetBreakers();
  try {
    await fn();
  } catch (e) {
    check(`${name} (threw unexpectedly)`, false, (e as Error).message);
  }
}

(async () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const base = { sleep, random: () => 0.5, baseBackoffMs: 100, maxBackoffMs: 2000 };

  await run('ok', async () => {
    const { f, calls } = scripted([200]);
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, ...base });
    const r = await c.request('https://x.invalid/a');
    check('200 returns the response on the first try', r.status === 200 && calls.length === 1);
  });

  await run('5xx', async () => {
    sleeps.length = 0;
    const { f, calls } = scripted([500, 503, 200]);
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, ...base });
    const r = await c.request('https://x.invalid/a');
    check('5xx is retried, then succeeds', r.status === 200 && calls.length === 3);
    check('backoff grows between retries (exponential)', sleeps.length === 2 && sleeps[1] > sleeps[0], JSON.stringify(sleeps));
  });

  await run('5xx exhausted', async () => {
    const { f, calls } = scripted([500]);
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, maxRetries: 2, ...base });
    let err: unknown = null;
    await c.request('https://x.invalid/a').catch((e) => (err = e));
    check('5xx after all retries -> SourceHttpError http_5xx', err instanceof SourceHttpError && err.kind === 'http_5xx' && calls.length === 3);
    check('error message has no response body', !(err as Error).message.includes('should never leak'));
  });

  await run('4xx', async () => {
    const { f, calls } = scripted([401]);
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, ...base });
    let err: any = null;
    await c.request('https://x.invalid/a?api_key=SECRETVALUE').catch((e) => (err = e));
    check('401 is not retried', calls.length === 1 && err?.kind === 'http_4xx' && err?.status === 401);
    check('error message has no URL or query string', !err.message.includes('SECRETVALUE') && !err.message.includes('x.invalid'));
  });

  await run('429', async () => {
    sleeps.length = 0;
    const { f, calls } = scripted([429, 200], { 'retry-after': '1' });
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, ...base });
    const r = await c.request('https://x.invalid/a');
    check('429 honors Retry-After (1s) then succeeds', r.status === 200 && calls.length === 2 && sleeps[0] === 1000, JSON.stringify(sleeps));
  });

  await run('429 long', async () => {
    const { f, calls } = scripted([429], { 'retry-after': '120' });
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, ...base });
    let err: any = null;
    await c.request('https://x.invalid/a').catch((e) => (err = e));
    check('429 with a Retry-After longer than the cap gives up at once (caller falls back)', err?.kind === 'rate_limited' && calls.length === 1);
  });

  await run('timeout', async () => {
    const { f } = scripted(['hang']);
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, timeoutMs: 30, maxRetries: 1, ...base });
    const t0 = Date.now();
    let err: any = null;
    await c.request('https://x.invalid/a').catch((e) => (err = e));
    check('a hanging source times out (AbortController), retried once, then fails', err?.kind === 'timeout' && Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
  });

  await run('network', async () => {
    const { f, calls } = scripted(['neterr', 200]);
    const c = createHttpClient({ sourceKey: 'src', fetchImpl: f, ...base });
    const r = await c.request('https://x.invalid/a');
    check('a network error is retried', r.status === 200 && calls.length === 2);
  });

  await run('breaker', async () => {
    let now = 1_000_000;
    const { f, calls } = scripted([500]);
    const c = createHttpClient({ sourceKey: 'flaky', fetchImpl: f, maxRetries: 0, breakerThreshold: 3, breakerCooldownMs: 60000, now: () => now, ...base });
    for (let i = 0; i < 3; i++) await c.request('https://x.invalid/a').catch(() => {});
    check('breaker opens after 3 consecutive failures', breakerOpen('flaky', now));
    const before = calls.length;
    let err: any = null;
    await c.request('https://x.invalid/a').catch((e) => (err = e));
    check('open breaker fails fast without calling the source', err?.kind === 'circuit_open' && calls.length === before);
    check('breaker is per source (another source is unaffected)', !breakerOpen('other', now));
    now += 61000;
    check('breaker closes after the cooldown', !breakerOpen('flaky', now));
  });

  check('Retry-After seconds', parseRetryAfter('3', 0) === 3000);
  check('Retry-After HTTP date', parseRetryAfter(new Date(10_000).toUTCString(), 0) === 10_000);
  check('Retry-After garbage -> null', parseRetryAfter('soon', 0) === null);
  const b = [0, 1, 2, 3, 4].map((a) => backoffMs(a, 100, 1000, () => 1));
  check('backoff is capped', b[4] === 1000 && b[3] === 800 && b[0] === 100, JSON.stringify(b));
  check('jitter keeps at least half the step', backoffMs(2, 100, 10000, () => 0) === 200);

  console.log(failures === 0 ? '\nHTTP CLIENT: ALL PASS' : `\nHTTP CLIENT: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
