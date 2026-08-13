// The single write path for the consent ledger (SECURITY.md requirement,
// cited by DATA_RETENTION.md). Append-only by design: there is no update
// or delete path here, and RLS gives the owner read-only access - a
// revoked choice is a new row, never an edited one. When in doubt, log:
// broader logging is the safer default for a compliance-sensitive ledger.

import type { SupabaseClient } from '@supabase/supabase-js';

export type ConsentCategory = 'language' | 'extended_retention' | 'demographic_eligibility' | 'explanation_style';
export type ConsentAction = 'set' | 'opt_in' | 'opt_out' | 'clear';

export async function recordConsent(
  sb: SupabaseClient,
  userId: string,
  category: ConsentCategory,
  action: ConsentAction,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sb
    .from('consent_ledger')
    .insert({ user_id: userId, category, action, detail });
  if (error) throw error;
}
