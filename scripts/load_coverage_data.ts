// Medicare Coverage Database weekly loader (free_data_loaders.md Part B).
// LOCAL DATABASE ONLY; the demo gets data through the reviewed export flow.
//
//   npm run ingest -- mcd
//
// Downloads the "Current LCD", "Current Article" and "NCD" CSV packages,
// builds one record per document (lib/data/coverage.ts), and replaces each
// document type's rows with the current set. One ingest_runs row (dataset
// 'mcd'). Connection: ARIK_PG* env. Downloads to .data/mcd. MCD publishes
// on Thursdays; docs/data_refresh_schedule.md has the job definition.

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../lib/data/csv';
import { buildMacDocs, buildNcdDocs, nextThursday, type PolicyDoc } from '../lib/data/coverage';

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, '.data', 'mcd');
const BASE = 'https://downloads.cms.gov/medicare-coverage-database/downloads/exports';
const PAGE = 'https://www.cms.gov/medicare-coverage-database/downloads/downloads.aspx';

async function download(url: string, file: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(timer);
  }
}

// Download a package (skipped when today's copy is already there), pull
// its inner CSV zip, return a reader for its tables.
async function pkg(name: string, skipDownload: boolean) {
  mkdirSync(DATA, { recursive: true });
  const zip = join(DATA, `${name}.zip`);
  if (!skipDownload || !existsSync(zip)) await download(`${BASE}/${name}.zip`, zip);
  const dir = join(DATA, name);
  mkdirSync(join(dir, 'csv'), { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, `${name}_csv.zip`, '-d', dir], { timeout: 120_000 });
  execFileSync('unzip', ['-o', '-q', join(dir, `${name}_csv.zip`), '-d', join(dir, 'csv')], { timeout: 120_000 });
  return (table: string) => {
    const f = join(dir, 'csv', `${table}.csv`);
    return existsSync(f) ? parseCsv(readFileSync(f, 'latin1')).rows.map((r) => r.values) : [];
  };
}

async function main() {
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('load_coverage_data runs against a local database only');
  const skip = process.argv.includes('--no-download');
  const c = new pg.Client({
    host,
    port: Number(process.env.ARIK_PGPORT ?? 54329),
    user: process.env.ARIK_PGUSER ?? 'postgres',
    password: process.env.ARIK_PGPASSWORD ?? 'postgres',
    database: process.env.ARIK_PGDATABASE ?? 'arik',
    connectionTimeoutMillis: 10_000,
    statement_timeout: 180_000,
  });
  await c.connect();
  const { rows: runRows } = await c.query(`insert into ingest_runs (dataset, status) values ('mcd', 'running') returning id`);
  const runId = runRows[0].id;
  try {
    const t0 = Date.now();
    const lcd = await pkg('current_lcd', skip);
    const art = await pkg('current_article', skip);
    const ncd = await pkg('ncd', skip);
    const shared = (r: (t: string) => Record<string, string>[]) => ({
      contractors: r('contractor'),
      contractorJurisdiction: r('contractor_jurisdiction'),
      states: r('state_lookup'),
    });
    const docs: PolicyDoc[] = [
      ...buildMacDocs('LCD', { docs: lcd('lcd'), xContractor: lcd('lcd_x_contractor'), primaryJurisdiction: lcd('lcd_x_primary_jurisdiction'), hcpc: lcd('lcd_x_hcpc_code'), ...shared(lcd) }),
      ...buildMacDocs('Article', {
        docs: art('article'),
        xContractor: art('article_x_contractor'),
        primaryJurisdiction: art('article_x_primary_jurisdiction'),
        hcpc: art('article_x_hcpc_code'),
        icd10Covered: art('article_x_icd10_covered'),
        related: art('article_related_documents'),
        ...shared(art),
      }),
      ...buildNcdDocs(ncd('ncd_trkg')),
    ];
    const today = new Date().toISOString().slice(0, 10);
    const next = nextThursday(today);
    const { rows: srcRows } = await c.query(
      `select id from sources where url = $1 and title like 'CMS Medicare Coverage Database downloads%' order by retrieved_at limit 1`,
      [PAGE],
    );
    let src = srcRows[0]?.id as string | undefined;
    if (!src) {
      src = (await c.query(
        `insert into sources (source_type, title, url, evidence_grade, retrieved_at, last_verified_at) values ('cms_data', 'CMS Medicare Coverage Database downloads: NCDs, LCDs, Articles (registry V1)', $1, 'A', now(), now()) returning id`,
        [PAGE],
      )).rows[0].id;
    } else {
      await c.query('update sources set retrieved_at = now(), last_verified_at = now() where id = $1', [src]);
    }

    await c.query('begin');
    const cols = ['doc_type', 'doc_id', 'version', 'display_id', 'title', 'status', 'is_draft', 'national', 'contractors', 'jurisdictions', 'effective_date', 'retirement_date', 'hcpcs_codes', 'icd10_codes_count', 'citation_excerpt', 'related_documents', 'source_url'] as const;
    for (let i = 0; i < docs.length; i += 200) {
      const chunk = docs.slice(i, i + 200);
      const params: unknown[] = [];
      const values = chunk.map((d) => {
        const k = params.length;
        params.push(...cols.map((col) => d[col]), today, next, src);
        return `(${[...cols, 'retrieved_date', 'next_check_date', 'source_id'].map((_, j) => `$${k + j + 1}`).join(', ')})`;
      });
      await c.query(
        `insert into policy_documents (${cols.join(', ')}, retrieved_date, next_check_date, source_id) values ${values.join(', ')}
         on conflict (doc_type, doc_id) do update set ${[...cols.filter((x) => x !== 'doc_type' && x !== 'doc_id'), 'retrieved_date', 'next_check_date', 'source_id'].map((x) => `${x} = excluded.${x}`).join(', ')}`,
        params,
      );
    }
    // The current packages ARE the current set: anything no longer in them is gone.
    for (const type of ['LCD', 'Article', 'NCD'] as const) {
      const ids = docs.filter((d) => d.doc_type === type).map((d) => d.doc_id);
      if (ids.length) await c.query('delete from policy_documents where doc_type = $1 and not (doc_id = any($2::text[]))', [type, ids]);
    }
    await c.query('commit');
    const by = (t: string) => docs.filter((d) => d.doc_type === t).length;
    const summary = { LCD: by('LCD'), Article: by('Article'), NCD: by('NCD'), drafts: docs.filter((d) => d.is_draft).length };
    await c.query(
      `update ingest_runs set status = 'ok', finished_at = now(), rows_read = $2, rows_accepted = $2, rows_upserted = $2, rows_rejected = 0, error_summary = $3 where id = $1`,
      [runId, docs.length, JSON.stringify(summary)],
    );
    console.log(`mcd: ${docs.length} documents ${JSON.stringify(summary)}, next check ${next} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    await c.query(`update ingest_runs set status = 'failed', finished_at = now(), error_summary = $2 where id = $1`, [runId, (e as Error).message.slice(0, 200)]);
    console.error(`FAIL: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
