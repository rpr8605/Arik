// Ingest runner (build ticket 2026-10-01): pulls one pricing source
// through its adapter, stages the raw payload in raw_price_ingest,
// normalizes (rejections are logged, never silent), resolves drugs, and
// upserts price_points on the db/022 natural key - re-running the same
// input creates no duplicates.
//
// Usage:
//   npx tsx scripts/ingest_prices.ts --source nadac [--file path.json] [--dry-run]
//
// Connection: ARIK_PG* env (defaults = the local arik-pg dev container,
//   127.0.0.1:54329 db arik). NEVER reads the remote SUPABASE_DB_* vars:
//   ingestion against anything but an explicitly-targeted database is a
//   mistake this script refuses to make.
//
// Exit codes: 0 ok (incl. source-disabled skip), 1 operational failure.
//
// Every run writes one ingest_runs row (db/025, M06-AC6): counts and a
// reason -> count map only, never prices or payloads. A record carrying a
// pharmacy NPI is matched to the pharmacies table (M06-AC3); an NPI that
// isn't there is a reject, never a guessed pharmacy.

import pg from 'pg';
import { ADAPTER_FACTORIES } from '../lib/pricing/adapters/index';
import type { NormalizedPrice, RejectedRecord } from '../lib/pricing/adapter';

interface Args {
  source: string | null;
  file?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { source: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

// Drug resolution: exact name, brand_names alias, or "name is the leading
// token(s) of the source string" ('Apixaban' matches 'APIXABAN 5 MG
// TABLET'). Longest source-prefix match wins; a tie on distinct drugs is
// an ambiguity REJECT, never a coin flip. No match is a reject with the
// drug named - unknown drugs are never invented.
function matchDrug(
  drugName: string,
  drugs: { id: string; name: string; brand_names: string[] | null }[],
): { id: string; name: string } | { error: string } {
  const want = drugName.trim().toLowerCase();
  const exact = drugs.filter(
    (d) =>
      d.name.toLowerCase() === want ||
      (d.brand_names ?? []).some((b) => b.toLowerCase() === want),
  );
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };
  if (exact.length > 1) return { error: `drug match ambiguous (exact): ${drugName}` };

  const prefixed = drugs
    .flatMap((d) =>
      [d.name, ...(d.brand_names ?? [])].map((alias) => ({
        id: d.id,
        name: d.name,
        alias: alias.toLowerCase(),
      })),
    )
    .filter((c) => want === c.alias || want.startsWith(`${c.alias} `))
    .sort((a, b) => b.alias.length - a.alias.length);
  if (prefixed.length === 0) return { error: `unknown drug: ${drugName}` };
  const best = prefixed.filter((p) => p.alias.length === prefixed[0].alias.length);
  const distinctDrugs = new Set(best.map((p) => p.id));
  if (distinctDrugs.size > 1) return { error: `drug match ambiguous: ${drugName}` };
  return { id: best[0].id, name: best[0].name };
}

const STAGING_CHUNK = 500;

async function main() {
  const args = parseArgs(process.argv);
  if (!args.source) {
    console.error('usage: npx tsx scripts/ingest_prices.ts --source <id> [--file path] [--dry-run]');
    process.exit(1);
  }
  const factory = ADAPTER_FACTORIES[args.source];
  if (!factory) {
    console.error(`no adapter registered for source '${args.source}' (lib/pricing/adapters/index.ts)`);
    process.exit(1);
  }

  const client = new pg.Client({
    host: process.env.ARIK_PGHOST ?? '127.0.0.1',
    port: Number(process.env.ARIK_PGPORT ?? 54329),
    user: process.env.ARIK_PGUSER ?? 'postgres',
    password: process.env.ARIK_PGPASSWORD ?? 'postgres',
    database: process.env.ARIK_PGDATABASE ?? 'arik',
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  await client.connect();

  const { rows: sources } = await client.query(
    'select id, name, enabled from price_sources where name = $1',
    [args.source],
  );
  if (sources.length === 0) {
    console.error(`price_sources has no row named '${args.source}' (register it in a migration first)`);
    await client.end();
    process.exit(1);
  }
  const source = sources[0];
  const { rows: runRows } = await client.query(
    `insert into ingest_runs (source_id, status) values ($1, $2) returning id`,
    [source.id, source.enabled ? 'running' : 'skipped_disabled'],
  );
  const runId = runRows[0].id as string;
  const finishRun = (status: string, counts: Record<string, number | null>, summary: Record<string, number> | string | null) =>
    client.query(
      `update ingest_runs set status = $2, finished_at = now(), rows_read = $3, rows_accepted = $4,
         rows_upserted = $5, rows_rejected = $6, error_summary = $7 where id = $1`,
      [runId, status, counts.read ?? null, counts.accepted ?? null, counts.upserted ?? null, counts.rejected ?? null,
       summary == null ? null : typeof summary === 'string' ? summary : JSON.stringify(summary)],
    );
  if (!source.enabled) {
    await finishRun('skipped_disabled', {}, null);
    console.log(`SKIP: source '${args.source}' is disabled in price_sources.`);
    await client.end();
    process.exit(0);
  }

  const adapter = factory(source.id);
  let raw: unknown[];
  try {
    raw = await adapter.fetch(args.file ? { file: args.file } : {});
  } catch (e) {
    // The kind of failure only: an adapter error could name an endpoint.
    await finishRun('failed', {}, `fetch failed: ${(e as Error).name}`);
    await client.end();
    throw new Error('fetch failed');
  }
  const { rows: pharmacyRows } = await client.query('select id, npi from pharmacies where npi is not null');
  const pharmacyByNpi = new Map<string, string>(pharmacyRows.map((r: { id: string; npi: string }) => [r.npi, r.id]));

  // Per-record pipeline: normalize each record individually so every
  // staging row's final status maps to exactly one raw payload (batch
  // normalize + reference matching would mislabel runner-level rejects).
  const { rows: drugs } = await client.query('select id, name, brand_names from drugs');
  interface Disposition {
    staging: 'upserted' | 'rejected';
    reason?: string;
    row?: NormalizedPrice & { drug_id: string; pharmacy_id: string | null };
  }
  const dispositions: Disposition[] = [];
  const upsertable: (NormalizedPrice & { drug_id: string; pharmacy_id: string | null })[] = [];
  const runnerRejects: RejectedRecord[] = [];
  let acceptedCount = 0;
  for (const record of raw) {
    const { accepted, rejected } = adapter.normalize([record]);
    if (rejected.length > 0) {
      runnerRejects.push(rejected[0]);
      dispositions.push({ staging: 'rejected', reason: rejected[0].reason });
      continue;
    }
    acceptedCount++;
    const row = accepted[0];
    const match = matchDrug(row.drug_name, drugs);
    const pharmacyId = row.pharmacy_npi ? pharmacyByNpi.get(row.pharmacy_npi) ?? null : null;
    if ('error' in match) {
      runnerRejects.push({ reason: match.error, raw: record });
      dispositions.push({ staging: 'rejected', reason: match.error });
    } else if (row.pharmacy_npi && !pharmacyId) {
      const reason = 'unknown pharmacy npi';
      runnerRejects.push({ reason, raw: record });
      dispositions.push({ staging: 'rejected', reason });
    } else {
      const withDrug = { ...row, drug_id: match.id, pharmacy_id: pharmacyId };
      upsertable.push(withDrug);
      dispositions.push({ staging: 'upserted', row: withDrug });
    }
  }

  const reasonCounts = new Map<string, number>();
  for (const r of runnerRejects) {
    const key = r.reason.replace(/:.*$/, '');
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }

  console.log(`source:        ${args.source} (${source.id})`);
  console.log(`received:      ${raw.length}`);
  console.log(`accepted:      ${acceptedCount}`);
  console.log(`rejected:      ${runnerRejects.length}`);
  for (const [reason, n] of [...reasonCounts.entries()].sort()) {
    console.log(`  - ${reason}: ${n}`);
  }
  console.log(`upsertable:    ${upsertable.length}`);

  const reasonSummary = Object.fromEntries(reasonCounts);
  if (args.dryRun) {
    await finishRun('dry_run', { read: raw.length, accepted: acceptedCount, upserted: 0, rejected: runnerRejects.length }, reasonSummary);
    console.log('\nDRY RUN - nothing written.');
    await client.end();
    process.exit(0);
  }

  await client.query('begin');
  try {
    // 1. Stage every raw record first (status 'received') so the payload
    //    survives even a mid-run crash.
    const stagingIds: string[] = [];
    for (let i = 0; i < raw.length; i += STAGING_CHUNK) {
      const chunk = raw.slice(i, i + STAGING_CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((payload, j) => {
        const k = params.length;
        values.push(`($${k + 1}, $${k + 2}::jsonb, 'received')`);
        params.push(source.id, JSON.stringify(payload ?? null));
        void j;
      });
      const { rows } = await client.query(
        `insert into raw_price_ingest (source_id, payload, status) values ${values.join(', ')} returning id`,
        params,
      );
      stagingIds.push(...rows.map((r: { id: string }) => r.id));
    }

    // 2. Upsert accepted rows on the db/022 natural key. dose stays NULL:
    //    strength lives inside drug_name today and parsing it out is a
    //    guessing game this runner deliberately does not play.
    let upserted = 0;
    for (const row of upsertable) {
      await client.query(
        `insert into price_points
           (drug_id, price_type, supply_days, unit_count, price_usd,
            price_source_id, ndc, observed_at, expires_at, pharmacy_id)
         values ($1, $2, null, $3, $4, $5, $6, $7, $8, $9)
         on conflict (price_source_id, drug_id, price_type, ndc, supply_days, unit_count, observed_at, pharmacy_id)
         do update set price_usd = excluded.price_usd,
                       expires_at = excluded.expires_at`,
        [row.drug_id, row.price_type, row.quantity, row.price, row.source_id, row.ndc, row.observed_at, row.expires_at, row.pharmacy_id],
      );
      upserted++;
    }

    // 3. Final staging statuses, one per raw record, with the reject
    //    reason preserved where there is one.
    for (let i = 0; i < raw.length; i++) {
      const d = dispositions[i];
      await client.query(
        `update raw_price_ingest set status = $2, error = $3 where id = $1`,
        [stagingIds[i], d.staging, d.reason ?? null],
      );
    }

    await client.query('commit');
    await finishRun('ok', { read: raw.length, accepted: acceptedCount, upserted, rejected: runnerRejects.length }, reasonSummary);
    console.log(`upserted:      ${upserted}`);
    console.log(`staged:        ${stagingIds.length} raw rows (${runnerRejects.length} rejected with reasons)`);
  } catch (e) {
    await client.query('rollback');
    await finishRun('failed', { read: raw.length, accepted: acceptedCount, rejected: runnerRejects.length }, `write failed: ${(e as Error).name}`).catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
