// Kill switch and purge for a routing partner (M24 step 8), same shape as
// the price-source admin (lib/pricing/sourceAdmin.ts). Executed by
// scripts/routing_admin.ts against the local database; every action writes
// one routing_partner_events row with counts only.

import type { AdminAction, AdminStatement } from '../pricing/sourceAdmin';

export function planRoutingAction(action: AdminAction, partnerId: string): AdminStatement[] {
  const steps: AdminStatement[] = [
    { sql: `update routing_partners set enabled = ${action === 'enable' ? 'true' : 'false'} where id = $1`, params: [partnerId] },
  ];
  if (action === 'purge') {
    steps.push({ sql: 'delete from routing_intents where partner_id = $1', params: [partnerId], counts: 'intents_deleted' });
  }
  return steps;
}

export function routingAuditStatement(action: AdminAction, partnerId: string, detail: Record<string, number>): AdminStatement {
  return {
    sql: 'insert into routing_partner_events (partner_id, action, detail) values ($1, $2, $3::jsonb)',
    params: [partnerId, action, JSON.stringify(detail)],
  };
}
