// Kill switch and purge for a routing partner (M24).
//
//   npm run routing:disable -- "<partner label>"
//   npm run routing:enable -- "<partner label>"
//   npm run routing:purge -- "<partner label>"
//
// Local database only (ARIK_PG* env). One transaction, one audit row with
// counts only. Enabling needs a data use agreement date (db/034 check).

import pg from 'pg';
import { planRoutingAction, routingAuditStatement } from '../lib/routing/admin';
import type { AdminAction } from '../lib/pricing/sourceAdmin';

async function main() {
  const [action, label] = process.argv.slice(2);
  if (!['disable', 'enable', 'purge'].includes(action ?? '') || !label) {
    console.error('usage: routing_admin.ts <disable|enable|purge> "<partner label>"');
    process.exit(1);
  }
  const host = process.env.ARIK_PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost'].includes(host)) {
    console.error('routing_admin runs against a local database only');
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
    const { rows } = await client.query('select id from routing_partners where partner_label = $1', [label]);
    if (rows.length === 0) throw new Error('no routing partner with that label');
    const id = rows[0].id as string;
    await client.query('begin');
    const detail: Record<string, number> = {};
    for (const st of planRoutingAction(action as AdminAction, id)) {
      const r = await client.query(st.sql, st.params);
      if (st.counts) detail[st.counts] = r.rowCount ?? 0;
    }
    const audit = routingAuditStatement(action as AdminAction, id, detail);
    await client.query(audit.sql, audit.params);
    await client.query('commit');
    console.log(`${action}: done ${JSON.stringify(detail)}`);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error(`FAIL: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
