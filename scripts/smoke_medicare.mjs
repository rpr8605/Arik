// End-to-end smoke for the AKS Medicare hard-block (pre-demo item 1).
// The one test case that can't be wrong: a Medicare Part D patient asking
// about Eliquis must NOT see the manufacturer copay card as viable, MUST
// see the legal explanation, and the PAP pathway must be what surfaces.
// Pattern follows smoke_chat.mjs. Usage: node scripts/smoke_medicare.mjs
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
  host: env.SUPABASE_DB_HOST, port: 5432, user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

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
  email: 'medicare_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr) throw createErr;
const USER = created.user.id;

// Medicare Part D profile + the drug on their list.
await pgClient.query(
  `insert into user_matching_profile (id, insurance_type) values ($1, 'medicare_part_d')`, [USER],
);
await pgClient.query(
  `insert into user_medications (user_id, drug_id, dose)
   select $1, id, '5 mg' from drugs where name = 'Eliquis'`, [USER],
);
const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'prescription_savings') returning id`, [USER],
);
const { rows: [session] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [USER, kase.id],
);

// The two exploit ids this test hinges on.
const { rows: exploitRows } = await pgClient.query(
  `select e.id, e.exploit_type from exploits e join drugs d on d.id = e.drug_id where d.name = 'Eliquis'`,
);
const cardId = exploitRows.find((r) => r.exploit_type === 'copay_card')?.id;
const papId = exploitRows.find((r) => r.exploit_type === 'pap')?.id;

const token = await signIn('medicare_smoke@example.invalid', 'smoke-pass-123');

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
// first hit, and that compile + two model calls blew past a naive timeout
// (2026-08-12 hang). An unauthenticated POST compiles the route and 401s
// without spending a model call.
try {
  await fetchBounded(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 60_000);
} catch { /* warm-up only */ }

let res = null;
let json = null;
try {
  res = await fetchBounded(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: 'How do I pay less for Eliquis?', sessionId: session.id }),
  });
  json = await res.json();
} catch (e) {
  if (e?.name === 'AbortError') {
    console.log('FAIL  /api/chat did not respond within 30s — treating as a real failure, not a hang');
    failures++;
    res = { status: 0 };
    json = {};
  } else {
    throw e;
  }
}
const response = json?.response ?? '';

check('query returns 200', res.status === 200, `status ${res.status}`);
check('legal explanation is visible (deterministic block note)', /Why you're not seeing a manufacturer copay card here/.test(response));
check('the law is named (Anti-Kickback Statute)', /Anti-Kickback Statute/.test(response));
check('blocked card is named as blocked, not offered', /Blocked for your coverage: Eliquis Co-pay Card/.test(response));

const { rows: msgs } = await pgClient.query(
  `select role, retrieved_exploit_ids from chat_messages where session_id = $1 and role = 'assistant' order by created_at desc limit 1`,
  [session.id],
);
const loggedIds = msgs[0]?.retrieved_exploit_ids ?? [];
check('copay card id NOT in retrieved_exploit_ids (never a recommendation)', cardId ? !loggedIds.includes(cardId) : false, `card ${cardId}`);
check('PAP id IS in retrieved_exploit_ids (the legal pathway surfaces)', papId ? loggedIds.includes(papId) : false, `pap ${papId}`);

console.log('--- response (first 500 chars) ---');
console.log(response.slice(0, 500));
console.log('--- response (last 500 chars - block note lives here) ---');
console.log(response.slice(-500));
console.log('----------------------------------');
// Model-text observation (not a hard assert — models vary): does the PAP
// get named in prose?
console.log(`model names the PAP in prose: ${/Patient Assistance/.test(response) ? 'yes' : 'no (check printout)'}`);

// Cleanup
await pgClient.query(`delete from chat_messages where session_id = $1`, [session.id]);
await pgClient.query(`delete from chat_sessions where id = $1`, [session.id]);
await pgClient.query(`delete from cases where id = $1`, [kase.id]);
await pgClient.query(`delete from user_medications where user_id = $1`, [USER]);
await pgClient.query(`delete from user_matching_profile where id = $1`, [USER]);
await admin.auth.admin.deleteUser(USER);
await pgClient.end();

console.log(failures === 0 ? '\nMEDICARE SMOKE: ALL PASS' : `\nMEDICARE SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
