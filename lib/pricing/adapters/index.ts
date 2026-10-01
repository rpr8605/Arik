// Adapter registry: price_sources.name -> adapter factory.
// The ingest runner (scripts/ingest_prices.ts) is the only caller.
// Adding a source = one new file in this directory + one line here.
import type { PriceSourceAdapter } from '../adapter';
import { createNadacAdapter } from './nadac';

export const ADAPTER_FACTORIES: Record<string, (sourceId: string) => PriceSourceAdapter> = {
  nadac: createNadacAdapter,
};
