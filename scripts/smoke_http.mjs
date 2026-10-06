// End-to-end HTTP smoke against the dev server + live DB.
// Creates a fixture user, exercises the case workflow (incl. illegal
// transitions -> 409), the deadline engine (rule match + honest no_rule),
// and the identity vault (masked reads only), then privacy-deletes
// everything it created. Usage: node scripts/smoke_http.mjs
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
const USER = '33333333-3333-3333-3333-333333333333';

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
async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

// Real auth path (Step 0, 2026-10-01): every guarded route resolves the
// caller from the session; request-supplied userId fields are ignored.
// Sign in with the fixture user's password, same as the browser would.
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
await pgClient.query(
  // Token columns must be '' not NULL - GoTrue scans them as strings and
  // a NULL makes /token answer 500 "Database error querying schema".
  `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                           email_confirmed_at, created_at, updated_at,
                           confirmation_token, recovery_token, email_change_token_new,
                           email_change_token_current, email_change, phone_change,
                           phone_change_token, reauthentication_token,
                           raw_app_meta_data, raw_user_meta_data)
   values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'http_smoke@example.invalid', crypt('smoke', gen_salt('bf')), now(), now(), now(),
           '', '', '', '', '', '', '', '', '{}', '{}')
   on conflict (id) do nothing`,
  [USER],
);
console.log(`smoke target: ${BASE}\n`);
const token = await signIn('http_smoke@example.invalid', 'smoke');

// 0. Auth boundary: no session -> 401 (the Step 0 guard).
const noAuth = await api('POST', '/api/cases', { caseType: 'prescription_savings' });
check('POST /api/cases without a session returns 401', noAuth.status === 401, `status ${noAuth.status}`);

// 1. Create a case (userId comes from the session, not the body)
const created = await api('POST', '/api/cases', { userId: '00000000-0000-0000-0000-000000000000', caseType: 'prescription_savings' }, token);
check('POST /api/cases ignores body userId and still creates for the session user',
  created.status === 201 && created.json?.case?.user_id === USER, `status ${created.status}, user_id ${created.json?.case?.user_id}`);
check('POST /api/cases creates case', created.status === 201 && created.json?.case?.status === 'gathering_evidence', `status ${created.status}`);
const caseId = created.json?.case?.id;

// 2. Illegal transition -> 409
const illegal = await api('PATCH', `/api/cases/${caseId}`, { to: 'resolved_won' }, token);
check('PATCH gathering_evidence -> resolved_won returns 409', illegal.status === 409, `status ${illegal.status}`);

// 3. Legal transition -> 200
const legal = await api('PATCH', `/api/cases/${caseId}`, { to: 'action_ready' }, token);
check('PATCH gathering_evidence -> action_ready returns 200', legal.status === 200 && legal.json?.case?.status === 'action_ready', `status ${legal.status}`);

// 4. Deadline with a known payer rule -> stored with countdown
const dl = await api('POST', `/api/cases/${caseId}/deadlines`, { noticeDate: '2026-07-01', payerName: 'UHC', planType: 'employer' }, token);
check('POST deadlines (UHC) stores deadline with days_remaining', dl.status === 201 && dl.json?.stored === true && typeof dl.json?.daysRemaining === 'number',
  dl.json?.stored ? `filing ${dl.json?.deadline?.filing_deadline}, ${dl.json?.daysRemaining}d remaining, basis: ${(dl.json?.basis ?? '').slice(0, 60)}...` : JSON.stringify(dl.json));
check('UHC deadline is flagged sourceUnverified (honest basis)', dl.json?.sourceUnverified === true);

// 5. Unknown payer -> honest no_rule, NOT a guessed deadline
const noRule = await api('POST', `/api/cases/${caseId}/deadlines`, { noticeDate: '2026-07-01', payerName: 'Acme Unknown Mutual', planType: 'medicaid' }, token);
check('POST deadlines (unknown payer) returns no_rule, nothing stored', noRule.status === 200 && noRule.json?.stored === false && noRule.json?.reason === 'no_rule');

// 6. Only the one real deadline is listed
const list = await api('GET', `/api/cases/${caseId}/deadlines`, null, token);
check('GET deadlines lists exactly the 1 stored deadline', list.status === 200 && (list.json?.deadlines ?? []).length === 1, `${(list.json?.deadlines ?? []).length} row(s)`);

// 7. Identity write -> masked read (booleans, never values)
const put = await api('PUT', '/api/identity', { userId: '00000000-0000-0000-0000-000000000000', fields: { full_name: 'Http Smoke', date_of_birth: '1970-01-01' } }, token);
check('PUT /api/identity saves + returns masked fields', put.status === 200 && put.json?.identity?.full_name === true && put.json?.identity?.email === false);
const getId = await api('GET', '/api/identity', null, token);
check('GET /api/identity never returns plaintext values', getId.status === 200 && !JSON.stringify(getId.json).includes('Http Smoke') && !JSON.stringify(getId.json).includes('1970-01-01'));

// 8. Terminal state: close, then confirm reopening is illegal
await api('PATCH', `/api/cases/${caseId}`, { to: 'submitted' }, token);
const closed = await api('PATCH', `/api/cases/${caseId}`, { to: 'closed_by_patient' }, token);
check('terminal PATCH flags outcome_confirmation_required', closed.json?.outcome_confirmation_required === true, JSON.stringify(closed.json?.outcome_confirmation_required));
const reopen = await api('PATCH', `/api/cases/${caseId}`, { to: 'gathering_evidence' }, token);
check('PATCH closed_by_patient -> gathering_evidence returns 409 (terminal)', reopen.status === 409, `status ${reopen.status}`);

// 8b. Outcome confirmation loop: record pharmacy + amount, patient confirms
const oc = await api('POST', '/api/outcomes', { caseId, fields: { revisedAmountOwedUsd: 0, pharmacyUsed: 'Costco' } }, token);
check('POST /api/outcomes records amount + pharmacy_used', oc.status === 201 && oc.json?.outcome?.pharmacy_used === 'Costco' && oc.json?.outcome?.revised_amount_owed_usd !== null, `status ${oc.status}`);
const outcomeId = oc.json?.outcome?.id;
check('new outcome starts unconfirmed (patient gate)', oc.json?.outcome?.patient_confirmed === false);
const conf = await api('POST', '/api/outcomes', { outcomeId, patientConfirmed: true }, token);
check('patient confirmation flips patient_confirmed', conf.status === 200 && conf.json?.outcome?.patient_confirmed === true, `status ${conf.status}`);
check('confirmed outcome carries a timestamp', Boolean(conf.json?.outcome?.created_at));
// (The "prompt silenced after confirmation" case is covered by the pure
// unit tests — a terminal case legally rejects further PATCHes, so the
// negative path can't be re-exercised over HTTP.)

// 9. Privacy deletion removes everything the user touched
const del = await api('DELETE', '/api/privacy', null, token);
const deletedTotal = Object.values(del.json?.deleted ?? {}).reduce((a, b) => a + b, 0);
check('DELETE /api/privacy removes user data', del.status === 200 && deletedTotal >= 3, `deleted: ${JSON.stringify(del.json?.deleted)}`);

await pgClient.query(`delete from auth.users where id = $1`, [USER]);
await pgClient.end();

console.log(failures === 0 ? '\nHTTP SMOKE: ALL PASS' : `\nHTTP SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
