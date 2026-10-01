// Quick read-back of seeded data. Usage: node scripts/check_seed.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m || m[1].startsWith('#')) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(new URL('../.env.local', import.meta.url));
const client = new pg.Client({
  host: env.SUPABASE_DB_HOST, port: Number(env.SUPABASE_DB_PORT ?? 5432), user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
});
await client.connect();
const sample = await client.query(
  `select d.name, p.price_type, p.price_usd, s.evidence_grade
   from price_points p join drugs d on d.id = p.drug_id join sources s on s.id = p.source_id
   order by d.name, p.price_type`,
);
console.table(sample.rows);
const counts = await client.query(
  `select (select count(*) from drugs)::int as drugs,
          (select count(*) from price_points)::int as prices,
          (select count(*) from sources)::int as sources`,
);
console.log(counts.rows[0]);
await client.end();
