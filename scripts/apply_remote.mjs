// Apply an export_seed.mjs file to the DEMO database, guarded.
//
//   node scripts/apply_remote.mjs <file.sql> [--env .env.remote]            (dry run: applies, reports, ROLLS BACK)
//   node scripts/apply_remote.mjs <file.sql> [--env .env.remote] --confirm  (applies and commits)
//   node scripts/apply_remote.mjs <file.sql> --local                        (test against the local arik-pg; ARIK_PG* env)
//
// Guards: the target must be the Arik Supabase project (host or user names
// project ref iwayoxmpbueneagdkpzj); the MsJaneHH project or anything else
// is refused. Prerequisite tables/columns are checked before anything runs.
// Prints counts and sizes only, never credentials. One transaction.
// Timeouts: 15s to connect, 4 minutes for the file.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const ARIK_REF = 'iwayoxmpbueneagdkpzj';
const FREE_PLAN_BYTES = 500 * 1024 * 1024;

const file = process.argv[2];
const confirm = process.argv.includes('--confirm');
const local = process.argv.includes('--local');
const envArg = process.argv.indexOf('--env');
const envFile = envArg > 0 ? process.argv[envArg + 1] : '.env.remote';
if (!file || file.startsWith('--')) {
  console.error('usage: node scripts/apply_remote.mjs <file.sql> [--env .env.remote] [--confirm] | --local');
  process.exit(1);
}

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m || m[1].startsWith('#')) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

let config;
if (local) {
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('--local means a loopback database');
  config = {
    host,
    port: Number(process.env.ARIK_PGPORT ?? 54329),
    user: process.env.ARIK_PGUSER ?? 'postgres',
    password: process.env.ARIK_PGPASSWORD ?? 'postgres',
    database: process.env.ARIK_PGDATABASE ?? 'arik',
  };
} else {
  const env = loadEnv(envFile);
  const host = env.SUPABASE_DB_HOST ?? '';
  const user = env.SUPABASE_DB_USER ?? 'postgres';
  if (!host.includes(ARIK_REF) && !user.includes(ARIK_REF)) {
    console.error(`refused: ${envFile} does not point at the Arik project (${ARIK_REF}).`);
    process.exit(1);
  }
  config = {
    host,
    port: Number(env.SUPABASE_DB_PORT ?? 5432),
    user,
    password: env.SUPABASE_DB_PASSWORD,
    database: env.SUPABASE_DB_NAME ?? 'postgres',
    ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  };
}

const c = new pg.Client({ ...config, connectionTimeoutMillis: 15000, statement_timeout: 240000 });
const mb = (b) => `${(Number(b) / 1048576).toFixed(1)} MB`;
await c.connect();
try {
  const need = await c.query(`
    select to_regclass('public.drug_rank_list') is not null as rank_list,
           to_regclass('public.drug_ndcs') is not null as ndcs,
           to_regclass('public.zip_centroids') is not null as zips,
           exists (select 1 from information_schema.columns where table_name = 'price_points' and column_name = 'rate_class') as rate_class,
           exists (select 1 from pg_indexes where indexname = 'price_points_ingest_natural_pharmacy') as pharmacy_key,
           exists (select 1 from price_sources where name = 'nadac') as nadac_source`);
  const missing = Object.entries(need.rows[0]).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) {
    console.error(`stop: the target is missing ${missing.join(', ')}. Apply db/031 and db/032 first.`);
    process.exit(1);
  }
  const counts = async () =>
    (await c.query(`select (select count(*) from drugs) drugs, (select count(*) from drug_rank_list) ranked, (select count(*) from drug_ndcs) ndcs,
                           (select count(*) from price_points where price_type = 'acquisition_benchmark') nadac, (select count(*) from zip_centroids) zips,
                           pg_database_size(current_database()) bytes`)).rows[0];
  const before = await counts();
  await c.query('begin');
  const t0 = Date.now();
  await c.query(readFileSync(file, 'utf8'));
  const after = await counts();
  console.log(`target: ${local ? 'local test database' : 'Arik demo database'}; applied in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const k of ['drugs', 'ranked', 'ndcs', 'nadac', 'zips']) console.log(`  ${k.padEnd(7)} ${before[k]} -> ${after[k]}`);
  console.log(`  size    ${mb(before.bytes)} -> ${mb(after.bytes)} of ${mb(FREE_PLAN_BYTES)} (free plan)`);
  if (Number(after.bytes) > FREE_PLAN_BYTES * 0.8) {
    await c.query('rollback');
    console.error('stop: the result would use more than 80% of the free plan. Rolled back.');
    process.exit(1);
  }
  if (confirm) {
    await c.query('commit');
    console.log('COMMITTED.');
  } else {
    await c.query('rollback');
    console.log('DRY RUN: rolled back. Re-run with --confirm to apply.');
  }
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(`FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
