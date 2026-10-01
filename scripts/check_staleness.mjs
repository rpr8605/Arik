// scripts/check_staleness.mjs
// What this is for: the manual staleness flag from ticket 1.4 / open
// question B (2026-08-11). Program terms drift monthly; a row whose
// evidence hasn't been re-checked in >30 days must stop being treated as
// current. There is no automated monitor (deliberately out of scope per
// AGENTS.md) — this script IS the flag: run it, it tells you exactly which
// rows have aged out, and it exits non-zero so it can gate a workflow.
// Called by: manual run (`node scripts/check_staleness.mjs`); CI/wrapper
// scripts may consume the exit code.
// Calls: direct Postgres read-only queries against exploits and sources.
//
// Stale definition: last_verified_at IS NULL (never verified — same
// posture as lib/deadlines.ts's unverified rules) OR age > 30 days.
// sources.next_review_due in the past is also flagged when present.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const STALE_AFTER_DAYS = 30; // ticket 1.4's window; terms move monthly

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

const staleExploits = await client.query(
  `select d.name as drug, e.title,
          e.last_verified_at,
          coalesce(date_part('day', now() - e.last_verified_at)::int, -1) as age_days
   from exploits e join drugs d on d.id = e.drug_id
   where e.status = 'active'
     and (e.last_verified_at is null
          or e.last_verified_at < now() - interval '1 day' * $1)
   order by e.last_verified_at nulls first`,
  [STALE_AFTER_DAYS],
);

const staleSources = await client.query(
  `select s.title, s.last_verified_at, s.next_review_due,
          coalesce(date_part('day', now() - s.last_verified_at)::int, -1) as age_days
   from sources s
   where (s.last_verified_at is null
          or s.last_verified_at < now() - interval '1 day' * $1
          or (s.next_review_due is not null and s.next_review_due < current_date))
   order by s.last_verified_at nulls first`,
  [STALE_AFTER_DAYS],
);

const totals = await client.query(
  `select (select count(*) from exploits where status='active')::int as active_exploits,
          (select count(*) from sources)::int as sources`,
);
await client.end();

console.log(`Staleness check (window: ${STALE_AFTER_DAYS} days)`);
console.log(`active exploits: ${totals.rows[0].active_exploits}, stale: ${staleExploits.rowCount}`);
for (const r of staleExploits.rows) {
  console.log(`  STALE exploit [${r.drug}] ${r.title.slice(0, 70)} — last_verified_at=${r.last_verified_at ?? 'NEVER'} (${r.age_days === -1 ? 'n/a' : r.age_days + 'd'})`);
}
console.log(`sources: ${totals.rows[0].sources}, stale: ${staleSources.rowCount}`);
for (const r of staleSources.rows) {
  console.log(`  STALE source ${(r.title ?? '(untitled)').slice(0, 70)} — last_verified_at=${r.last_verified_at ?? 'NEVER'} (${r.age_days === -1 ? 'n/a' : r.age_days + 'd'})${r.next_review_due ? ' next_review_due=' + r.next_review_due : ''}`);
}

const staleTotal = staleExploits.rowCount + staleSources.rowCount;
if (staleTotal > 0) {
  console.log(`\n${staleTotal} stale row(s). Stale rows must not anchor a "verified net price" claim until re-verified (ticket 1.4/1.7).`);
  process.exit(1);
}
console.log('\nAll rows inside the freshness window.');
