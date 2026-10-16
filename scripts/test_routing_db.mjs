// Routing partners, database rules (db/034), against the local arik-pg:
// compensation_to_arik accepts only 'none', display/AI default to false, a
// partner can't be enabled without a data use agreement date, and the
// kill switch / purge commands work end to end with an audit row.
// Self-cleaning. Run: node scripts/test_routing_db.mjs  (ARIK_PG* env)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
};
const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('local database only');
const c = new pg.Client({
  host,
  port: Number(process.env.ARIK_PGPORT ?? 54329),
  user: process.env.ARIK_PGUSER ?? 'postgres',
  password: process.env.ARIK_PGPASSWORD ?? 'postgres',
  database: process.env.ARIK_PGDATABASE ?? 'arik',
  connectionTimeoutMillis: 10000,
  statement_timeout: 60000,
});
const LABEL = 'routing partner (db test)';
const fails = async (sql, params) => {
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
};

await c.connect();
await c.query('delete from routing_partners where partner_label = $1', [LABEL]);

for (const bad of ['referral', 'revenue_share', 'fee', 'None', '']) {
  const err = await fails(`insert into routing_partners (partner_label, compensation_to_arik) values ($1, $2)`, [LABEL, bad]);
  check(`no-payment: compensation_to_arik = '${bad}' is refused`, /routing_partners_no_compensation/.test(err ?? ''), err ?? 'accepted!');
}
const { rows: [row] } = await c.query(`insert into routing_partners (partner_label) values ($1) returning *`, [LABEL]);
check('defaults: disabled, no display, no AI, compensation none', row.enabled === false && row.allow_patient_display === false && row.allow_ai_processing === false && row.compensation_to_arik === 'none');
const upd = await fails(`update routing_partners set compensation_to_arik = 'referral' where id = $1`, [row.id]);
check('no-payment: an update to a paid value is refused too', /routing_partners_no_compensation/.test(upd ?? ''));
const en = await fails(`update routing_partners set enabled = true where id = $1`, [row.id]);
check('cannot enable without a data use agreement date', /routing_partners_enabled_needs_dua/.test(en ?? ''));

await c.query(`update routing_partners set data_use_agreement_date = '2026-10-16' where id = $1`, [row.id]);
await c.query(`insert into routing_intents (partner_id, reference, destination) values ($1, 'arik-test-1', '{"npi":"1000000001"}'), ($1, 'arik-test-2', '{"npi":"1000000002"}')`, [row.id]);
const run = (action) =>
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/routing_admin.ts', action, LABEL], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: process.env });
const { rows: [{ t0 }] } = await c.query('select now() as t0');
run('enable');
check('routing:enable works once a data use agreement date exists', (await c.query('select enabled from routing_partners where id = $1', [row.id])).rows[0].enabled === true);
run('disable');
check('routing:disable is the kill switch', (await c.query('select enabled from routing_partners where id = $1', [row.id])).rows[0].enabled === false);
const out = run('purge');
const left = (await c.query('select count(*)::int n from routing_intents where partner_id = $1', [row.id])).rows[0].n;
check('routing:purge deletes the partner intents', left === 0 && /intents_deleted":2/.test(out), out.trim());
const ev = (await c.query('select action, detail from routing_partner_events where partner_id = $1 and created_at >= $2 order by created_at', [row.id, t0])).rows;
check('every action wrote one audit row with counts only', ev.map((e) => e.action).join() === 'enable,disable,purge' && ev[2].detail.intents_deleted === 2);

await c.query('delete from routing_partner_events where partner_id = $1', [row.id]);
await c.query('delete from routing_partners where id = $1', [row.id]);
await c.end();
console.log(failures === 0 ? '\nROUTING DB: ALL PASS' : `\nROUTING DB: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
