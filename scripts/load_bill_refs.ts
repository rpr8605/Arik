// Medicare reference data for the bill checks (db/039). LOCAL DATABASE
// ONLY; the demo gets a trimmed set through the reviewed export flow.
//
//   npm run ingest -- bill_refs [--no-download] [--ptp-dir <folder>]
//
// Downloads the quarterly MUE tables (practitioner, outpatient hospital)
// and the Physician Fee Schedule RVU file into .data/ncci, parses them
// (lib/rules/bills/refs.ts: numbers only, no CPT descriptions) and
// replaces each table's rows. Procedure-to-procedure pairs are behind the
// AMA license page on cms.gov, so they are never downloaded here: once the
// owner has accepted that license and saved the unzipped .txt files,
// --ptp-dir loads them (file names containing "practitioner"/"ccipra" or
// "hospital"/"ccioph" pick the setting). One ingest_runs row ('bill_refs').
// Each quarter: update the three URLs below (see docs/data_refresh_schedule.md).

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMueCsv, parsePfsCsv, parsePtpTxt } from '../lib/rules/bills/refs';

const ROOT = join(__dirname, '..');
const DATA = join(ROOT, '.data', 'ncci');
const CMS = 'https://www.cms.gov';
const MUE_PAGE = `${CMS}/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits`;
const PTP_PAGE = `${CMS}/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits`;
const PFS_PAGE = `${CMS}/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu26d`;
const FILES = {
  mue_practitioner: { zip: 'medicare-ncci-2026-q4-practitioner-services-mue-table', csv: 'MCR_MUE_PractitionerServices_Eff_10-01-2026.csv', version: 'mue-2026q4-practitioner', effective: '2026-10-01', page: MUE_PAGE },
  mue_outpatient_hospital: { zip: 'medicare-ncci-2026-q4-facility-outpatient-hospital-services-mue-table', csv: 'MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv', version: 'mue-2026q4-outpatient-hospital', effective: '2026-10-01', page: MUE_PAGE },
  pfs: { zip: 'rvu26d-updated-08-26-2026', csv: 'PPRRVU2026_Oct_nonQPP.csv', version: 'pfs-rvu26d', effective: '2026-10-01', page: PFS_PAGE },
} as const;

async function download(url: string, file: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 (Arik data loader)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(timer);
  }
}

async function fileText(key: keyof typeof FILES, skip: boolean) {
  const f = FILES[key];
  mkdirSync(DATA, { recursive: true });
  const zip = join(DATA, `${f.zip}.zip`);
  if (!skip || !existsSync(zip)) await download(`${CMS}/files/zip/${f.zip}.zip`, zip);
  const dir = join(DATA, f.zip);
  execFileSync('unzip', ['-o', '-q', zip, f.csv, '-d', dir], { timeout: 120_000 });
  return { text: readFileSync(join(dir, f.csv), 'latin1'), url: `${CMS}/files/zip/${f.zip}.zip` };
}

async function insertRows(c: pg.Client, table: string, cols: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const params: unknown[] = [];
    const values = chunk.map((r) => {
      const k = params.length;
      params.push(...r);
      return `(${r.map((_, j) => `$${k + j + 1}`).join(', ')})`;
    });
    await c.query(`insert into ${table} (${cols.join(', ')}) values ${values.join(', ')}`, params);
  }
}

async function main() {
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('load_bill_refs runs against a local database only');
  const skip = process.argv.includes('--no-download');
  const pi = process.argv.indexOf('--ptp-dir');
  const ptpDir = pi > 0 ? process.argv[pi + 1] : null;
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
  const runId = (await c.query(`insert into ingest_runs (dataset, status) values ('bill_refs', 'running') returning id`)).rows[0].id;
  try {
    const t0 = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const source = async (title: string, url: string) => {
      const found = (await c.query('select id from sources where url = $1 and title = $2 limit 1', [url, title])).rows[0]?.id as string | undefined;
      if (found) {
        await c.query('update sources set retrieved_at = now(), last_verified_at = now() where id = $1', [found]);
        return found;
      }
      return (await c.query(`insert into sources (source_type, title, url, evidence_grade, retrieved_at, last_verified_at) values ('cms_data', $1, $2, 'A', now(), now()) returning id`, [title, url])).rows[0].id as string;
    };
    const summary: Record<string, number> = {};
    let rejected = 0;

    const mue = {
      practitioner: parseMueCsv((await fileText('mue_practitioner', skip)).text),
      outpatient_hospital: parseMueCsv((await fileText('mue_outpatient_hospital', skip)).text),
    };
    const pfs = parsePfsCsv((await fileText('pfs', skip)).text);
    const ptp: Record<'practitioner' | 'outpatient_hospital', ReturnType<typeof parsePtpTxt>['pairs']> = { practitioner: [], outpatient_hospital: [] };
    if (ptpDir) {
      for (const f of readdirSync(ptpDir).filter((x) => x.toLowerCase().endsWith('.txt'))) {
        const setting = /practitioner|ccipra/i.test(f) ? 'practitioner' : /hospital|ccioph/i.test(f) ? 'outpatient_hospital' : null;
        if (!setting) throw new Error(`--ptp-dir: cannot tell the setting of ${f}`);
        const p = parsePtpTxt(readFileSync(join(ptpDir, f), 'latin1'));
        ptp[setting].push(...p.pairs);
        rejected += p.rejects;
      }
    }

    await c.query('begin');
    for (const setting of ['practitioner', 'outpatient_hospital'] as const) {
      const key = `mue_${setting}` as const;
      const m = mue[setting];
      rejected += m.rejects;
      await c.query('delete from bill_ref_mue where setting = $1', [setting]);
      const rows = Object.entries(m.byCode).map(([code, r]) => [setting, code, r.limit, r.mai]);
      await insertRows(c, 'bill_ref_mue', ['setting', 'code', 'unit_limit', 'adjudication'], rows);
      const src = await source(`CMS NCCI Medically Unlikely Edits, ${setting.replace('_', ' ')} (${FILES[key].version})`, MUE_PAGE);
      await c.query(
        `insert into bill_ref_datasets (name, version, source_url, effective_date, retrieved_date, row_count, source_id) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (name) do update set version = excluded.version, source_url = excluded.source_url, effective_date = excluded.effective_date, retrieved_date = excluded.retrieved_date, row_count = excluded.row_count, source_id = excluded.source_id`,
        [key, FILES[key].version, `${CMS}/files/zip/${FILES[key].zip}.zip`, FILES[key].effective, today, rows.length, src],
      );
      summary[key] = rows.length;
    }
    rejected += pfs.rejects;
    await c.query('delete from bill_ref_pfs');
    const pfsRows = Object.entries(pfs.byCode).map(([code, r]) => [code, r.facilityUsd, r.nonFacilityUsd]);
    await insertRows(c, 'bill_ref_pfs', ['code', 'facility_usd', 'non_facility_usd'], pfsRows);
    const pfsSrc = await source(`CMS Physician Fee Schedule relative value file RVU26D (conversion factor ${pfs.conversionFactor})`, PFS_PAGE);
    await c.query(
      `insert into bill_ref_datasets (name, version, source_url, effective_date, retrieved_date, row_count, source_id) values ('pfs', $1, $2, $3, $4, $5, $6)
       on conflict (name) do update set version = excluded.version, source_url = excluded.source_url, effective_date = excluded.effective_date, retrieved_date = excluded.retrieved_date, row_count = excluded.row_count, source_id = excluded.source_id`,
      [FILES.pfs.version, `${CMS}/files/zip/${FILES.pfs.zip}.zip`, FILES.pfs.effective, today, pfsRows.length, pfsSrc],
    );
    summary.pfs = pfsRows.length;
    if (ptpDir) {
      for (const setting of ['practitioner', 'outpatient_hospital'] as const) {
        if (!ptp[setting].length) continue;
        await c.query('delete from bill_ref_ptp where setting = $1', [setting]);
        // The files repeat a pair across effective periods; the key keeps each period once.
        const seen = new Set<string>();
        const rows = ptp[setting].filter((p) => {
          const k = `${p.col1}|${p.col2}|${p.effective}`;
          return !seen.has(k) && seen.add(k);
        }).map((p) => [setting, p.col1, p.col2, p.modifier, p.effective, p.deleted]);
        await insertRows(c, 'bill_ref_ptp', ['setting', 'col1', 'col2', 'modifier', 'effective_date', 'deletion_date'], rows);
        const name = `ptp_${setting}`;
        const src = await source(`CMS NCCI procedure-to-procedure edits, ${setting.replace('_', ' ')} (owner-supplied files)`, PTP_PAGE);
        await c.query(
          `insert into bill_ref_datasets (name, version, source_url, retrieved_date, row_count, source_id) values ($1, $2, $3, $4, $5, $6)
           on conflict (name) do update set version = excluded.version, retrieved_date = excluded.retrieved_date, row_count = excluded.row_count, source_id = excluded.source_id`,
          [name, `ptp-${setting}-${today}`, PTP_PAGE, today, rows.length, src],
        );
        summary[name] = rows.length;
      }
    }
    await c.query('commit');
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    await c.query(
      `update ingest_runs set status = 'ok', finished_at = now(), rows_read = $2, rows_accepted = $2, rows_upserted = $2, rows_rejected = $3, error_summary = $4 where id = $1`,
      [runId, total, rejected, JSON.stringify(summary)],
    );
    console.log(`bill_refs: ${JSON.stringify(summary)}, rejected ${rejected}${ptpDir ? '' : ', pairs not loaded (AMA license pending)'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
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
