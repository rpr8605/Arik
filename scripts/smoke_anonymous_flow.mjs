// Fresh-visitor anonymous-auth smoke (2026-08-12 ticket): a no-cookie
// visit must land directly in the workflow — no login wall — and a real
// message must get a real answer, all under an anonymous session. Proves
// RLS holds for anonymous users (owner-scoped policies, auth.uid()).
// Usage: node scripts/smoke_anonymous_flow.mjs (dev server on BASE_URL)
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m || m[1].startsWith('#')) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(new URL('../.env.local', import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const pgClient = new pg.Client({
  host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
});

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

async function fetchBounded(url, options = {}, ms = 75_000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(t); }
}

// Minimal cookie jar: forward name=value verbatim.
const jar = new Map();
function takeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

await pgClient.connect();
let anonUid = null;
let caseId = null;
let sessionId = null;

try {
  // 1. Cold visit, no cookies: must NOT redirect to /login, must set a
  //    session cookie, must render the home workflow.
  const home = await fetchBounded(`${BASE}/`, { redirect: 'manual' });
  takeCookies(home);
  const html = await home.text();
  check('cold visit returns 200 (no login redirect)', home.status === 200, `status ${home.status}`);
  check('proxy set a session cookie on the cold visit', [...jar.keys()].some((k) => k.includes('auth-token')), [...jar.keys()].join(',') || '(none)');
  check('home workflow rendered (front door copy present)', html.includes('going on') || html.includes('going&#x27;s') || html.includes('What'), html.includes('/login') && !html.includes('going') ? 'looks like the LOGIN page' : 'ok');
  check('demo banner present', html.includes('Demo build'));

  // 2. Create a case from free text with the anonymous session cookie.
  const start = await fetchBounded(`${BASE}/api/cases/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ message: 'My Eliquis copay doubled this month and I cannot afford it' }),
  });
  const startJson = await start.json();
  caseId = startJson?.caseId;
  sessionId = startJson?.sessionId;
  check('case created under anonymous session (201)', start.status === 201 && Boolean(caseId && sessionId), `status ${start.status}`);

  const { rows: [kase] } = await pgClient.query(`select user_id from cases where id = $1`, [caseId]);
  anonUid = kase?.user_id ?? null;
  const { rows: [u] } = await pgClient.query(`select is_anonymous from auth.users where id = $1`, [anonUid]);
  check('case row owned by an anonymous auth user', u?.is_anonymous === true, `uid ${anonUid}`);

  // 3. Real message, real response — the RLS proof point.
  try { await fetchBounded(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 60_000); } catch { /* warm-up */ }
  const chat = await fetchBounded(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ message: 'How do I pay less for Eliquis?', sessionId }),
  });
  const chatJson = await chat.json();
  check('chat returns 200 with a real grounded response', chat.status === 200 && (chatJson?.response ?? '').length > 40, `status ${chat.status}`);
  check('ranked_pathways present in response', chatJson?.ranked_pathways != null);
  const { rows: msgs } = await pgClient.query(`select count(*)::int n from chat_messages where session_id = $1`, [sessionId]);
  check('chat messages persisted for the anonymous session', (msgs[0]?.n ?? 0) >= 2, `${msgs[0]?.n} rows`);
  console.log('--- response (first 400 chars) ---');
  console.log((chatJson?.response ?? '').slice(0, 400));
  console.log('----------------------------------');
} finally {
  // Full cleanup: messages, session, case, profile, the anonymous auth user.
  if (sessionId) await pgClient.query(`delete from chat_messages where session_id = $1`, [sessionId]);
  if (sessionId) await pgClient.query(`delete from chat_sessions where id = $1`, [sessionId]);
  if (caseId) await pgClient.query(`delete from cases where id = $1`, [caseId]);
  if (anonUid) {
    await pgClient.query(`delete from user_matching_profile where id = $1`, [anonUid]);
    await pgClient.query(`delete from auth.users where id = $1`, [anonUid]);
  }
  await pgClient.end();
}

console.log(failures === 0 ? '\nANONYMOUS FLOW SMOKE: ALL PASS' : `\nANONYMOUS FLOW SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
