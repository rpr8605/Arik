// db/027 smoke: user_style_prefs row security against the LOCAL Supabase
// stack (connection from .env.local, loopback only). Owner-only access,
// allowed values only, no extra fields, delete works. Fixture users are
// removed afterwards. Run: node scripts/smoke_style_prefs.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(here, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(env.SUPABASE_DB_HOST)) {
  console.error(`refusing: SUPABASE_DB_HOST=${env.SUPABASE_DB_HOST} is not loopback`);
  process.exit(1);
}
const client = new pg.Client({
  host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 54322), user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 15000,
});

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const A = randomUUID();
const B = randomUUID();

// Run fn as an authenticated user (what PostgREST does for a signed-in JWT).
async function asUser(uid, fn) {
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: uid, role: 'authenticated' }), uid]);
    await client.query('set local role authenticated');
    const out = await fn();
    await client.query('commit');
    return { ok: true, out };
  } catch (e) {
    await client.query('rollback');
    return { ok: false, error: e.message };
  }
}

await client.connect();
try {
  await client.query(`insert into auth.users (id, aud, role) values ($1,'authenticated','authenticated'), ($2,'authenticated','authenticated')`, [A, B]);

  const insA = await asUser(A, () => client.query(`insert into user_style_prefs (user_id, length, reply_order) values ($1, 'short', 'answer_first')`, [A]));
  check('owner can save their own preference', insA.ok, insA.error);
  const insForB = await asUser(A, () => client.query(`insert into user_style_prefs (user_id, length) values ($1, 'detailed')`, [B]));
  check('user A cannot save a preference for user B', !insForB.ok);
  const insB = await asUser(B, () => client.query(`insert into user_style_prefs (user_id, length) values ($1, 'detailed')`, [B]));
  check('user B can save their own', insB.ok, insB.error);

  const readA = await asUser(A, () => client.query('select user_id, length from user_style_prefs'));
  check('A sees only their own row', readA.ok && readA.out.rows.length === 1 && readA.out.rows[0].user_id === A, JSON.stringify(readA.out?.rows));
  const updB = await asUser(A, () => client.query(`update user_style_prefs set length = 'short' where user_id = $1`, [B]));
  check("A cannot change B's row (0 rows)", updB.ok && updB.out.rowCount === 0);
  const delB = await asUser(A, () => client.query('delete from user_style_prefs where user_id = $1', [B]));
  check("A cannot delete B's row (0 rows)", delB.ok && delB.out.rowCount === 0);

  const bad = await asUser(A, () => client.query(`update user_style_prefs set length = 'tiny' where user_id = $1`, [A]));
  check('only allowed values can be stored', !bad.ok && /check/i.test(bad.error ?? ''));
  const { rows: cols } = await client.query(`select column_name from information_schema.columns where table_name = 'user_style_prefs' order by column_name`);
  check('table holds only length, order and bookkeeping (no traits, no mood)', JSON.stringify(cols.map((c) => c.column_name)) === JSON.stringify(['length', 'reply_order', 'updated_at', 'user_id']), cols.map((c) => c.column_name).join(','));

  const delA = await asUser(A, () => client.query('delete from user_style_prefs where user_id = $1', [A]));
  check('owner can delete their preference', delA.ok && delA.out.rowCount === 1);
  const { rows: left } = await client.query('select user_id from user_style_prefs where user_id = any($1::uuid[])', [[A, B]]);
  check("after A's delete only B's row remains", left.length === 1 && left[0].user_id === B);

  const { rows: rls } = await client.query(`select relrowsecurity from pg_class where relname = 'user_style_prefs'`);
  check('row security enabled', rls[0]?.relrowsecurity === true);
} catch (e) {
  failures++;
  console.error(`FAIL  unexpected error: ${e.message}`);
} finally {
  await client.query('delete from user_style_prefs where user_id = any($1::uuid[])', [[A, B]]).catch(() => {});
  await client.query('delete from auth.users where id = any($1::uuid[])', [[A, B]]).catch(() => {});
  await client.end();
}
console.log(failures === 0 ? '\nSTYLE PREFS SMOKE: ALL PASS' : `\nSTYLE PREFS SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
