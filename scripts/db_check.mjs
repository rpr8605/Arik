// M02-AC2: reports the built database's shape - table count, row counts
// for the seeded tables, and RLS state per table. Read-only. Connection
// from .env.local only. Usage: npm run db:check
import { readFileSync } from 'node:fs';
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

const client = new pg.Client({
  host: env.SUPABASE_DB_HOST,
  port: Number(env.SUPABASE_DB_PORT ?? 54322),
  user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await client.connect();

const tables = await client.query(
  `select c.relname as name, c.relrowsecurity as rls
   from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' order by c.relname`,
);
console.log(`tables in public: ${tables.rows.length}`);
const noRls = tables.rows.filter((t) => !t.rls).map((t) => t.name);
console.log(`RLS enabled: ${tables.rows.length - noRls.length}/${tables.rows.length}`);
console.log(`tables WITHOUT RLS: ${noRls.length ? noRls.join(', ') : '(none)'}`);

const seeded = [
  'drugs', 'price_points', 'sources', 'exploits', 'accumulator_policies',
  'state_accumulator_ban_laws', 'exception_precedents', 'counter_override_guidance',
  'eligibility_programs',
  'price_sources', 'hospital_financial_assistance_policies', 'employer_plans',
  'referral_resources',
];
console.log('\nseeded row counts:');
for (const t of seeded) {
  try {
    const r = await client.query(`select count(*)::int as n from ${t}`);
    console.log(`  ${t}: ${r.rows[0].n}`);
  } catch {
    console.log(`  ${t}: (table missing)`);
  }
}
await client.end();
