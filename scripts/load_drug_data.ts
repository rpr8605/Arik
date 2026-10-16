// Drug data loaders, top 200 (docs/kimi/DRUG_DATA_TOP200.md). LOCAL
// DATABASE ONLY: the demo gets this data through export_seed.mjs and the
// guarded apply_remote.mjs, never from here.
//
//   npx tsx scripts/load_drug_data.ts <step> [--n 200]
//   steps: partd | ndc | rxnorm | nadac | zips | size | all
//
// Connection: ARIK_PG* env (defaults: arik-pg on 127.0.0.1:54329). For the
// Supabase CLI stack: ARIK_PGPORT=54322 ARIK_PGDATABASE=postgres.
// Downloads go to .data/ (gitignored). Every network call has a timeout.
// Prints counts only. Parsing and matching live in lib/drugdata/parse.ts.

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  baseBrand,
  drugNameFor,
  isBrandEntry,
  latestYear,
  matchExistingDrug,
  nadacWindowStart,
  packagesFor,
  parseGazetteer,
  parseTsv,
  productsFor,
  rxcuiFrom,
  topBySpending,
  type FdaProduct,
  type PartDEntry,
} from '../lib/drugdata/parse';
import { nadacApiUrl, nadacDatasetUrl, resolveNadacDatasetId } from '../lib/pricing/adapters/nadac';

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, '.data');
mkdirSync(DATA, { recursive: true });

const PARTD_ID = '7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b';
const PARTD_API = `https://data.cms.gov/data-api/v1/dataset/${PARTD_ID}/data`;
const PARTD_PAGE = 'https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-part-d-spending-by-drug';
const FDA_NDC_ZIP = 'https://www.accessdata.fda.gov/cder/ndctext.zip';
const FDA_NDC_PAGE = 'https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory';
const RXNAV = 'https://rxnav.nlm.nih.gov/REST';
const GAZ_YEAR = 2025;
const GAZ_ZIP = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${GAZ_YEAR}_Gazetteer/${GAZ_YEAR}_Gaz_zcta_national.zip`;
const LIST_KEY = 'partd_spending';

async function get(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function download(url: string, file: string, timeoutMs = 180_000): Promise<string> {
  const res = await get(url, {}, timeoutMs);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function db(): pg.Client {
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('load_drug_data runs against a local database only');
  return new pg.Client({
    host,
    port: Number(process.env.ARIK_PGPORT ?? 54329),
    user: process.env.ARIK_PGUSER ?? 'postgres',
    password: process.env.ARIK_PGPASSWORD ?? 'postgres',
    database: process.env.ARIK_PGDATABASE ?? 'arik',
    connectionTimeoutMillis: 10_000,
    statement_timeout: 180_000,
  });
}

// One sources row per dataset release; refreshed on every load.
async function sourceRow(c: pg.Client, s: { type: string; title: string; url: string; effective?: string | null }): Promise<string> {
  const { rows } = await c.query('select id from sources where title = $1 and url = $2', [s.title, s.url]);
  if (rows.length) {
    await c.query('update sources set retrieved_at = now(), last_verified_at = now() where id = $1', [rows[0].id]);
    return rows[0].id;
  }
  const ins = await c.query(
    `insert into sources (source_type, title, url, evidence_grade, effective_date, retrieved_at, last_verified_at)
     values ($1, $2, $3, 'A', $4, now(), now()) returning id`,
    [s.type, s.title, s.url, s.effective ?? null],
  );
  return ins.rows[0].id;
}

async function review(c: pg.Client, kind: string, subject: string, detail: string, sourceId: string | null) {
  await c.query(
    `insert into drug_data_review (kind, subject, detail, source_id) values ($1, $2, $3, $4)
     on conflict (kind, subject) do update set detail = excluded.detail, resolved_at = null`,
    [kind, subject, detail, sourceId],
  );
}

async function rankedDrugs(c: pg.Client) {
  const { rows } = await c.query(
    `select r.rank, r.brand_name as brand, r.generic_name as generic, r.drug_id, r.source_id
       from drug_rank_list r
      where r.list_key = $1 and r.data_year = (select max(data_year) from drug_rank_list where list_key = $1)
      order by r.rank`,
    [LIST_KEY],
  );
  return rows as { rank: number; brand: string; generic: string; drug_id: string | null; source_id: string }[];
}

// ---------------- Step 1: the list ----------------
async function stepPartD(c: pg.Client, n: number) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 20_000; offset += 5000) {
    const page = (await (await get(`${PARTD_API}?filter%5BMftr_Name%5D=Overall&size=5000&offset=${offset}`)).json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 5000) break;
  }
  writeFileSync(join(DATA, 'partd_overall.json'), JSON.stringify(rows));
  const year = latestYear(rows[0] ?? {});
  if (!year) throw new Error('Part D: no Tot_Spndng_YYYY column');
  const top = topBySpending(rows, year, n);
  const src = await sourceRow(c, { type: 'cms_data', title: `CMS Medicare Part D Spending by Drug, data year ${year}`, url: PARTD_PAGE, effective: `${year}-12-31` });

  const { rows: drugs } = await c.query('select id, name, brand_names, generic_name from drugs');
  await c.query('begin');
  let created = 0;
  let matched = 0;
  let ambiguous = 0;
  await c.query('delete from drug_rank_list where list_key = $1 and data_year = $2', [LIST_KEY, year]);
  for (const e of top) {
    const m = matchExistingDrug(e, drugs);
    let drugId: string | null = null;
    if ('id' in m) {
      drugId = m.id;
      matched++;
      await c.query('update drugs set generic_name = coalesce(generic_name, $2) where id = $1', [drugId, e.generic]);
    } else if ('create' in m) {
      const ins = await c.query(
        `insert into drugs (name, brand_names, generic_name) values ($1, $2, $3) returning id`,
        [drugNameFor(e), isBrandEntry(e) ? [e.brand] : null, e.generic],
      );
      drugId = ins.rows[0].id;
      drugs.push({ id: drugId, name: drugNameFor(e), brand_names: isBrandEntry(e) ? [e.brand] : null, generic_name: e.generic });
      created++;
    } else {
      ambiguous++;
      await review(c, 'name_ambiguous', e.brand, `matches existing drugs: ${m.ambiguous.join(', ')}`, src);
    }
    await c.query(
      `insert into drug_rank_list (list_key, data_year, rank, brand_name, generic_name, total_spending_usd, drug_id, source_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [LIST_KEY, year, e.rank, e.brand, e.generic, e.spending, drugId, src],
    );
  }
  await c.query('commit');
  console.log(`partd: year ${year}, ${rows.length} overall rows read, top ${top.length}: ${matched} matched existing, ${created} created, ${ambiguous} to review`);
}

// ---------------- Step 2: identity ----------------
async function stepNdc(c: pg.Client) {
  const zip = await download(FDA_NDC_ZIP, join(DATA, 'ndctext.zip'));
  const dir = join(DATA, 'ndctext');
  mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { timeout: 120_000 });
  const files = readdirSync(dir);
  const productFile = files.find((f) => /^product\.txt$/i.test(f));
  const packageFile = files.find((f) => /^package\.txt$/i.test(f));
  if (!productFile || !packageFile) throw new Error('FDA zip: product.txt / package.txt not found');
  const products = parseTsv(readFileSync(join(dir, productFile), 'latin1')) as unknown as FdaProduct[];
  const packages = parseTsv(readFileSync(join(dir, packageFile), 'latin1'));
  const stamp = new Date().toISOString().slice(0, 10);
  const src = await sourceRow(c, { type: 'fda_data', title: `FDA National Drug Code Directory (ndctext.zip), downloaded ${stamp}`, url: FDA_NDC_PAGE, effective: stamp });

  const ranked = await rankedDrugs(c);
  await c.query(`delete from drug_data_review where kind in ('name_unmatched', 'ndc_unmatched')`);
  let withNdc = 0;
  let total = 0;
  let collisions = 0;
  // An NDC belongs to one drug: the higher-ranked keeps it, the other is
  // sent to review (never silently reassigned).
  const claimed = new Map<string, string>();
  await c.query('begin');
  await c.query('delete from drug_ndcs where drug_id = any($1::uuid[])', [ranked.map((r) => r.drug_id).filter(Boolean)]);
  const brandBases = new Set(ranked.filter((r) => isBrandEntry(r)).map((r) => baseBrand(r.brand)));
  for (const r of ranked) {
    if (!r.drug_id) continue;
    const prods = productsFor(r, products, isBrandEntry(r) ? new Set() : brandBases);
    const { rows: pk, unparseable } = packagesFor(prods, packages);
    for (const bad of unparseable) await review(c, 'ndc_unmatched', bad, `unparseable FDA package code for ${r.brand}`, src);
    if (pk.length === 0) {
      await review(c, 'name_unmatched', r.brand, `no FDA prescription product matched (${isBrandEntry(r) ? 'brand' : 'generic'}: ${r.generic})`, src);
      continue;
    }
    withNdc++;
    for (const n of pk) {
      const owner = claimed.get(n.ndc11);
      if (owner) {
        collisions++;
        await review(c, 'ndc_unmatched', n.ndc11, `matches ${owner} and ${r.brand}; kept for ${owner}`, src);
        continue;
      }
      claimed.set(n.ndc11, r.brand);
      await c.query(
        `insert into drug_ndcs (ndc11, drug_id, product_ndc, package_description, proprietary_name, nonproprietary_name,
           strength, dosage_form, route, labeler, marketing_category, marketing_end_date, source_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (ndc11) do update set drug_id = excluded.drug_id, package_description = excluded.package_description,
           marketing_end_date = excluded.marketing_end_date, source_id = excluded.source_id`,
        [n.ndc11, r.drug_id, n.product_ndc, n.package_description, n.proprietary_name, n.nonproprietary_name, n.strength,
         n.dosage_form, n.route, n.labeler, n.marketing_category, n.marketing_end_date, src],
      );
      total++;
    }
  }
  await c.query('commit');
  console.log(`ndc: ${products.length} FDA products, ${packages.length} packages; ${withNdc}/${ranked.length} drugs have NDCs, ${total} package NDCs stored, ${collisions} shared NDCs sent to review`);
}

async function stepRxnorm(c: pg.Client) {
  await c.query(`delete from drug_data_review where kind = 'rxnorm_unmatched'`);
  const version = (await (await get(`${RXNAV}/version.json`)).json()) as { version?: string };
  const src = await sourceRow(c, { type: 'nlm_data', title: `NLM RxNorm via RxNav API, release ${version.version ?? 'unknown'}`, url: 'https://rxnav.nlm.nih.gov/', effective: null });
  const ranked = await rankedDrugs(c);
  let ok = 0;
  for (const r of ranked) {
    if (!r.drug_id) continue;
    const name = isBrandEntry(r) ? r.brand : r.generic;
    let body: unknown = null;
    try {
      body = await (await get(`${RXNAV}/rxcui.json?name=${encodeURIComponent(name)}&search=2`, {}, 20_000)).json();
    } catch {
      await review(c, 'rxnorm_unmatched', r.brand, 'RxNav lookup failed', src);
      continue;
    }
    const m = rxcuiFrom(body);
    if ('rxcui' in m) {
      await c.query('update drugs set rxcui = $2 where id = $1', [r.drug_id, m.rxcui]);
      ok++;
    } else {
      await review(c, 'rxnorm_unmatched', r.brand, 'none' in m ? `no RxNorm concept for "${name}"` : `several concepts: ${m.ambiguous.join(', ')}`, src);
    }
    await new Promise((res) => setTimeout(res, 75)); // RxNav asks for at most 20 requests a second
  }
  console.log(`rxnorm: release ${version.version}; ${ok}/${ranked.length} drugs linked`);
}

// ---------------- Step 3: NADAC ----------------
async function stepNadac(c: pg.Client) {
  const year = new Date().getUTCFullYear();
  const id = await resolveNadacDatasetId(year);
  const api = nadacApiUrl(id);
  const post = async (body: unknown) =>
    (await (await get(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 90_000)).json()) as any;
  const latest = (await post({ limit: 1, count: false, sorts: [{ property: 'as_of_date', order: 'desc' }], properties: ['as_of_date'] })).results?.[0]?.as_of_date;
  if (!latest) throw new Error('NADAC: could not read the latest as_of_date');
  const from = nadacWindowStart(latest, 12);
  const { rows: ndcRows } = await c.query('select ndc11 from drug_ndcs order by ndc11');
  const ndcs = ndcRows.map((r: { ndc11: string }) => r.ndc11);
  // 300 NDCs per request, 4 requests at a time (each with its own timeout).
  const chunks: string[][] = [];
  for (let i = 0; i < ndcs.length; i += 300) chunks.push(ndcs.slice(i, i + 300));
  const pullChunk = async (chunk: string[]) => {
    const rows: unknown[] = [];
    for (let offset = 0; offset < 100_000; offset += 5000) {
      const page = await post({
        limit: 5000,
        offset,
        count: false,
        conditions: [
          { property: 'ndc', value: chunk, operator: 'in' },
          { property: 'as_of_date', value: from, operator: '>=' },
        ],
      });
      rows.push(...(page.results ?? []));
      if ((page.results ?? []).length < 5000) break;
    }
    return rows;
  };
  const out: unknown[] = [];
  for (let i = 0; i < chunks.length; i += 4) {
    for (const rows of await Promise.all(chunks.slice(i, i + 4).map(pullChunk))) out.push(...rows);
  }
  const file = join(DATA, 'nadac_window.json');
  writeFileSync(file, JSON.stringify(out));
  const src = await sourceRow(c, { type: 'cms_data', title: `CMS NADAC ${year} (data.medicaid.gov), as of ${latest}`, url: nadacDatasetUrl(id), effective: latest });
  console.log(`nadac: dataset ${year}, as_of ${from}..${latest}, ${ndcs.length} NDCs asked, ${out.length} weekly rows downloaded (source row ${src.slice(0, 8)})`);
  // The ingest runner does the rest (staging, normalize, NDC match, upsert, ingest_runs).
  const res = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/ingest_prices.ts', '--source', 'nadac', '--file', file], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 220_000,
    env: process.env,
  });
  console.log(res.split('\n').filter((l) => /received|accepted|rejected|upserted|staged/.test(l)).join('\n'));
}

// ---------------- Zip centroids ----------------
async function stepZips(c: pg.Client) {
  const zip = await download(GAZ_ZIP, join(DATA, `gaz_zcta_${GAZ_YEAR}.zip`));
  const dir = join(DATA, `gaz_${GAZ_YEAR}`);
  mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { timeout: 60_000 });
  const txt = readdirSync(dir).find((f) => f.endsWith('.txt'));
  if (!txt) throw new Error('gazetteer: no .txt in the zip');
  const rows = parseGazetteer(readFileSync(join(dir, txt), 'utf8'));
  const src = await sourceRow(c, {
    type: 'census_data',
    title: `US Census Bureau ${GAZ_YEAR} Gazetteer, ZIP Code Tabulation Areas (internal point)`,
    url: 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html',
    effective: `${GAZ_YEAR}-01-01`,
  });
  await c.query('begin');
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const vals: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      vals.push(`($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`);
      params.push(r.zip, r.lat, r.lng, src);
    });
    await c.query(
      `insert into zip_centroids (zip, lat, lng, source_id) values ${vals.join(',')}
       on conflict (zip) do update set lat = excluded.lat, lng = excluded.lng, source_id = excluded.source_id`,
      params,
    );
  }
  await c.query('commit');
  console.log(`zips: ${rows.length} ZCTA centroids loaded`);
}

async function stepSize(c: pg.Client) {
  const { rows } = await c.query(
    `select relname as t, pg_total_relation_size(c.oid) as bytes
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 2 desc limit 12`,
  );
  const counts = await c.query(
    `select (select count(*) from drug_rank_list) rank_rows, (select count(*) from drug_ndcs) ndcs,
            (select count(*) from price_points where price_type = 'acquisition_benchmark') nadac_rows,
            (select count(*) from zip_centroids) zips, (select count(*) from drug_data_review where resolved_at is null) review_open,
            pg_database_size(current_database()) db_bytes`,
  );
  const mb = (b: number) => `${(Number(b) / 1048576).toFixed(1)} MB`;
  for (const r of rows) console.log(`  ${r.t.padEnd(28)} ${mb(r.bytes)}`);
  const k = counts.rows[0];
  console.log(`rows: list ${k.rank_rows}, ndcs ${k.ndcs}, nadac ${k.nadac_rows}, zips ${k.zips}, review open ${k.review_open}; database ${mb(k.db_bytes)}`);
}

async function main() {
  const step = process.argv[2];
  const nArg = process.argv.indexOf('--n');
  const n = nArg > 0 ? Number(process.argv[nArg + 1]) : 200;
  const steps: Record<string, (c: pg.Client) => Promise<void>> = {
    partd: (c) => stepPartD(c, n),
    ndc: stepNdc,
    rxnorm: stepRxnorm,
    nadac: stepNadac,
    zips: stepZips,
    size: stepSize,
  };
  const run = step === 'all' ? ['partd', 'ndc', 'rxnorm', 'nadac', 'zips', 'size'] : [step];
  if (!run.every((s) => s in steps)) {
    console.error('usage: load_drug_data.ts <partd|ndc|rxnorm|nadac|zips|size|all> [--n 200]');
    process.exit(1);
  }
  const c = db();
  await c.connect();
  try {
    for (const s of run) {
      const t0 = Date.now();
      await steps[s](c);
      console.log(`  (${s}: ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error(`FAIL: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
