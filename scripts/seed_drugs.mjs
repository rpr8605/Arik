// Seeds drugs + price_points from seed_drugs.json, creating the sources
// rows the figures hang off of (nothing ships without a source).
// Targets a database with an EMPTY drugs table; bails otherwise.
// Usage: node scripts/seed_drugs.mjs   (reads .env.local)
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
const seed = JSON.parse(readFileSync(new URL('../seed_drugs.json', import.meta.url), 'utf8'));

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

const { rows } = await client.query('select count(*)::int as n from drugs');
if (rows[0].n > 0) {
  console.error(`REFUSING TO RUN: drugs table already has ${rows[0].n} row(s). Seed targets an empty table.`);
  await client.end();
  process.exit(1);
}

await client.query('begin');
try {
  // Source for negotiated prices: CMS's own negotiation program (Grade A).
  const { rows: [cms] } = await client.query(
    `insert into sources (source_type, title, url, evidence_grade, effective_date)
     values ('cms_data',
             'CMS Medicare Drug Price Negotiation Program - negotiated maximum fair prices, first cycle (effective 2026)',
             'https://www.cms.gov/inflation-reduction-act-and-medicare/medicare-drug-price-negotiation',
             'A', '2026-01-01')
     returning id`,
  );
  // Source for 2023 list prices: compiled in the seed file from 2026
  // reporting; honestly graded unverified until checked per-drug.
  const { rows: [listSrc] } = await client.query(
    `insert into sources (source_type, title, evidence_grade)
     values ('news',
             '2023 30-day list prices as compiled in seed_drugs.json from 2026 reporting (point-in-time; verify per-drug before production reliance)',
             'unverified')
     returning id`,
  );

  let drugCount = 0;
  let priceCount = 0;
  for (const d of seed.ira_negotiated_2026) {
    const { rows: [drug] } = await client.query(
      `insert into drugs (name, drug_class, generic_available) values ($1, $2, false) returning id`,
      [d.name, d.drug_class],
    );
    drugCount++;
    await client.query(
      `insert into price_points (drug_id, price_type, supply_days, price_usd, effective_date, source_id)
       values ($1, 'list', 30, $2, '2023-01-01', $3)`,
      [drug.id, d.list_price_2023_30day, listSrc.id],
    );
    await client.query(
      `insert into price_points (drug_id, price_type, supply_days, price_usd, effective_date, source_id)
       values ($1, 'ira_negotiated', 30, $2, '2026-01-01', $3)`,
      [drug.id, d.negotiated_price_2026_30day, cms.id],
    );
    priceCount += 2;
  }
  for (const g of seed.high_volume_generics_watchlist) {
    await client.query(
      `insert into drugs (name, brand_names, drug_class, generic_available) values ($1, $2, $3, true)`,
      [g.name, g.brand ? [g.brand] : null, g.drug_class],
    );
    drugCount++;
  }

  await client.query('commit');
  console.log(`seeded ${drugCount} drugs (${seed.ira_negotiated_2026.length} IRA-negotiated, ${seed.high_volume_generics_watchlist.length} generics) and ${priceCount} price points, with 2 sources rows`);
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  await client.end();
}
