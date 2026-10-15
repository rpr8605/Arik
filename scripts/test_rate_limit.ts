// Pure tests for lib/rateLimit.ts (limit table, IP handling, responses).
// The counting itself is SQL - see scripts/smoke_rate_limit.mjs.
// Run: npx tsx scripts/test_rate_limit.ts
import {
  DEFAULT_ANON_DAILY_MODEL_CAP,
  anonDailyModelCap,
  clientIp,
  hashIp,
  limitKind,
  planChecks,
  rateLimitResponse,
} from '../lib/rateLimit';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env = { SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };
const byBucket = (checks: ReturnType<typeof planChecks>, b: string) => checks.find((c) => c.bucket === b);

async function main() {
  // --- Limit table ---
  const chat = planChecks('chat', U, 'iphash', env);
  check('chat: per-user 10/min for both kinds', byBucket(chat, 'chat:user:burst')?.window_seconds === 60 && byBucket(chat, 'chat:user:burst')?.limit_anon === 10 && byBucket(chat, 'chat:user:burst')?.limit_authed === 10);
  check('chat: per-user day 25 anonymous / 150 signed in', byBucket(chat, 'chat:user:day')?.limit_anon === 25 && byBucket(chat, 'chat:user:day')?.limit_authed === 150 && byBucket(chat, 'chat:user:day')?.window_seconds === 86400);
  check('chat: per-IP 60/hour keyed by the hash', byBucket(chat, 'chat:ip:hour')?.limit_anon === 60 && byBucket(chat, 'chat:ip:hour')?.subject === 'iphash');
  const cap = byBucket(chat, 'model:anon:day');
  check('chat: combined anonymous cap 200/day, anonymous only', cap?.limit_anon === 200 && cap?.limit_authed === null && cap?.subject === 'all' && cap?.window_seconds === 86400);
  check('chat: per-user buckets keyed by the session user', byBucket(chat, 'chat:user:burst')?.subject === U && byBucket(chat, 'chat:user:day')?.subject === U);

  const docs = planChecks('documents', U, 'iphash', env);
  check('documents: 5 per 10 min, day 5 anonymous / 30 signed in, IP 20/hour', byBucket(docs, 'documents:user:burst')?.window_seconds === 600 && byBucket(docs, 'documents:user:burst')?.limit_anon === 5 && byBucket(docs, 'documents:user:day')?.limit_anon === 5 && byBucket(docs, 'documents:user:day')?.limit_authed === 30 && byBucket(docs, 'documents:ip:hour')?.limit_anon === 20);
  check('documents: shares the combined anonymous model cap with chat', byBucket(docs, 'model:anon:day')?.limit_anon === 200);

  const start = planChecks('cases_start', U, 'iphash', env);
  const samples = planChecks('samples', U, 'iphash', env);
  check('samples: 30/hour, day 60 anonymous / 200 signed in, no model cap', byBucket(samples, 'samples:user:burst')?.limit_anon === 30 && byBucket(samples, 'samples:user:day')?.limit_anon === 60 && byBucket(samples, 'samples:user:day')?.limit_authed === 200 && !samples.some((c) => c.bucket === 'model:anon:day'));
  check('cases/start: 10/hour, day 20 anonymous / 100 signed in', byBucket(start, 'cases_start:user:burst')?.window_seconds === 3600 && byBucket(start, 'cases_start:user:burst')?.limit_anon === 10 && byBucket(start, 'cases_start:user:day')?.limit_anon === 20 && byBucket(start, 'cases_start:user:day')?.limit_authed === 100);
  check('cases/start: no model cap and no IP check (no model call)', !byBucket(start, 'model:anon:day') && !start.some((c) => c.bucket.includes(':ip:')));

  check('no IP header -> no IP check, other checks unchanged', !planChecks('chat', U, null, env).some((c) => c.bucket.includes(':ip:')) && planChecks('chat', U, null, env).length === 3);

  // --- Combined cap override ---
  check('cap default is 200', DEFAULT_ANON_DAILY_MODEL_CAP === 200 && anonDailyModelCap({}) === 200);
  check('cap override from env', anonDailyModelCap({ RATE_LIMIT_ANON_DAILY_MODEL_CAP: '50' }) === 50 && byBucket(planChecks('chat', U, null, { RATE_LIMIT_ANON_DAILY_MODEL_CAP: '50' }), 'model:anon:day')?.limit_anon === 50);
  for (const bad of ['0', '-5', 'abc', '', '1.5', 'unlimited']) {
    check(`cap override "${bad}" is ignored (falls back to 200, never unlimited)`, anonDailyModelCap({ RATE_LIMIT_ANON_DAILY_MODEL_CAP: bad }) === 200);
  }

  // --- IP handling ---
  check('clientIp: first hop of x-forwarded-for', clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })) === '203.0.113.7');
  check('clientIp: Vercel header wins', clientIp(new Headers({ 'x-vercel-forwarded-for': '198.51.100.2', 'x-forwarded-for': '203.0.113.7' })) === '198.51.100.2');
  check('clientIp: x-real-ip fallback', clientIp(new Headers({ 'x-real-ip': '192.0.2.9' })) === '192.0.2.9');
  check('clientIp: none -> null', clientIp(new Headers()) === null);
  const h1 = hashIp('203.0.113.7', env);
  check('hashIp: deterministic, fixed length, never contains the IP', h1 === hashIp('203.0.113.7', env) && h1.length === 32 && !h1.includes('203'));
  check('hashIp: different IPs differ', h1 !== hashIp('203.0.113.8', env));
  check('hashIp: RATE_LIMIT_IP_SALT changes the hash', h1 !== hashIp('203.0.113.7', { ...env, RATE_LIMIT_IP_SALT: 'other' }));

  // --- Kinds and responses ---
  check('limitKind mapping', limitKind('chat:user:burst') === 'burst' && limitKind('chat:user:day') === 'daily' && limitKind('chat:ip:hour') === 'ip' && limitKind('model:anon:day') === 'demo_cap');
  const req = (lang?: string) => new Request('http://localhost/api/chat', { headers: lang ? { 'accept-language': lang } : {} });
  {
    const res = rateLimitResponse({ allowed: false, unavailable: false, bucket: 'chat:user:burst', retryAfterSeconds: 17 }, req());
    const body: any = await res.json();
    check('429 with Retry-After and a plain-language message in error', res.status === 429 && res.headers.get('retry-after') === '17' && body.code === 'rate_limited' && body.limit === 'burst' && /wait a moment/.test(body.error));
  }
  {
    const res = rateLimitResponse({ allowed: false, unavailable: false, bucket: 'model:anon:day', retryAfterSeconds: 3600 }, req('es-MX,es;q=0.9'));
    const body: any = await res.json();
    check('Spanish message when Accept-Language is es', res.status === 429 && body.limit === 'demo_cap' && /demostración pública/.test(body.error));
  }
  {
    const res = rateLimitResponse({ allowed: false, unavailable: true }, req());
    const body: any = await res.json();
    check('unavailable -> 503 with Retry-After, no limit details', res.status === 503 && res.headers.get('retry-after') === '60' && body.code === 'rate_limiter_unavailable' && body.limit === undefined);
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nRATE LIMIT: ALL PASS' : `\nRATE LIMIT: ${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
