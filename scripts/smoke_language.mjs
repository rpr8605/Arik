// Feature B smoke: language preference end-to-end. Covers: default en,
// launch-scope rejection of unsupported codes, preference persistence +
// consent-ledger audit rows, deterministic Spanish short-circuit from the
// chat route, and extraction accuracy on Spanish input (UNIVERSAL_ACCESS.md
// requires the extraction tier to be tested on non-English input, not
// assumed to work). Usage: node scripts/smoke_language.mjs (dev server
// must be running on BASE_URL).
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
  email: 'lang_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr) throw createErr;
const USER = created.user.id;
const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'prescription_savings') returning id`, [USER],
);
const { rows: [session] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [USER, kase.id],
);
const token = await signIn('lang_smoke@example.invalid', 'smoke-pass-123');

async function prefs(method, body, tk = token) {
  const res = await fetch(`${BASE}/api/preferences`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tk}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}
async function chat(message) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, sessionId: session.id }),
  });
  return { status: res.status, json: await res.json() };
}

console.log(`smoke target: ${BASE}\n`);

// 1. Default is English, even with no profile row.
const dflt = await prefs('GET');
check('default preference is en', dflt.status === 200 && dflt.json?.preferred_language === 'en', JSON.stringify(dflt.json));

// 2. Unauthenticated is 401.
const noAuth = await prefs('GET', undefined, '');
check('unauthenticated GET returns 401', noAuth.status === 401, `got ${noAuth.status}`);

// 3. Unsupported codes are rejected with an explicit launch-scope reason.
const fr = await prefs('PUT', { preferred_language: 'fr' });
check('fr rejected with 400', fr.status === 400, `got ${fr.status}`);
check('rejection names it a launch-scope decision', /launch-scope/.test(fr.json?.error ?? ''), fr.json?.error);

// 4. Set Spanish: persisted + ledger row written.
const setEs = await prefs('PUT', { preferred_language: 'es' });
check('PUT es returns 200', setEs.status === 200 && setEs.json?.preferred_language === 'es');
const getEs = await prefs('GET');
check('GET reflects es', getEs.json?.preferred_language === 'es');
const { rows: ledger1 } = await pgClient.query(
  `select category, action, detail from consent_ledger where user_id = $1 order by created_at`, [USER],
);
check('consent ledger records the language choice',
  ledger1.length === 1 && ledger1[0].category === 'language' && ledger1[0].detail?.language === 'es',
  JSON.stringify(ledger1));

// 5. Chat responds in Spanish - deterministic short-circuit, no model variance.
const esChat = await chat('¿Cuánto cuesta Zynteglo?');
check('es chat returns 200', esChat.status === 200);
check('es no-data response is the Spanish deterministic string',
  /No tengo nada en mis datos/.test(esChat.json?.response ?? ''),
  (esChat.json?.response ?? '').slice(0, 120));

// 6. Extraction works on Spanish input (UNIVERSAL_ACCESS.md: test this,
//    don't assume it). "Trabajo en Apple" must land on the profile.
const esExtract = await chat('Trabajo en Apple y vivo en Denver, CO. ¿Qué pasa con Zynteglo?');
check('es extraction turn returns 200', esExtract.status === 200);
const { rows: [prof] } = await pgClient.query(
  `select employer_name, state from user_matching_profile where id = $1`, [USER],
);
check('employer extracted from Spanish message', (prof?.employer_name ?? '').toLowerCase().includes('apple'), prof?.employer_name);
check('state extracted from Spanish message', prof?.state === 'CO', prof?.state);

// 7. Switch back to English: chat is English again, ledger keeps BOTH rows.
await prefs('PUT', { preferred_language: 'en' });
const enChat = await chat('What does Zynteglo cost?');
check('en no-data response is the English deterministic string',
  /don't have anything in my data/.test(enChat.json?.response ?? ''),
  (enChat.json?.response ?? '').slice(0, 120));
const { rows: ledger2 } = await pgClient.query(
  `select category, action, detail from consent_ledger where user_id = $1 order by created_at`, [USER],
);
check('ledger is append-only (both choices kept)',
  ledger2.length === 2 && ledger2[0].detail?.language === 'es' && ledger2[1].detail?.language === 'en',
  JSON.stringify(ledger2.map((r) => r.detail)));

// Cleanup (children before parents)
await pgClient.query(`delete from chat_messages where session_id in (select id from chat_sessions where user_id = $1)`, [USER]);
await pgClient.query(`delete from chat_sessions where user_id = $1`, [USER]);
await pgClient.query(`delete from pending_fact_corrections where user_id = $1`, [USER]);
await pgClient.query(`delete from pending_case_facts where user_id = $1`, [USER]);
await pgClient.query(`delete from consent_ledger where user_id = $1`, [USER]);
await pgClient.query(`delete from user_medications where user_id = $1`, [USER]);
await pgClient.query(`delete from cases where user_id = $1`, [USER]);
await pgClient.query(`delete from user_matching_profile where id = $1`, [USER]);
await admin.auth.admin.deleteUser(USER);
await pgClient.end();

console.log(failures === 0 ? '\nLANGUAGE SMOKE: ALL PASS' : `\nLANGUAGE SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
