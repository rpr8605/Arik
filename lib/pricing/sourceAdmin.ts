// Kill switch and purge for a price source (M07-AC5). Pure planning here,
// executed by scripts/source_admin.ts against the local database. Every
// action writes one source_admin_events row with counts only, never a
// price or a payload.
//
//   disable: price_sources.enabled = false. Ranking and quotes stop using
//            the source at once (the ingest runner and quote registry both
//            read `enabled`).
//   enable:  the reverse.
//   purge:   deletes the source's price_points, raw_price_ingest rows and
//            ingest_runs, and disables it first so nothing re-fills it.

export type AdminAction = 'disable' | 'enable' | 'purge';

export interface AdminStatement {
  sql: string;
  params: unknown[];
  counts?: string;   // key in the audit detail for this statement's row count
}

export function parseAdminArgs(argv: string[]): { action: AdminAction; source: string } | { error: string } {
  const [action, source] = argv;
  if (!['disable', 'enable', 'purge'].includes(action ?? '')) return { error: 'usage: source_admin.ts <disable|enable|purge> <source name>' };
  if (!source || !/^[a-z0-9_]+$/.test(source)) return { error: 'source name must be lowercase letters, digits or _' };
  return { action: action as AdminAction, source };
}

export function planAdminAction(action: AdminAction, sourceId: string): AdminStatement[] {
  const steps: AdminStatement[] = [];
  if (action === 'enable') {
    steps.push({ sql: 'update price_sources set enabled = true where id = $1', params: [sourceId] });
  } else {
    steps.push({ sql: 'update price_sources set enabled = false where id = $1', params: [sourceId] });
  }
  if (action === 'purge') {
    steps.push({ sql: 'delete from price_points where price_source_id = $1', params: [sourceId], counts: 'price_points_deleted' });
    steps.push({ sql: 'delete from raw_price_ingest where source_id = $1', params: [sourceId], counts: 'raw_rows_deleted' });
    steps.push({ sql: 'delete from ingest_runs where source_id = $1', params: [sourceId], counts: 'ingest_runs_deleted' });
  }
  return steps;
}

export function auditStatement(action: AdminAction, sourceId: string, detail: Record<string, number>): AdminStatement {
  return {
    sql: 'insert into source_admin_events (source_id, action, detail) values ($1, $2, $3::jsonb)',
    params: [sourceId, action, JSON.stringify(detail)],
  };
}
