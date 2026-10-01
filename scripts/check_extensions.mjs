// One-off: which scheduling extensions are available on this project?
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
const r = await client.query(
  `select name, default_version, installed_version from pg_available_extensions
   where name in ('pg_cron', 'pg_net') order by name`,
);
console.table(r.rows);
await client.end();
