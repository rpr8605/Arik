// Quote-mode price sources (M07). Each entry is a config for the template
// in configAdapter.ts. Empty in this repo on purpose: a real partner's
// config lives in the private adapters repo, and a source is only asked
// when its price_sources row is enabled. The mock (mockPartner.ts) is used
// by tests only and is never registered here.

import type { SourceConfig } from './configAdapter';
import { createConfigAdapter } from './configAdapter';
import type { PriceQuoteAdapter } from './adapter';

export const QUOTE_SOURCE_CONFIGS: SourceConfig[] = [];

// Enabled quote adapters: a config here AND an enabled price_sources row
// (looked up by name). No configs -> no database call at all.
export async function enabledQuoteAdapters(
  lookup: (names: string[]) => Promise<{ id: string; name: string; enabled: boolean }[]>,
  env: Record<string, string | undefined> = process.env,
  configs: SourceConfig[] = QUOTE_SOURCE_CONFIGS,
): Promise<PriceQuoteAdapter[]> {
  const live = configs.filter((c) => c.enabled && c.mode === 'quote');
  if (live.length === 0) return [];
  const rows = await lookup(live.map((c) => c.key));
  return live.flatMap((c) => {
    const row = rows.find((r) => r.name === c.key && r.enabled);
    return row ? [createConfigAdapter(c, row.id, { env, http: { timeoutMs: 4000, maxRetries: 1 } }).asQuote] : [];
  });
}
