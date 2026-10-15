// db/026 smoke: consume_rate_limits() and purge_rate_limit_counters()
// against the LOCAL Supabase CLI stack (connection from .env.local, same
// as db_check.mjs). Uses its own bucket prefix and fixture auth users and
// removes both afterwards. Run: node scripts/smoke_rate_limit.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m || m[1].startsWith('#')) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(join(here, '..', '.env.local'));
const host = env.SUPABASE_DB_HOST;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`refusing: SUPABASE_DB_HOST=${host} is not loopback (local stack only)`);
  process.exit(1);
}
const config = {
  host,
  port: Number(env.SUPABASE_DB_PORT ?? 54322),
  user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 15000,
};

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const P = `smoke:${randomUUID().slice(0, 8)}`;
const AUTHED = randomUUID();
const ANON1 = randomUUID();
const ANON2 = randomUUID();
const GHOST = randomUUID(); // no auth.users row

const client = new pg.Client(config);
await client.connect();

async function consume(user, checks) {
  const { rows } = await client.query('select consume_rate_limits($1, $2::jsonb) as r', [user, JSON.stringify(checks)]);
  return rows[0].r;
}
async function countOf(bucket, subject) {
  const { rows } = await client.query(
    'select coalesce(sum(count), 0)::int as n from rate_limit_counters where bucket = $1 and subject = $2',
    [bucket, subject],
  );
  return rows[0].n;
}
const chk = (bucket, subject, limit_authed, limit_anon, window_seconds = 3600) => ({ bucket: `${P}:${bucket}`, subject, window_seconds, limit_authed, limit_anon });

try {
  await client.query(
    `insert into auth.users (id, aud, role, is_anonymous) values ($1, 'authenticated', 'authenticated', false), ($2, 'authenticated', 'authenticated', true), ($3, 'authenticated', 'authenticated', true)`,
    [AUTHED, ANON1, ANON2],
  );

  // 1. Allow up to the limit, then block with a bucket and a sane Retry-After.
  {
    const c = [chk('basic', AUTHED, 3, 3, 60)];
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(AUTHED, c));
    check('3 allowed, 4th blocked', results.slice(0, 3).every((r) => r.allowed) && results[3].allowed === false, JSON.stringify(results[3]));
    check('blocked result names the bucket', results[3].bucket === `${P}:basic`);
    check('retry_after_seconds within the window (1..60)', results[3].retry_after_seconds >= 1 && results[3].retry_after_seconds <= 60, `${results[3].retry_after_seconds}`);
    check('blocked call did not increment the counter', (await countOf(`${P}:basic`, AUTHED)) === 3);
  }

  // 2. Anonymous vs signed-in limits come from auth.users.is_anonymous.
  {
    const a = [];
    for (let i = 0; i < 3; i++) a.push(await consume(ANON1, [chk('kind', ANON1, 5, 2)]));
    check('anonymous user gets limit_anon (2)', a[0].allowed && a[1].allowed && !a[2].allowed);
    const s = [];
    for (let i = 0; i < 5; i++) s.push(await consume(AUTHED, [chk('kind', AUTHED, 5, 2)]));
    check('signed-in user gets limit_authed (5)', s.every((r) => r.allowed));
    const g = [];
    for (let i = 0; i < 3; i++) g.push(await consume(GHOST, [chk('kind', GHOST, 5, 2)]));
    check('user id with no auth.users row is treated as anonymous', g[0].allowed && g[1].allowed && !g[2].allowed);
  }

  // 3. All-or-nothing: a block in one window leaves the others untouched.
  {
    const c = [chk('wide', AUTHED, 10, 10), chk('narrow', AUTHED, 1, 1)];
    const first = await consume(AUTHED, c);
    const second = await consume(AUTHED, c);
    check('first passes, second blocked by the narrow window', first.allowed && !second.allowed && second.bucket === `${P}:narrow`);
    check('wide window counted once, not twice', (await countOf(`${P}:wide`, AUTHED)) === 1);
  }

  // 4. Combined anonymous cap: shared across anonymous users, skipped for signed-in.
  {
    const cap = (u) => [chk('anoncap', 'all', null, 2, 86400), chk('peruser', u, 100, 100)];
    const r1 = await consume(ANON1, cap(ANON1));
    const r2 = await consume(ANON2, cap(ANON2));
    const r3 = await consume(ANON2, cap(ANON2));
    const rS = await consume(AUTHED, cap(AUTHED));
    check('two anonymous users share one cap of 2; the 3rd anonymous call is blocked', r1.allowed && r2.allowed && !r3.allowed && r3.bucket === `${P}:anoncap`);
    check('signed-in user is not subject to the anonymous cap', rS.allowed);
    check('anonymous cap counter not touched by the signed-in call', (await countOf(`${P}:anoncap`, 'all')) === 2);
    check('blocked anonymous call did not increment its per-user window', (await countOf(`${P}:peruser`, ANON2)) === 1);
  }

  // 5. Concurrency: 20 parallel calls against a limit of 10 -> exactly 10 allowed.
  {
    const pool = new pg.Pool({ ...config, max: 8 });
    const c = JSON.stringify([chk('race', AUTHED, 10, 10)]);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => pool.query('select consume_rate_limits($1, $2::jsonb) as r', [AUTHED, c]).then((x) => x.rows[0].r)),
    );
    await pool.end();
    const allowed = results.filter((r) => r.allowed).length;
    check('concurrent calls: exactly 10 of 20 allowed', allowed === 10, `allowed ${allowed}`);
    check('concurrent calls: counter is exactly 10', (await countOf(`${P}:race`, AUTHED)) === 10);
  }

  // 6. Only the service role may call it (security definer + REST exposure).
  for (const role of ['anon', 'authenticated']) {
    let denied = false;
    await client.query('begin');
    try {
      await client.query(`set local role ${role}`);
      await client.query('select consume_rate_limits($1, $2::jsonb)', [AUTHED, '[]']);
    } catch (e) {
      denied = /permission denied/i.test(e.message);
    }
    await client.query('rollback');
    check(`role ${role} cannot execute consume_rate_limits`, denied);
  }
  {
    await client.query('begin');
    let ok = false;
    try {
      await client.query('set local role service_role');
      const { rows } = await client.query('select consume_rate_limits($1, $2::jsonb) as r', [AUTHED, '[]']);
      ok = rows[0].r.allowed === true;
    } catch {}
    await client.query('rollback');
    check('service_role can execute it (empty check list -> allowed)', ok);
  }
  {
    const { rows } = await client.query(`select relrowsecurity from pg_class where relname = 'rate_limit_counters'`);
    check('rate_limit_counters has RLS enabled', rows[0]?.relrowsecurity === true);
  }

  // 7. Purge removes windows older than two days and keeps recent ones.
  {
    await client.query(
      `insert into rate_limit_counters (bucket, subject, window_start, count) values ($1, 'old', now() - interval '3 days', 5)`,
      [`${P}:purge`],
    );
    const { rows } = await client.query('select purge_rate_limit_counters() as n');
    const oldLeft = await countOf(`${P}:purge`, 'old');
    const recentLeft = await countOf(`${P}:basic`, AUTHED);
    check('purge deletes the 3-day-old window', rows[0].n >= 1 && oldLeft === 0, `deleted ${rows[0].n}`);
    check('purge keeps current windows', recentLeft === 3);
  }

  // 8. Hourly purge is scheduled.
  {
    const { rows } = await client.query(`select schedule from cron.job where jobname = 'purge-rate-limit-counters'`);
    check('cron job purge-rate-limit-counters scheduled hourly', rows[0]?.schedule === '20 * * * *', rows[0]?.schedule ?? 'missing');
  }
} catch (e) {
  failures++;
  console.error(`FAIL  unexpected error: ${e.message}`);
} finally {
  await client.query('delete from rate_limit_counters where bucket like $1', [`${P}:%`]).catch(() => {});
  await client.query('delete from auth.users where id = any($1::uuid[])', [[AUTHED, ANON1, ANON2]]).catch(() => {});
  await client.end();
}

console.log(failures === 0 ? '\nRATE LIMIT SMOKE: ALL PASS' : `\nRATE LIMIT SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
