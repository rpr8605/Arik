// Ingest runner integration test (build ticket 2026-10-01): runs the
// real CLI (tsx child process) against the LOCAL arik-pg container and
// verifies staging, upsert, idempotency, drug matching, dry-run, and the
// disabled-source skip. Requires: docker arik-pg up with schema applied
// through db/022 (scripts/local_pg_apply.mjs).
// Run: node scripts/test_ingest_integration.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const client = new pg.Client({
  host: process.env.ARIK_PGHOST ?? '127.0.0.1',
  port: Number(process.env.ARIK_PGPORT ?? 54329),
  user: process.env.ARIK_PGUSER ?? 'postgres',
  password: process.env.ARIK_PGPASSWORD ?? 'postgres',
  database: process.env.ARIK_PGDATABASE ?? 'arik',
  connectionTimeoutMillis: 10000,
  statement_timeout: 60000,
});

function runIngest(extraArgs = []) {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/ingest_prices.ts', '--source', 'nadac', '--file', 'scripts/fixtures/nadac_sample.json', ...extraArgs],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 },
  );
  return out;
}

await client.connect();

// --- clean slate (fixture rows only; the local DB has no real seeds) ---
await client.query(`delete from price_points where price_source_id is not null`);
await client.query(`delete from raw_price_ingest`);
await client.query(`delete from drugs where name in ('Apixaban', 'Empagliflozin', 'Rosuvastatin')`);
await client.query(`insert into drugs (name, brand_names) values
  ('Apixaban', '{Eliquis}'),
  ('Empagliflozin', '{Jardiance}')`);
await client.query(`update price_sources set enabled = true where name = 'nadac'`);

// --- run 1: 3 adapter-accepted rows, but Rosuvastatin has no drug row ---
const out1 = runIngest();
check('run 1: received 9', /received:\s+9/.test(out1), out1.match(/received:.*$/)?.[0]);
check('run 1: accepted 3', /accepted:\s+3/.test(out1));
check('run 1: rejected 7 (6 adapter + 1 unknown drug)', /rejected:\s+7/.test(out1), out1.match(/rejected:.*$/)?.[0]);
check('run 1: upserted 2', /upserted:\s+2/.test(out1));

const { rows: prices1 } = await client.query(
  `select p.ndc, p.price_usd, p.price_type, p.observed_at::text as observed_at, p.unit_count, d.name as drug
   from price_points p join drugs d on d.id = p.drug_id
   where p.price_source_id is not null order by d.name`,
);
check('price_points holds apixaban + empagliflozin only', prices1.length === 2 && prices1[0].drug === 'Apixaban' && prices1[1].drug === 'Empagliflozin', JSON.stringify(prices1.map((r) => r.drug)));
check('apixaban row: price_type acquisition_benchmark', prices1[0]?.price_type === 'acquisition_benchmark');
check('apixaban row: price 9.51, ndc 11-digit', Number(prices1[0]?.price_usd) === 9.51 && /^\d{11}$/.test(prices1[0]?.ndc ?? ''));
check('apixaban row: observed_at from effective_date', String(prices1[0]?.observed_at).startsWith('2026-09-15'));
check('empagliflozin row: hyphenated ndc normalized', prices1[1]?.ndc === '00093010401');

const { rows: staging1 } = await client.query(`select status, count(*)::int as n from raw_price_ingest group by status`);
const st1 = Object.fromEntries(staging1.map((r) => [r.status, r.n]));
check('staging: 2 upserted + 7 rejected', st1.upserted === 2 && st1.rejected === 7, JSON.stringify(st1));
const { rows: rejReasons } = await client.query(`select error from raw_price_ingest where status = 'rejected'`);
check('unknown-drug reject names the drug', rejReasons.some((r) => /unknown drug: ROSUVASTATIN 20 MG TABLET/.test(r.error ?? '')), JSON.stringify(rejReasons.map((r) => r.error).slice(0, 2)));
check('every rejected staging row carries a reason', rejReasons.every((r) => (r.error ?? '').length > 0));

// --- run 2: idempotency - same file, no duplicates ---
const { rows: [before] } = await client.query(`select count(*)::int as n from price_points where price_source_id is not null`);
runIngest();
const { rows: [after] } = await client.query(`select count(*)::int as n from price_points where price_source_id is not null`);
check('run 2: re-running the same file creates no duplicates', before.n === 2 && after.n === 2, `before ${before.n}, after ${after.n}`);
const { rows: ids } = await client.query(`select id from price_points where price_source_id is not null order by id`);
check('run 2: same rows updated, not re-inserted', ids.length === 2);

// --- run 3: add the missing drug, the formerly-rejected row now upserts ---
await client.query(`insert into drugs (name, brand_names) values ('Rosuvastatin', '{Crestor}')`);
const out3 = runIngest();
check('run 3: rejected back down to 6', /rejected:\s+6/.test(out3));
const { rows: [c3] } = await client.query(`select count(*)::int as n from price_points where price_source_id is not null`);
check('run 3: rosuvastatin now upserted (3 price rows)', c3.n === 3, `count ${c3.n}`);

// --- dry run writes nothing ---
const { rows: [ppBefore] } = await client.query(`select count(*)::int as n from price_points`);
const { rows: [rawBefore] } = await client.query(`select count(*)::int as n from raw_price_ingest`);
const outDry = runIngest(['--dry-run']);
const { rows: [ppAfter] } = await client.query(`select count(*)::int as n from price_points`);
const { rows: [rawAfter] } = await client.query(`select count(*)::int as n from raw_price_ingest`);
check('dry run: prints the summary', /DRY RUN - nothing written/.test(outDry));
check('dry run: zero writes', ppBefore.n === ppAfter.n && rawBefore.n === rawAfter.n, `pp ${ppBefore.n}->${ppAfter.n}, raw ${rawBefore.n}->${rawAfter.n}`);

// --- disabled source is skipped ---
await client.query(`update price_sources set enabled = false where name = 'nadac'`);
const outSkip = runIngest();
check('disabled source: skip message, no work', /SKIP: source 'nadac' is disabled/.test(outSkip));
await client.query(`update price_sources set enabled = true where name = 'nadac'`);

// --- teardown: leave the local DB as found ---
await client.query(`delete from price_points where price_source_id is not null`);
await client.query(`delete from raw_price_ingest`);
await client.query(`delete from drugs where name in ('Apixaban', 'Empagliflozin', 'Rosuvastatin')`);

await client.end();
console.log(failures === 0 ? '\nINGEST INTEGRATION: ALL PASS' : `\nINGEST INTEGRATION: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
