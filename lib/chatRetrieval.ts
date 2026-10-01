// Builds the RETRIEVED_CONTEXT payload sent to the response model
// (app/api/chat/route.ts). The allow_ai_processing=false gate is applied
// INSIDE this function - the exact one the route calls - so a row from
// an AI-barred source cannot reach an OpenRouter prompt unless this
// function is deliberately bypassed. Tested directly by
// scripts/test_pricing_enforcement.ts.
//
// Same rule for allow_patient_display=false: prompt content is
// patient-facing, so display-barred rows are excluded here too. Stale
// rows are excluded AND named in the payload's excluded_prices block -
// the model is expected to say what was held back and why.

import {
  partitionPricesForConsent,
  type PriceSourceConsent,
} from './pricing/enforcement';

export interface PromptRetrievedContextInput {
  exploits: any[];
  prices: any[];
  accumulators: any[];
  counterGuidance: any[];
  blockedCards: any[];
  blockReason: string;
  rankedPathways: unknown;
  priceSources: Record<string, PriceSourceConsent>;
  now?: Date | string;
}

// Labels never carry row identifiers (ndc/id/values): the exclusion note
// says WHAT KIND of price was withheld and WHY - enough for an honest
// answer, never enough to reconstruct the withheld figure.
function label(row: any): string {
  return row?.price_type ?? 'price';
}

export function buildPromptRetrievedContext(input: PromptRetrievedContextInput): {
  payload: Record<string, unknown>;
  excludedPrices: { label: string; reason: string }[];
} {
  const partition = partitionPricesForConsent(input.prices ?? [], {
    sourcesById: input.priceSources,
    now: input.now,
  });
  // AI-barred rows are reported to the API caller but NEVER enter the
  // prompt payload - not even as an exclusion note (their source forbids
  // model processing, and a note is still processing their content).
  const aiExcluded = partition.excludedAi.map((x) => ({ label: label(x.row), reason: x.reason }));
  const promptExcluded = [
    ...partition.excludedStale,
    ...partition.excludedNotDisplayable,
  ].map((x) => ({ label: label(x.row), reason: x.reason }));
  const excludedPrices = [...promptExcluded, ...aiExcluded];

  return {
    payload: {
      exploits: input.exploits,
      // ONLY the consent-allowed set reaches the model.
      prices: partition.allowed,
      accumulators: input.accumulators,
      counter_guidance: input.counterGuidance,
      // Manufacturer copay cards already removed by the AKS hard-block for
      // government-coverage patients; listed here ONLY so the model can say
      // accurately why they're absent - never as options.
      blocked_pathways: (input.blockedCards ?? []).map((e: any) => ({
        title: e.title,
        reason: input.blockReason,
      })),
      // The ranking engine's output. When present, the model presents
      // pathways in THIS order with THESE notes - it does not re-rank or
      // revive blocked/pending rows as options (prompt rule).
      ranked_pathways: input.rankedPathways ?? null,
      // Prices withheld by staleness/display rules. The model must treat
      // these as "not available", with the reason, never as options.
      excluded_prices: promptExcluded,
    },
    excludedPrices,
  };
}
