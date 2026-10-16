// Kill switch and purge for a price source (M07-AC5).
//
//   npm run source:disable -- <name>
//   npm run source:enable -- <name>
//   npm run source:purge -- <name>
//
// Local database only (ARIK_PG* env, same defaults as the ingest runner).
// One transaction; one source_admin_events row with counts only.

import pg from 'pg';
import { auditStatement, parseAdminArgs, planAdminAction } from '../lib/pricing/sourceAdmin';

async function main() {
  const parsed = parseAdminArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) {
    console.error('source_admin runs against a local database only');
    process.exit(1);
  }
  const client = new pg.Client({
    host,
    port: Number(process.env.ARIK_PGPORT ?? 54329),
    user: process.env.ARIK_PGUSER ?? 'postgres',
    password: process.env.ARIK_PGPASSWORD ?? 'postgres',
    database: process.env.ARIK_PGDATABASE ?? 'arik',
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  await client.connect();
  try {
    const { rows } = await client.query('select id from price_sources where name = $1', [parsed.source]);
    if (rows.length === 0) throw new Error(`no price source named '${parsed.source}'`);
    const id = rows[0].id as string;
    await client.query('begin');
    const detail: Record<string, number> = {};
    for (const st of planAdminAction(parsed.action, id)) {
      const r = await client.query(st.sql, st.params);
      if (st.counts) detail[st.counts] = r.rowCount ?? 0;
    }
    const audit = auditStatement(parsed.action, id, detail);
    await client.query(audit.sql, audit.params);
    await client.query('commit');
    console.log(`${parsed.action} ${parsed.source}: done ${JSON.stringify(detail)}`);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error(`FAIL: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
