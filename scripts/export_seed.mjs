// Export the verified local drug data as ONE idempotent SQL file for the
// demo database (docs/kimi/DRUG_DATA_TOP200.md Step 6). Reads the local
// database only. Nothing here touches a remote: scripts/apply_remote.mjs
// applies the file, dry run first, then --confirm.
//
//   node scripts/export_seed.mjs [--out .data/export/arik_drug_data.sql]
//
// Local and remote row ids differ, so every row merges by its natural key:
// sources (title, url), drugs (name, case-insensitive), drug_rank_list
// (list, year, rank), drug_ndcs (ndc11), NADAC price_points (the db/031
// natural key), zip_centroids (zip). Raw staging rows are NOT exported.
// Connection: ARIK_PG* env (same defaults as the loaders).

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : '.data/export/arik_drug_data.sql';

const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('export_seed reads a local database only');
const c = new pg.Client({
  host,
  port: Number(process.env.ARIK_PGPORT ?? 54329),
  user: process.env.ARIK_PGUSER ?? 'postgres',
  password: process.env.ARIK_PGPASSWORD ?? 'postgres',
  database: process.env.ARIK_PGDATABASE ?? 'arik',
  connectionTimeoutMillis: 10000,
  statement_timeout: 120000,
});

function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) return v.length ? `array[${v.map(lit).join(',')}]::text[]` : `'{}'::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Multi-row VALUES into a temp table, 1000 rows a statement.
function load(table, cols, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => `(${cols.map((k) => lit(r[k])).join(',')})`);
    out.push(`insert into ${table} (${cols.join(',')}) values\n${chunk.join(',\n')};`);
  }
  return out.join('\n');
}

await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;

const ranked = await q(
  `select r.list_key, r.data_year, r.rank, r.brand_name, r.generic_name, r.total_spending_usd,
          d.name as drug_name, s.title as src_title, s.url as src_url
     from drug_rank_list r join drugs d on d.id = r.drug_id left join sources s on s.id = r.source_id
    order by r.data_year, r.rank`,
);
const drugs = await q(
  `select distinct d.name, d.brand_names, d.generic_name, d.rxcui, d.drug_class, d.generic_available
     from drugs d join drug_rank_list r on r.drug_id = d.id`,
);
const sourceRows = await q(
  `select distinct s.source_type, s.title, s.url, s.evidence_grade, s.effective_date::text, s.retrieved_at, s.last_verified_at
     from sources s
    where s.id in (select source_id from drug_rank_list union select source_id from drug_ndcs
                   union select source_id from zip_centroids)
       or (s.source_type = 'cms_data' and s.title like 'CMS NADAC %')`,
);
const ndcs = await q(
  `select n.ndc11, d.name as drug_name, n.product_ndc, n.package_description, n.proprietary_name, n.nonproprietary_name,
          n.strength, n.dosage_form, n.route, n.labeler, n.marketing_category, n.marketing_end_date::text, n.rxcui,
          s.title as src_title, s.url as src_url
     from drug_ndcs n join drugs d on d.id = n.drug_id left join sources s on s.id = n.source_id`,
);
const nadac = await q(
  `select d.name as drug_name, p.price_type, p.unit_count, p.price_usd, p.ndc, p.observed_at::text, p.expires_at::text,
          p.pricing_unit, p.as_of_date::text, p.rate_class
     from price_points p join drugs d on d.id = p.drug_id join price_sources ps on ps.id = p.price_source_id
    where ps.name = 'nadac' and p.pharmacy_id is null`,
);
const zips = await q(`select z.zip, z.lat, z.lng, s.title as src_title, s.url as src_url from zip_centroids z left join sources s on s.id = z.source_id`);
await c.end();

const sql = `-- Arik drug data export (scripts/export_seed.mjs), ${new Date().toISOString()}
-- Rows: ${ranked.length} ranked, ${drugs.length} drugs, ${ndcs.length} NDCs, ${nadac.length} NADAC prices, ${zips.length} zip centroids, ${sourceRows.length} sources.
-- Needs db/031, db/032 (and db/033 for Imbruvica) applied first. Idempotent.

create temp table x_sources (source_type text, title text, url text, evidence_grade text, effective_date date, retrieved_at timestamptz, last_verified_at timestamptz) on commit drop;
${load('x_sources', ['source_type', 'title', 'url', 'evidence_grade', 'effective_date', 'retrieved_at', 'last_verified_at'], sourceRows)}
insert into sources (source_type, title, url, evidence_grade, effective_date, retrieved_at, last_verified_at)
select x.* from x_sources x where not exists (select 1 from sources s where s.title = x.title and s.url is not distinct from x.url);
update sources s set retrieved_at = x.retrieved_at, last_verified_at = x.last_verified_at
  from x_sources x where s.title = x.title and s.url is not distinct from x.url;

create temp table x_drugs (name text, brand_names text[], generic_name text, rxcui text, drug_class text, generic_available boolean) on commit drop;
${load('x_drugs', ['name', 'brand_names', 'generic_name', 'rxcui', 'drug_class', 'generic_available'], drugs)}
insert into drugs (name, brand_names, generic_name, rxcui, drug_class, generic_available)
select x.* from x_drugs x where not exists (select 1 from drugs d where lower(d.name) = lower(x.name));
update drugs d set generic_name = coalesce(d.generic_name, x.generic_name), rxcui = coalesce(x.rxcui, d.rxcui),
                   brand_names = coalesce(d.brand_names, x.brand_names)
  from x_drugs x where lower(d.name) = lower(x.name);

create temp table x_rank (list_key text, data_year int, rank int, brand_name text, generic_name text, total_spending_usd numeric, drug_name text, src_title text, src_url text) on commit drop;
${load('x_rank', ['list_key', 'data_year', 'rank', 'brand_name', 'generic_name', 'total_spending_usd', 'drug_name', 'src_title', 'src_url'], ranked)}
insert into drug_rank_list (list_key, data_year, rank, brand_name, generic_name, total_spending_usd, drug_id, source_id)
select x.list_key, x.data_year, x.rank, x.brand_name, x.generic_name, x.total_spending_usd,
       (select id from drugs d where lower(d.name) = lower(x.drug_name) order by created_at limit 1),
       (select id from sources s where s.title = x.src_title and s.url is not distinct from x.src_url order by retrieved_at limit 1)
  from x_rank x
on conflict (list_key, data_year, rank) do update set brand_name = excluded.brand_name, generic_name = excluded.generic_name,
  total_spending_usd = excluded.total_spending_usd, drug_id = excluded.drug_id, source_id = excluded.source_id;

create temp table x_ndcs (ndc11 text, drug_name text, product_ndc text, package_description text, proprietary_name text, nonproprietary_name text, strength text, dosage_form text, route text, labeler text, marketing_category text, marketing_end_date date, rxcui text, src_title text, src_url text) on commit drop;
${load('x_ndcs', ['ndc11', 'drug_name', 'product_ndc', 'package_description', 'proprietary_name', 'nonproprietary_name', 'strength', 'dosage_form', 'route', 'labeler', 'marketing_category', 'marketing_end_date', 'rxcui', 'src_title', 'src_url'], ndcs)}
insert into drug_ndcs (ndc11, drug_id, product_ndc, package_description, proprietary_name, nonproprietary_name, strength, dosage_form, route, labeler, marketing_category, marketing_end_date, rxcui, source_id)
select x.ndc11, d.id, x.product_ndc, x.package_description, x.proprietary_name, x.nonproprietary_name, x.strength, x.dosage_form, x.route, x.labeler,
       x.marketing_category, x.marketing_end_date, x.rxcui,
       (select id from sources s where s.title = x.src_title and s.url is not distinct from x.src_url order by retrieved_at limit 1)
  from x_ndcs x join lateral (select id from drugs d where lower(d.name) = lower(x.drug_name) order by created_at limit 1) d on true
on conflict (ndc11) do update set drug_id = excluded.drug_id, package_description = excluded.package_description,
  marketing_end_date = excluded.marketing_end_date, source_id = excluded.source_id;

create temp table x_nadac (drug_name text, price_type text, unit_count numeric, price_usd numeric, ndc text, observed_at date, expires_at date, pricing_unit text, as_of_date date, rate_class text) on commit drop;
${load('x_nadac', ['drug_name', 'price_type', 'unit_count', 'price_usd', 'ndc', 'observed_at', 'expires_at', 'pricing_unit', 'as_of_date', 'rate_class'], nadac)}
insert into price_points (drug_id, price_type, supply_days, unit_count, price_usd, price_source_id, ndc, observed_at, expires_at, pharmacy_id, pricing_unit, as_of_date, rate_class)
select d.id, x.price_type, null, x.unit_count, x.price_usd, (select id from price_sources where name = 'nadac'), x.ndc, x.observed_at, x.expires_at, null,
       x.pricing_unit, x.as_of_date, x.rate_class
  from x_nadac x join lateral (select id from drugs d where lower(d.name) = lower(x.drug_name) order by created_at limit 1) d on true
on conflict (price_source_id, drug_id, price_type, ndc, supply_days, unit_count, observed_at, pharmacy_id)
do update set price_usd = excluded.price_usd, pricing_unit = excluded.pricing_unit, rate_class = excluded.rate_class,
              as_of_date = greatest(price_points.as_of_date, excluded.as_of_date);

create temp table x_zips (zip text, lat double precision, lng double precision, src_title text, src_url text) on commit drop;
${load('x_zips', ['zip', 'lat', 'lng', 'src_title', 'src_url'], zips)}
insert into zip_centroids (zip, lat, lng, source_id)
select x.zip, x.lat, x.lng, (select id from sources s where s.title = x.src_title and s.url is not distinct from x.src_url order by retrieved_at limit 1)
  from x_zips x
on conflict (zip) do update set lat = excluded.lat, lng = excluded.lng, source_id = excluded.source_id;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sql);
console.log(`export: ${ranked.length} ranked, ${drugs.length} drugs, ${ndcs.length} NDCs, ${nadac.length} NADAC prices, ${zips.length} zips, ${sourceRows.length} sources -> ${OUT} (${(statSync(OUT).size / 1048576).toFixed(1)} MB)`);
