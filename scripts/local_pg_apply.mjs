// LOCAL DEVELOPMENT ONLY. Applies schema.sql + db/002..db/022 to a bare
// local Postgres (see scripts/local_pg_bootstrap.sql for what is
// emulated). Reads NO remote credentials: connection comes from ARIK_PG*
// env with localhost defaults matching the arik-pg dev container.
// Usage: node scripts/local_pg_apply.mjs [through 022] [--only 022]
//   default: bootstrap + schema.sql + all migrations through <through>
//   --only NNN: apply just db/NNN_*.sql (schema is one-shot, not idempotent)
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

const ONLY_IDX = process.argv.indexOf('--only');
const ONLY = ONLY_IDX > -1 ? process.argv[ONLY_IDX + 1] : null;
const THROUGH = process.argv[2] ?? '022';

const client = new pg.Client({
  host: process.env.ARIK_PGHOST ?? '127.0.0.1',
  port: Number(process.env.ARIK_PGPORT ?? 54329),
  user: process.env.ARIK_PGUSER ?? 'postgres',
  password: process.env.ARIK_PGPASSWORD ?? 'postgres',
  database: process.env.ARIK_PGDATABASE ?? 'arik',
  connectionTimeoutMillis: 10000,
  statement_timeout: 120000,
});

// db/009's two extension lines cannot run on a bare postgres image
// (pg_cron/pg_net are Supabase platform packages). Everything else in
// every file runs byte-for-byte as written.
const LOCAL_ONLY_FILTER = /^create extension if not exists (pg_cron|pg_net);\s*$/gim;

const files = ONLY
  ? readdirSync(new URL('../db', import.meta.url))
      .filter((f) => f.startsWith(`${ONLY}_`) && f.endsWith('.sql'))
      .map((f) => `db/${f}`)
  : [
      'scripts/local_pg_bootstrap.sql',
      'schema.sql',
      ...readdirSync(new URL('../db', import.meta.url))
        .filter((f) => /^\d{3}_.*\.sql$/.test(f))
        .sort()
        .filter((f) => f.slice(0, 3) <= THROUGH)
        .map((f) => `db/${f}`),
    ];

await client.connect();
for (const file of files) {
  let sql = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  let note = '';
  if (LOCAL_ONLY_FILTER.test(sql)) {
    LOCAL_ONLY_FILTER.lastIndex = 0;
    sql = sql.replace(LOCAL_ONLY_FILTER, '-- [local filter] pg_cron/pg_net extension skipped (stubbed in bootstrap)');
    note = ' [pg_cron/pg_net create-extension lines filtered, LOCAL ONLY]';
  }
  try {
    await client.query(sql);
    console.log(`OK    ${file}${note}`);
  } catch (e) {
    console.error(`FAIL  ${file}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log('\nLOCAL SCHEMA APPLY: ALL OK');
