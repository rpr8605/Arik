// M02-AC1: one command builds the full Arik database from empty against
// the LOCAL Supabase CLI stack: schema.sql, then every db/0*.sql in
// numeric order (the AGENTS.md apply order), then the seed scripts.
//
// Connection comes from .env.local only (M02-AC3): SUPABASE_DB_HOST /
// SUPABASE_DB_PORT / SUPABASE_DB_PASSWORD / SUPABASE_DB_SSL.
//
// SAFETY: this DROPS the public schema. It refuses to run against any
// host that is not loopback (never point it at a remote project).
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
if (!/^(127\.0\.0\.1|localhost|host\.docker\.internal)$/.test(host ?? '')) {
  console.error(`REFUSING to reset non-local database host: ${host ?? '(unset)'}`);
  process.exit(1);
}

const client = new pg.Client({
  host,
  port: Number(env.SUPABASE_DB_PORT ?? 54322),
  user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 180000,
});

await client.connect();
console.log(`resetting public schema on ${host}:${env.SUPABASE_DB_PORT ?? 54322} ...`);
// Fresh public schema + the role grants the Supabase stack expects
// (table-level grants are explicit in db/004_grants.sql).
await client.query(`
  drop schema public cascade;
  create schema public;
  grant usage on schema public to anon, authenticated, service_role;
  grant all on schema public to postgres, service_role;
`);

const files = readdirSync(join(here, '..', 'db'))
  .filter((f) => /^0\d\d_.*\.sql$/.test(f))
  .sort();

// Order matters: schema.sql, then the SEED SCRIPTS, then db/0*.sql.
// Several migrations are data-patches keyed on seeded rows by title/name
// (db/013 and db/018 update the Eliquis card and insert its DTP rows and
// evidence conflicts; db/017 flips seeded exploits to verified_current;
// db/020 classifies the conflicts). This mirrors the original hosted
// project's history (schema -> seeds -> migrations over time). Running
// migrations first leaves those patches matching nothing.
async function applySql(file) {
  process.stdout.write(`applying ${file} ... `);
  // One implicit transaction per file: any failure rolls that file back.
  await client.query(readFileSync(join(here, '..', file), 'utf8'));
  console.log('ok');
}

await applySql('schema.sql');

for (const seed of ['seed_drugs.mjs', 'seed_exploits.mjs']) {
  console.log(`seeding via scripts/${seed} ...`);
  const r = spawnSync(process.execPath, [join(here, seed)], { stdio: 'inherit', timeout: 120000 });
  if (r.status !== 0) {
    console.error(`seed ${seed} FAILED (exit ${r.status})`);
    process.exit(1);
  }
}

for (const file of files) await applySql(`db/${file}`);
await client.end();
console.log('\nDB RESET: complete');
