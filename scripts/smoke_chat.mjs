// End-to-end chat smoke: real messages through extraction -> retrieval ->
// response, plus the empty-retrieval short-circuit. Verifies DB audit
// trail (retrieved_exploit_ids) and reads OpenRouter key usage before/
// after for real per-call cost. Usage: node scripts/smoke_chat.mjs
// (dev server must be running on BASE_URL)
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

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

async function openrouterUsageUsd() {
  const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  const json = await res.json();
  return json?.data?.usage ?? null;
}

// Real auth path: sign in with the fixture user's password, same as the
// browser would (chat route now requires a session, no more body userId).
async function signIn(email, password) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: 'chat_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr) throw createErr;
const USER = created.user.id;
const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'prescription_savings') returning id`, [USER],
);
const { rows: [session] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [USER, kase.id],
);

const token = await signIn('chat_smoke@example.invalid', 'smoke-pass-123');

// Bounded fetch (standing rule: no unbounded waits). A stalled /api/chat
// is a test failure with a clean report, never a session hang. 75s: real
// calls take 20-40s (extraction + response model); >90s counts as a hang
// per the operating rule.
async function fetchBounded(url, options = {}, ms = 75_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Warm the route before timing anything: Turbopack compiles /api/chat on
// first hit (2026-08-12 hang). Unauthenticated POST compiles + 401s for free.
try {
  await fetchBounded(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 60_000);
} catch { /* warm-up only */ }

async function chat(message) {
  try {
    const res = await fetchBounded(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, sessionId: session.id }),
    });
    return { status: res.status, json: await res.json() };
  } catch (e) {
    if (e?.name === 'AbortError') {
      console.log('FAIL  /api/chat did not respond within 30s — treating as a real failure, not a hang');
      failures++;
      return { status: 0, json: null };
    }
    throw e;
  }
}

const usageBefore = await openrouterUsageUsd();
console.log(`smoke target: ${BASE} | OpenRouter usage before: $${usageBefore}\n`);

// 1. Grounded query: Eliquis is seeded with exploits + price points.
const grounded = await chat('How do I pay less for Eliquis?');
check('grounded query returns 200 with sources', grounded.status === 200 && (grounded.json?.sources ?? []).length >= 1, `${(grounded.json?.sources ?? []).length} exploit source(s)`);
check('grounded response is non-empty text', typeof grounded.json?.response === 'string' && grounded.json.response.length > 40);
check('boundary line present even in standard mode (code-guaranteed)', /what i can.t guarantee/i.test(grounded.json?.response ?? ''));
check('ranked_pathways present in response JSON', grounded.json?.ranked_pathways != null);
console.log('--- grounded response (first 600 chars) ---');
console.log((grounded.json?.response ?? '').slice(0, 600));
console.log('--- grounded response (last 900 chars - trust receipt lives here) ---');
console.log((grounded.json?.response ?? '').slice(-900));
console.log('-------------------------------------------');

// 2. Zero-match query: Zynteglo is NOT in the database -> short-circuit,
//    deterministic answer, empty sources, no response-model call.
const empty = await chat('What patient assistance programs exist for Zynteglo?');
check('zero-match query returns 200 with empty sources', empty.status === 200 && (empty.json?.sources ?? []).length === 0);
check('zero-match response is the deterministic no-data answer', /don't have anything in my data/.test(empty.json?.response ?? ''));

// 3. Audit trail in chat_messages.
const { rows: msgs } = await pgClient.query(
  `select role, retrieved_exploit_ids from chat_messages where session_id = $1 order by created_at`,
  [session.id],
);
const assistants = msgs.filter((m) => m.role === 'assistant');
check('both turns logged (2 user + 2 assistant)', msgs.length === 4 && assistants.length === 2, `${msgs.length} rows`);
check('grounded assistant message logs retrieved_exploit_ids', (assistants[0]?.retrieved_exploit_ids ?? []).length >= 1, `${(assistants[0]?.retrieved_exploit_ids ?? []).length} id(s)`);
check('short-circuit assistant message logs EMPTY retrieved_exploit_ids', (assistants[1]?.retrieved_exploit_ids ?? []).length === 0);

// 4. Cost accounting.
const usageAfter = await openrouterUsageUsd();
const delta = usageAfter != null && usageBefore != null ? (usageAfter - usageBefore) : null;
console.log(`\nOpenRouter usage after: $${usageAfter} | this smoke cost: $${delta != null ? delta.toFixed(6) : 'unknown'}`);
console.log('(tier/model/token detail per call is in the dev server log, [callModel] lines)');

// Cleanup
await pgClient.query(`delete from chat_messages where session_id = $1`, [session.id]);
await pgClient.query(`delete from chat_sessions where id = $1`, [session.id]);
await pgClient.query(`delete from cases where id = $1`, [kase.id]);
await admin.auth.admin.deleteUser(USER);
await pgClient.end();

console.log(failures === 0 ? '\nCHAT SMOKE: ALL PASS' : `\nCHAT SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
