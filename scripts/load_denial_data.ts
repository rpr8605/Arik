// Denial data loaders (docs/kimi/free_data_loaders.md Part A). LOCAL
// DATABASE ONLY; the demo gets data through the reviewed export/apply flow.
//
//   npm run ingest -- tic_puf [--year 2026]            D1: CMS Transparency in Coverage PUF
//   npm run ingest -- prior_auth --file <metrics.csv>  D2: hand-entered prior auth metrics
//
// One ingest_runs row per run (dataset = 'tic_puf' | 'prior_auth'), counts
// and reason counts only. Connection: ARIK_PG* env. Downloads to .data/.

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSharedStrings, parseSheetRows, rowsToObjects } from '../lib/data/xlsx';
import { parseCsv } from '../lib/data/csv';
import { aggregateTic, validatePriorAuthRow, TIC_SOURCE_LABEL, type TicIssuerRow } from '../lib/data/denial';

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, '.data', 'tic');

function db(): pg.Client {
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('load_denial_data runs against a local database only');
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

async function download(url: string, file: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Arik data loader' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(timer);
  }
}

async function sourceRow(c: pg.Client, s: { type: string; title: string; url: string; effective?: string | null; grade?: string }) {
  const { rows } = await c.query('select id from sources where title = $1 and url = $2', [s.title, s.url]);
  if (rows.length) {
    await c.query('update sources set retrieved_at = now(), last_verified_at = now() where id = $1', [rows[0].id]);
    return rows[0].id as string;
  }
  const ins = await c.query(
    `insert into sources (source_type, title, url, evidence_grade, effective_date, retrieved_at, last_verified_at)
     values ($1, $2, $3, $4, $5, now(), now()) returning id`,
    [s.type, s.title, s.url, s.grade ?? 'A', s.effective ?? null],
  );
  return ins.rows[0].id as string;
}

async function run(c: pg.Client, dataset: string, work: () => Promise<{ read: number; accepted: number; upserted: number; rejected: number; reasons: Record<string, number> }>) {
  const { rows } = await c.query(`insert into ingest_runs (dataset, status) values ($1, 'running') returning id`, [dataset]);
  const id = rows[0].id;
  try {
    const r = await work();
    await c.query(
      `update ingest_runs set status = 'ok', finished_at = now(), rows_read = $2, rows_accepted = $3, rows_upserted = $4, rows_rejected = $5, error_summary = $6 where id = $1`,
      [id, r.read, r.accepted, r.upserted, r.rejected, JSON.stringify(r.reasons)],
    );
    console.log(`${dataset}: read ${r.read}, accepted ${r.accepted}, upserted ${r.upserted}, rejected ${r.rejected} ${JSON.stringify(r.reasons)}`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    await c.query(`update ingest_runs set status = 'failed', finished_at = now(), error_summary = $2 where id = $1`, [id, (e as Error).message.slice(0, 200)]);
    throw e;
  }
}

const SHEETS: { match: RegExp; market: TicIssuerRow['market'] }[] = [
  { match: /Ind QHP/i, market: 'individual_qhp' },
  { match: /Ind SADP/i, market: 'individual_sadp' },
  { match: /SHOP/i, market: 'shop' },
];

async function tic(c: pg.Client, fileYear: number) {
  mkdirSync(DATA, { recursive: true });
  const url = `https://download.cms.gov/marketplace-puf/${fileYear}/transparency-in-coverage-puf.zip`;
  const zip = join(DATA, `tic_${fileYear}.zip`);
  await download(url, zip);
  const dir = join(DATA, `tic_${fileYear}`);
  mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { timeout: 60_000 });
  const xlsx = execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').find((f) => f.endsWith('.xlsx'));
  if (!xlsx) throw new Error('TiC zip: no .xlsx inside');
  const x = join(dir, 'x');
  mkdirSync(x, { recursive: true });
  execFileSync('unzip', ['-o', '-q', join(dir, xlsx), '-d', x], { timeout: 60_000 });
  const shared = parseSharedStrings(readFileSync(join(x, 'xl', 'sharedStrings.xml'), 'utf8'));
  const workbook = readFileSync(join(x, 'xl', 'workbook.xml'), 'utf8');
  const rels = readFileSync(join(x, 'xl', '_rels', 'workbook.xml.rels'), 'utf8');
  const sheets = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, name, rid]) => ({
    name,
    target: new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1],
  }));
  const planYear = fileYear - 2; // data dictionary: "PUF data always reflect data from the plan year that was two years prior"
  const src = await sourceRow(c, { type: 'cms_data', title: `${TIC_SOURCE_LABEL(planYear)} (PY${fileYear} file)`, url, effective: `${planYear}-12-31` });

  await run(c, 'tic_puf', async () => {
    let read = 0;
    let upserted = 0;
    const reasons: Record<string, number> = {};
    await c.query('begin');
    for (const sh of SHEETS) {
      const s = sheets.find((x) => sh.match.test(x.name));
      if (!s?.target) continue;
      const xml = readFileSync(join(x, 'xl', s.target.replace(/^\/?xl\//, '')), 'utf8');
      const objs = rowsToObjects(parseSheetRows(xml, shared), (r) => Object.values(r).includes('Issuer_ID'));
      read += objs.length;
      const { issuers, skipped } = aggregateTic(objs, { market: sh.market, planYear, fileYear });
      for (const k of skipped) reasons[k.reason] = (reasons[k.reason] ?? 0) + k.count;
      for (const r of issuers) {
        const cols = Object.keys(r).filter((k) => k !== 'value_flags');
        const vals = cols.map((k) => r[k]);
        await c.query(
          `insert into payer_denial_stats (${cols.join(', ')}, value_flags, source_id)
           values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}::jsonb, $${cols.length + 2})
           on conflict (market, state, issuer_id, plan_year) do update set
             ${cols.filter((k) => !['market', 'state', 'issuer_id', 'plan_year'].includes(k)).map((k) => `${k} = excluded.${k}`).join(', ')},
             value_flags = excluded.value_flags, source_id = excluded.source_id`,
          [...vals, JSON.stringify(r.value_flags), src],
        );
        upserted++;
      }
    }
    await c.query('commit');
    const rejected = Object.values(reasons).reduce((a, b) => a + b, 0);
    return { read, accepted: read - rejected, upserted, rejected, reasons };
  });
}

async function priorAuth(c: pg.Client, file: string) {
  const { rows } = parseCsv(readFileSync(file, 'utf8'));
  await run(c, 'prior_auth', async () => {
    const reasons: Record<string, number> = {};
    const errors: string[] = [];
    let upserted = 0;
    let examples = 0;
    await c.query('begin');
    for (const r of rows) {
      const v = validatePriorAuthRow(r.values, r.line);
      if ('skip' in v) {
        examples++;
        continue;
      }
      if ('error' in v) {
        errors.push(v.error);
        const key = v.error.replace(/^line \d+: /, '');
        reasons[key] = (reasons[key] ?? 0) + 1;
        continue;
      }
      const row = v.row;
      const src = await sourceRow(c, {
        type: 'payer_report',
        title: `Prior authorization metrics posted by ${row.payer}, report year ${row.report_year}`,
        url: String(row.source_url),
        effective: `${row.report_year}-12-31`,
      });
      const cols = Object.keys(row);
      await c.query(
        `insert into prior_auth_metrics (${cols.join(', ')}, source_id) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
         on conflict (payer, program, reporting_level, reporting_unit, state, report_year) do update set
           ${cols.filter((k) => !['payer', 'program', 'reporting_level', 'reporting_unit', 'state', 'report_year'].includes(k)).map((k) => `${k} = excluded.${k}`).join(', ')},
           source_id = excluded.source_id`,
        [...cols.map((k) => row[k]), src],
      );
      upserted++;
    }
    await c.query('commit');
    for (const e of errors) console.log(`  rejected ${e}`);
    if (examples) reasons['EXAMPLE row skipped'] = examples;
    return { read: rows.length, accepted: upserted, upserted, rejected: errors.length, reasons };
  });
}

async function main() {
  const [what] = process.argv.slice(2);
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const c = db();
  await c.connect();
  try {
    if (what === 'tic_puf') await tic(c, Number(arg('--year') ?? 2026));
    else if (what === 'prior_auth') {
      const f = arg('--file');
      if (!f) throw new Error('prior_auth needs --file <metrics.csv>');
      await priorAuth(c, f);
    } else throw new Error('usage: load_denial_data.ts tic_puf [--year 2026] | prior_auth --file <csv>');
  } catch (e) {
    console.error(`FAIL: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
