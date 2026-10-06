// Read-only ad-hoc query runner for the Arik database. Usage:
//   node scripts/query.mjs "select ..." 
// Prints rows as JSON. Read-only by connection-level guard.
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

const sql = process.argv[2];
if (!sql) throw new Error('usage: node scripts/query.mjs "<select ...>"');
if (!/^\s*(select|with|explain)\b/i.test(sql)) throw new Error('read-only: select/with/explain only');

const env = loadEnv(new URL('../.env.local', import.meta.url));
const client = new pg.Client({
  host: env.SUPABASE_DB_HOST,
  port: Number(env.SUPABASE_DB_PORT ?? 5432),
  user: 'postgres',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: env.SUPABASE_DB_SSL === 'off' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 60000,
});

await client.connect();
await client.query('set transaction read only');
const res = await client.query(sql);
console.log(JSON.stringify(res.rows, null, 1));
await client.end();
