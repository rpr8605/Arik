// Applies the Arik database build to a FRESH Supabase project, in order:
//   schema.sql -> db/002_identity_crypto.sql -> db/003_rls_policies.sql
// Refuses to run against a project that already has public tables.
// Usage: node scripts/apply_db.mjs   (reads .env.local)
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
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD missing from .env.local');

const client = new pg.Client({
  host: env.SUPABASE_DB_HOST,
  port: Number(env.SUPABASE_DB_PORT ?? 5432),
  user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();
console.log(`connected to ${env.SUPABASE_DB_HOST}`);

const { rows } = await client.query(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
if (rows[0].n > 0) {
  console.error(`REFUSING TO RUN: public schema already contains ${rows[0].n} table(s). This script targets a fresh project only.`);
  await client.end();
  process.exit(1);
}
console.log('project is empty - proceeding');

for (const file of ['schema.sql', 'db/002_identity_crypto.sql', 'db/003_rls_policies.sql']) {
  const sql = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  console.log(`applying ${file} ...`);
  await client.query(sql);
  console.log(`  ok`);
}

const tables = await client.query(
  `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
);
const rls = await client.query(
  `select count(*)::int as n
   from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
);
const fns = await client.query(
  `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('encrypt_identity','decrypt_identity','can_access_case')`,
);
const roundtrip = await client.query(
  `select decrypt_identity(encrypt_identity('Arik smoke test', 'smoke-key'), 'smoke-key') as value`,
);

console.log('\n--- verification ---');
console.log(`tables in public:            ${tables.rows[0].n} (expect 38)`);
console.log(`tables with RLS enabled:     ${rls.rows[0].n} (expect 27 - later migrations cover the rest)`);
console.log(`helper functions present:    ${fns.rows[0].n} (expect 3)`);
console.log(`encrypt/decrypt round-trip:  "${roundtrip.rows[0].value}" (expect "Arik smoke test")`);

const pass =
  tables.rows[0].n === 38 &&
  rls.rows[0].n === 27 &&
  fns.rows[0].n === 3 &&
  roundtrip.rows[0].value === 'Arik smoke test';
console.log(pass ? '\nAPPLY + VERIFY: PASS' : '\nAPPLY + VERIFY: FAIL');
await client.end();
process.exit(pass ? 0 : 1);
