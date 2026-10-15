// db/028 smoke: demo sample patients against the LOCAL Supabase stack
// (connection from .env.local, loopback only). Proves: the 60-minute idle
// purge removes a sample case and every child row; a fresh sample is kept;
// Reset touches only one user's one tab; real cases are never deleted by
// the sample functions; the 90-day purge skips samples; another user can't
// read a sample through row security; anon/authenticated can't call the
// purge functions. Fixture users are removed afterwards.
// Run: node scripts/smoke_demo_samples.mjs
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
const TAB1 = randomUUID();
const TAB2 = randomUUID();

async function asRole(role, uid, sql, params = []) {
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: uid, role }), uid]);
    await client.query(`set local role ${role}`);
    const r = await client.query(sql, params);
    await client.query('commit');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await client.query('rollback');
    return { ok: false, error: e.message };
  }
}

// A sample case with a chat session, two messages and a pending correction.
async function makeCase(user, opts) {
  const { rows } = await client.query(
    `insert into cases (user_id, case_type, is_sample, sample_key, sample_session_id, sample_last_active_at)
     values ($1, 'prescription_savings', $2, $3, $4, now() - ($5 || ' minutes')::interval) returning id`,
    [user, opts.sample, opts.sample ? opts.key ?? 'maria' : null, opts.sample ? opts.tab : null, String(opts.idleMinutes ?? 0)],
  );
  const caseId = rows[0].id;
  const s = await client.query(`insert into chat_sessions (user_id, case_id) values ($1, $2) returning id`, [user, caseId]);
  await client.query(
    `insert into chat_messages (session_id, role, content, retrieved_exploit_ids) values ($1,'user','hi',null), ($1,'assistant','hello','{}')`,
    [s.rows[0].id],
  );
  return { caseId, sessionId: s.rows[0].id };
}
const exists = async (caseId) => (await client.query('select 1 from cases where id = $1', [caseId])).rowCount === 1;
const messagesFor = async (sessionId) => Number((await client.query('select count(*) from chat_messages where session_id = $1', [sessionId])).rows[0].count);

await client.connect();
try {
  await client.query(`insert into auth.users (id, aud, role) values ($1,'authenticated','authenticated'), ($2,'authenticated','authenticated')`, [A, B]);

  // Idle purge.
  const idle = await makeCase(A, { sample: true, tab: TAB1, idleMinutes: 61 });
  const fresh = await makeCase(A, { sample: true, tab: TAB1, key: 'james', idleMinutes: 5 });
  const realOld = await makeCase(A, { sample: false, idleMinutes: 600 });
  await client.query('select purge_idle_sample_cases()');
  check('idle purge: a sample idle 61 minutes is deleted', !(await exists(idle.caseId)));
  check('idle purge: its chat messages and session are deleted too', (await messagesFor(idle.sessionId)) === 0 &&
    (await client.query('select 1 from chat_sessions where id = $1', [idle.sessionId])).rowCount === 0);
  check('idle purge: a sample active 5 minutes ago is kept', await exists(fresh.caseId));
  check('idle purge: a real case is never touched', await exists(realOld.caseId));

  // Reset: one user, one tab.
  const otherTab = await makeCase(A, { sample: true, tab: TAB2 });
  const otherUser = await makeCase(B, { sample: true, tab: TAB1 });
  const { rows: [{ reset_sample_session: n }] } = await client.query('select reset_sample_session($1, $2)', [A, TAB1]);
  check('reset: deletes this tab\'s sample cases', n === 1 && !(await exists(fresh.caseId)), `deleted ${n}`);
  check('reset: the same user\'s other tab is untouched', await exists(otherTab.caseId));
  check('reset: another user with the same tab id is untouched', await exists(otherUser.caseId));

  // delete_sample_cases refuses real cases.
  const { rows: [{ delete_sample_cases: d }] } = await client.query('select delete_sample_cases(array[$1]::uuid[])', [realOld.caseId]);
  check('delete_sample_cases: refuses a real case id', d === 0 && (await exists(realOld.caseId)));

  // 90-day purge skips samples (no case_summaries row for a sample).
  await client.query(`update cases set resolved_at = now() - interval '100 days', status = 'resolved_won', sample_last_active_at = now() where id = $1`, [otherTab.caseId]);
  const before = Number((await client.query('select count(*) from case_summaries where user_id = $1', [A])).rows[0].count);
  await client.query('select purge_expired_cases()');
  const after = Number((await client.query('select count(*) from case_summaries where user_id = $1', [A])).rows[0].count);
  check('90-day purge: skips a resolved sample, writes no summary', (await exists(otherTab.caseId)) && after === before);

  // Row security: B cannot read A's sample.
  const asB = await asRole('authenticated', B, 'select id from cases where id = $1', [otherTab.caseId]);
  check("row security: user B can't read user A's sample case", asB.ok && asB.rows.length === 0, asB.error);
  const asA = await asRole('authenticated', A, 'select id from cases where id = $1', [otherTab.caseId]);
  check('row security: user A can read their own sample case', asA.ok && asA.rows.length === 1, asA.error);

  // The functions are server-only.
  for (const [role, fn] of [['anon', 'select purge_idle_sample_cases()'], ['authenticated', `select reset_sample_session('${A}', '${TAB2}')`]]) {
    const r = await asRole(role, A, fn);
    check(`${role} cannot call ${fn.split('(')[0].replace('select ', '')}`, !r.ok);
  }
  check('nothing was deleted by the refused calls', await exists(otherTab.caseId));

  // The cron job exists.
  const job = await client.query(`select schedule from cron.job where jobname = 'purge-idle-sample-cases'`);
  check('pg_cron: purge-idle-sample-cases runs every 5 minutes', job.rows[0]?.schedule === '*/5 * * * *');
} finally {
  const ids = (await client.query('select id from cases where user_id = any($1::uuid[])', [[A, B]])).rows.map((r) => r.id);
  await client.query('delete from chat_messages where session_id in (select id from chat_sessions where case_id = any($1::uuid[]))', [ids]);
  await client.query('delete from chat_sessions where case_id = any($1::uuid[])', [ids]);
  await client.query('delete from case_summaries where user_id = any($1::uuid[])', [[A, B]]);
  await client.query('delete from cases where id = any($1::uuid[])', [ids]);
  await client.query('delete from auth.users where id = any($1::uuid[])', [[A, B]]);
  await client.end();
}

console.log(failures === 0 ? '\nDEMO SAMPLES SMOKE: ALL PASS' : `\nDEMO SAMPLES SMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
