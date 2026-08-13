// Live chat-level smoke for the Zepbound conflict scenario (owner-required,
// same rigor as smoke_medicare.mjs). A commercial patient whose plan
// doesn't cover Zepbound must NEVER get a confidently-stated annual max:
// the conflicted card appears only as pending-verification. Hard asserts
// run on the deterministic ranked_pathways field; the prose is printed
// for eyeball plus one soft keyword check.
// Usage: node scripts/smoke_zepbound_conflict.mjs (dev server on BASE_URL)
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

async function fetchBounded(url, options = {}, ms = 75_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timeoutId); }
}

async function signIn(email, password) {
  const res = await fetchBounded(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
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
  email: 'zepbound_smoke@example.invalid', password: 'smoke-pass-123', email_confirm: true,
});
if (createErr) throw createErr;
const USER = created.user.id;

// Commercial insurance, Iowa (verified-protected demo state).
await pgClient.query(`insert into user_matching_profile (id, insurance_type, state) values ($1, 'employer', 'IA')`, [USER]);
const { rows: [kase] } = await pgClient.query(
  `insert into cases (user_id, case_type) values ($1, 'prescription_savings') returning id`, [USER],
);
const { rows: [session] } = await pgClient.query(
  `insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [USER, kase.id],
);

try {
  const token = await signIn('zepbound_smoke@example.invalid', 'smoke-pass-123');

  // Warm the route (Turbopack compile) without spending a model call.
  try { await fetchBounded(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 60_000); } catch { /* warm-up */ }

  const res = await fetchBounded(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "My insurance doesn't cover Zepbound at all. How do I pay less for it?", sessionId: session.id }),
  });
  const json = await res.json();
  const rp = json?.ranked_pathways;
  const response = json?.response ?? '';

  check('query returns 200 with ranked_pathways present', res.status === 200 && rp != null, `status ${res.status}`);
  const rankedTitles = (rp?.ranked ?? []).map((p) => p.title);
  const pendingTitles = (rp?.pendingVerification ?? []).map((p) => p.title);
  check('no Zepbound Savings Card appears as a RANKED pathway', !rankedTitles.some((t) => t.includes('Zepbound Savings Card')), rankedTitles.join(' | ') || '(none ranked)');
  const pendingRow = (rp?.pendingVerification ?? []).find((p) => p.title.includes('drug not covered'));
  check('non-covered card appears ONLY as pending-verification', Boolean(pendingRow));
  check('pending reason says figures conflict / not trusted', pendingRow ? /conflict|pending|not trusted/i.test(pendingRow.reason) : false, pendingRow?.reason);
  check('no ranked pathway asserts an annual max of $3,283 or $6,097',
    !(rp?.ranked ?? []).some((p) => [3283, 6097].includes(Number(p.annualMaxSavingsUsd ?? NaN))));

  console.log('--- response (first 700 chars) ---');
  console.log(response.slice(0, 700));
  console.log('----------------------------------');
  console.log(`prose mentions verification/conflict: ${/verif|conflict|disput|confirm/i.test(response) ? 'yes' : 'NO — inspect printout'}`);
  console.log(`prose asserts "$3,283" or "$6,097" as a fact: ${/\$3,?283|\$6,?097/.test(response) ? 'PRESENT — inspect printout (acceptable only if framed as disputed)' : 'absent'}`);
} finally {
  await pgClient.query(`delete from chat_messages where session_id = $1`, [session.id]);
  await pgClient.query(`delete from chat_sessions where id = $1`, [session.id]);
  await pgClient.query(`delete from cases where id = $1`, [kase.id]);
  await pgClient.query(`delete from user_matching_profile where id = $1`, [USER]);
  await admin.auth.admin.deleteUser(USER);
  await pgClient.end();
}

console.log(failures === 0 ? '\nZEPBOUND CONFLICT CHAT SMOKE: ALL PASS' : `\nZEPBOUND CONFLICT CHAT SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
