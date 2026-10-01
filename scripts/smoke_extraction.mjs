// Feature A smoke: conversational entity extraction end-to-end through the
// live API. Covers: durable merge of facts mentioned in passing, location
// resolution (raw + derived zip/state), case-scoped institution, the
// don't-silently-overwrite correction flow (create/confirm/dismiss +
// cross-user isolation), and pre-case staging -> migration on case create.
// Usage: node scripts/smoke_extraction.mjs (dev server must be running on
// BASE_URL). Zynteglo is deliberately NOT seeded, so every turn takes the
// deterministic no-data short-circuit - extraction and merge still run,
// and no response-model call is spent.
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
  email: 'extract_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr) throw createErr;
const USER = created.user.id;
const { data: created2, error: createErr2 } = await admin.auth.admin.createUser({
  email: 'extract_smoke2@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr2) throw createErr2;
const USER2 = created2.user.id;

const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'bill_dispute') returning id`, [USER],
);
const { rows: [session] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [USER, kase.id],
);

const token = await signIn('extract_smoke@example.invalid', 'smoke-pass-123');
const token2 = await signIn('extract_smoke2@example.invalid', 'smoke-pass-123');

async function chat(message, sid = session.id, tk = token) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ message, sessionId: sid }),
  });
  return { status: res.status, json: await res.json() };
}
async function resolveCorrection(id, action, tk = token) {
  const res = await fetch(`${BASE}/api/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ id, action }),
  });
  return { status: res.status, json: await res.json() };
}
const profile = async () =>
  (await pgClient.query(`select * from user_matching_profile where id = $1`, [USER])).rows[0] ?? null;
const caseRow = async (id = kase.id) =>
  (await pgClient.query(`select * from cases where id = $1`, [id])).rows[0];

console.log(`smoke target: ${BASE}\n`);

// 1. Facts mentioned in passing merge into the durable record immediately.
const t1 = await chat(
  "I work at Apple and live in Austin, TX. I got a bill from St. David's Medical Center - what does Zynteglo cost?",
);
check('turn 1 returns 200', t1.status === 200);
check('turn 1 no corrections (nothing on file yet)', (t1.json?.corrections ?? []).length === 0);
let p = await profile();
check('employer merged to profile', (p?.employer_name ?? '').toLowerCase().includes('apple'), p?.employer_name);
check('location raw stored verbatim', (p?.state_or_location_raw ?? '').toLowerCase().includes('austin'), p?.state_or_location_raw);
check('state resolved from raw location', p?.state === 'TX', p?.state);
check('institution merged onto the case', ((await caseRow())?.institution_name ?? '').toLowerCase().includes('david'), (await caseRow())?.institution_name);

// 2. Zip resolution.
const t2 = await chat('I moved - I am in 78701 now. Still checking on Zynteglo.');
check('turn 2 returns 200', t2.status === 200);
p = await profile();
check('zip resolved from raw location', p?.zip_code === '78701', p?.zip_code);
check('state NOT clobbered by zip-only mention', p?.state === 'TX', p?.state);

// 3. Contradiction -> pending correction, old value untouched.
const t3 = await chat('Actually I work at Google now. Zynteglo?');
check('turn 3 returns 200', t3.status === 200);
const empCorr = (t3.json?.corrections ?? []).find((c) => c.field === 'employer_name');
check('turn 3 surfaces an employer correction', !!empCorr, JSON.stringify(t3.json?.corrections));
check('correction carries old and new values', !!empCorr && empCorr.old_value.toLowerCase().includes('apple') && empCorr.new_value.toLowerCase().includes('google'));
p = await profile();
check('old employer NOT silently overwritten', (p?.employer_name ?? '').toLowerCase().includes('apple'), p?.employer_name);

// 4. Cross-user isolation: USER2 cannot confirm USER1's correction.
if (empCorr) {
  const denied = await resolveCorrection(empCorr.id, 'confirm', token2);
  check('other user cannot confirm the correction (404)', denied.status === 404, `got ${denied.status}`);
}

// 5. Confirm applies the new value.
if (empCorr) {
  const ok = await resolveCorrection(empCorr.id, 'confirm');
  check('confirm returns 200 confirmed', ok.status === 200 && ok.json?.status === 'confirmed', JSON.stringify(ok.json));
  p = await profile();
  check('employer updated after confirm', (p?.employer_name ?? '').toLowerCase().includes('google'), p?.employer_name);
  const again = await resolveCorrection(empCorr.id, 'confirm');
  check('re-confirm is a 409, not a double-apply', again.status === 409, `got ${again.status}`);
}

// 6. Dismiss keeps the existing value.
const t6 = await chat('I work at Microsoft. Zynteglo?');
const msCorr = (t6.json?.corrections ?? []).find((c) => c.field === 'employer_name');
check('second contradiction surfaces a new correction', !!msCorr);
if (msCorr) {
  const dis = await resolveCorrection(msCorr.id, 'dismiss');
  check('dismiss returns 200', dis.status === 200 && dis.json?.status === 'dismissed');
  p = await profile();
  check('dismiss keeps the confirmed value', (p?.employer_name ?? '').toLowerCase().includes('google'), p?.employer_name);
}

// 7. Pre-case chat: institution is staged, not dropped.
const { rows: [preSession] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, null) returning id`, [USER],
);
const t7 = await chat('The bill is from Seton Medical Center. What does Zynteglo cost?', preSession.id);
check('pre-case turn returns 200', t7.status === 200);
const { rows: staged } = await pgClient.query(
  `select fact_value from pending_case_facts where user_id = $1 and fact_type = 'institution_name'`, [USER],
);
check('institution staged for later migration', staged.some((r) => r.fact_value.toLowerCase().includes('seton')), JSON.stringify(staged));

// 8. Case creation migrates staged facts.
const start = await fetch(`${BASE}/api/cases/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ message: 'I need to dispute a hospital bill' }),
});
const startJson = await start.json();
check('case start returns 201', start.status === 201, JSON.stringify(startJson));
const newCase = await caseRow(startJson.caseId);
check('staged institution migrated into the new case', (newCase?.institution_name ?? '').toLowerCase().includes('seton'), newCase?.institution_name);
const { rows: stagedAfter } = await pgClient.query(
  `select id from pending_case_facts where user_id = $1 and fact_type = 'institution_name'`, [USER],
);
check('staged institution rows deleted after migration', stagedAfter.length === 0, `${stagedAfter.length} left`);

// 9. Unknown session is a clean 404 (was a downstream FK 500).
const bad = await chat('hello', '00000000-0000-0000-0000-000000000000');
check('unknown session returns 404', bad.status === 404, `got ${bad.status}`);

// Cleanup (children before parents; sessions/messages by user because the
// /api/cases/start step creates its own session server-side)
await pgClient.query(`delete from chat_messages where session_id in (select id from chat_sessions where user_id = $1)`, [USER]);
await pgClient.query(`delete from chat_sessions where user_id = $1`, [USER]);
await pgClient.query(`delete from pending_fact_corrections where user_id = $1`, [USER]);
await pgClient.query(`delete from pending_case_facts where user_id = $1`, [USER]);
await pgClient.query(`delete from user_medications where user_id = $1`, [USER]);
await pgClient.query(`delete from cases where user_id = $1`, [USER]);
await pgClient.query(`delete from user_matching_profile where id = $1`, [USER]);
await admin.auth.admin.deleteUser(USER);
await admin.auth.admin.deleteUser(USER2);
await pgClient.end();

console.log(failures === 0 ? '\nEXTRACTION SMOKE: ALL PASS' : `\nEXTRACTION SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
