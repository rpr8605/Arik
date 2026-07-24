// RLS smoke test for the Arik project: proves cross-user access is blocked
// by policies, using simulated authenticated JWT claims at the SQL level.
// Usage: node scripts/smoke_rls.mjs   (reads .env.local)
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m || m[1].startsWith('#')) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = loadEnv(new URL('../.env.local', import.meta.url));
const client = new pg.Client({
  host: env.SUPABASE_DB_HOST,
  port: 5432,
  user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
}

// Runs fn as the authenticated role with the given user's JWT claims.
async function asUser(userId, fn) {
  await client.query('begin');
  try {
    await client.query('set local role authenticated');
    await client.query(`set local request.jwt.claims to '{"sub":"${userId}"}'`);
    return await fn();
  } finally {
    await client.query('rollback'); // rollback also resets role/claims
  }
}

await client.connect();
console.log('RLS smoke test (simulated authenticated users A and B)\n');

// Fixture users must exist in auth.users (user_identity.id and
// cases.user_id are FKs to it). Cleaned up at the end.
async function createFixtureUsers() {
  for (const [id, email] of [[USER_A, 'rls_smoke_a@example.invalid'], [USER_B, 'rls_smoke_b@example.invalid']]) {
    await client.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at,
                               raw_app_meta_data, raw_user_meta_data)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
               $2, crypt('smoke', gen_salt('bf')), now(), now(), now(), '{}', '{}')
       on conflict (id) do nothing`,
      [id, email],
    );
  }
}
async function dropFixtureUsers() {
  await client.query(`delete from user_identity where id in ($1, $2)`, [USER_A, USER_B]);
  await client.query(`delete from cases where user_id in ($1, $2)`, [USER_A, USER_B]);
  await client.query(`delete from auth.users where id in ($1, $2)`, [USER_A, USER_B]);
}
await createFixtureUsers();

// 1. User A can insert their OWN identity row (owner policy allows).
const ownInsert = await asUser(USER_A, async () => {
  try {
    await client.query(`insert into user_identity (id) values ('${USER_A}')`);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.message };
  }
});
check('user A inserts own user_identity', ownInsert.ok, ownInsert.err);

// 2. User A inserts a row owned by user B -> must be rejected by WITH CHECK.
const crossInsert = await asUser(USER_A, async () => {
  try {
    await client.query(`insert into user_identity (id) values ('${USER_B}')`);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.message };
  }
});
check('user A inserting user B identity is BLOCKED', !crossInsert.ok && /row-level security/i.test(crossInsert.err ?? ''), crossInsert.ok ? 'NOT blocked!' : crossInsert.err);

// 3. User B cannot see user A's identity row (cross-user read blocked).
//    (A's row from test 1 was rolled back, so A first writes it as postgres.)
await client.query(`insert into user_identity (id) values ('${USER_A}') on conflict (id) do nothing`);
const crossRead = await asUser(USER_B, async () => {
  const r = await client.query(`select count(*)::int as n from user_identity where id = '${USER_A}'`);
  return r.rows[0].n;
});
check('user B reading user A identity returns 0 rows', crossRead === 0, `saw ${crossRead} row(s)`);
await client.query(`delete from user_identity where id = '${USER_A}'`);

// 4. Reference data is readable by any authenticated user...
const refRead = await asUser(USER_A, async () => {
  const r = await client.query(`select count(*)::int as n from drugs`);
  return { ok: true, n: r.rows[0].n };
});
check('authenticated user can READ reference table (drugs)', refRead.ok, `${refRead.n} rows`);

// 5. ...but cannot WRITE it (no insert policy -> blocked).
const refWrite = await asUser(USER_A, async () => {
  try {
    await client.query(`insert into drugs (name) values ('rls_smoke_should_fail')`);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.message };
  }
});
check('authenticated user writing reference table is BLOCKED', !refWrite.ok && /row-level security|permission denied/i.test(refWrite.err ?? ''), refWrite.ok ? 'NOT blocked!' : refWrite.err);

// 6. Cases: A creates a case; B must not see it.
await client.query(`insert into cases (user_id, case_type) values ('${USER_A}', 'bill_dispute')`);
const caseRead = await asUser(USER_B, async () => {
  const r = await client.query(`select count(*)::int as n from cases where user_id = '${USER_A}'`);
  return r.rows[0].n;
});
check('user B reading user A cases returns 0 rows', caseRead === 0, `saw ${caseRead} row(s)`);
await client.query(`delete from cases where user_id = '${USER_A}'`);

await dropFixtureUsers();
await client.end();
const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? '\nRLS SMOKE: ALL PASS' : `\nRLS SMOKE: ${failed.length} FAILURE(S)`);
process.exit(failed.length === 0 ? 0 : 1);
