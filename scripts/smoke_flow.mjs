// End-to-end onboarding flow smoke: the crisis-aware front door over real
// HTTP + real auth. Covers: unauthenticated redirect to login, sign-in,
// "what's going on?" -> case + session created, first message answered in
// the case thread, and 401s on unauthenticated API calls.
// Usage: node scripts/smoke_flow.mjs   (dev server must be running)
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
const EMAIL = 'flow_smoke@example.invalid';
const PASSWORD = 'smoke-pass-123';

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

await pgClient.connect();
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { smoke: true },
});
if (createErr) throw createErr;
const USER = created.user.id;

// 1. Unauthenticated: / redirects to /login, /login renders, APIs 401.
const homeAnon = await fetch(`${BASE}/`, { redirect: 'manual' });
check('GET / unauthenticated redirects to /login',
  [301, 302, 303, 307, 308].includes(homeAnon.status) && (homeAnon.headers.get('location') ?? '').includes('/login'),
  `status ${homeAnon.status} -> ${homeAnon.headers.get('location')}`);
const loginPage = await fetch(`${BASE}/login`);
check('GET /login renders', loginPage.status === 200 && (await loginPage.text()).includes('Sign in'));
const startAnon = await fetch(`${BASE}/api/cases/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'test' }) });
check('POST /api/cases/start unauthenticated returns 401', startAnon.status === 401, `status ${startAnon.status}`);
const chatAnon = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'test', sessionId: 'x' }) });
check('POST /api/chat unauthenticated returns 401', chatAnon.status === 401, `status ${chatAnon.status}`);

// 2. Sign in through the real auth path (same REST grant the browser uses).
const signin = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const { access_token: token } = await signin.json();
check('password sign-in returns access token', typeof token === 'string' && token.length > 100);
const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

// 3. "What's going on?" -> a case + thread exists.
const FIRST = 'My Eliquis copay doubled this month and I cannot afford it';
const started = await fetch(`${BASE}/api/cases/start`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ message: FIRST }) });
const startedJson = await started.json();
check('POST /api/cases/start creates case + session', started.status === 201 && startedJson.caseId && startedJson.sessionId, `status ${started.status}`);

const { rows: [kase] } = await pgClient.query(`select * from cases where id = $1`, [startedJson.caseId]);
check('case is typed prescription_savings and linked to the user',
  kase?.case_type === 'prescription_savings' && kase?.user_id === USER, kase?.case_type);
const { rows: [sessionRow] } = await pgClient.query(`select * from chat_sessions where id = $1`, [startedJson.sessionId]);
check('chat session is scoped to the case', sessionRow?.case_id === startedJson.caseId);

// 4. The first message lands in the thread and gets a grounded answer.
const answer = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ message: FIRST, sessionId: startedJson.sessionId }) });
const answerJson = await answer.json();
check('first message returns grounded answer with sources', answer.status === 200 && (answerJson.sources ?? []).length >= 1, `${(answerJson.sources ?? []).length} source(s)`);
const { rows: msgs } = await pgClient.query(`select role from chat_messages where session_id = $1 order by created_at`, [startedJson.sessionId]);
check('thread now holds the user + assistant turns', msgs.length === 2 && msgs[0].role === 'user' && msgs[1].role === 'assistant');

// Cleanup
await pgClient.query(`delete from chat_messages where session_id = $1`, [startedJson.sessionId]);
await pgClient.query(`delete from chat_sessions where id = $1`, [startedJson.sessionId]);
await pgClient.query(`delete from cases where id = $1`, [startedJson.caseId]);
await admin.auth.admin.deleteUser(USER);
await pgClient.end();

console.log(failures === 0 ? '\nFLOW SMOKE: ALL PASS' : `\nFLOW SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
