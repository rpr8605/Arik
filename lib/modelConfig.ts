// Model routing (locked 2026-07-24, supersedes the MIST dependency):
// OpenRouter direct, two tiers. The `:floor` suffix routes to the cheapest
// provider for that model; `maxPrice` (USD per million tokens, set at each
// model's standard list price) is sent as OpenRouter's provider.max_price
// so a request fails loudly instead of silently landing on a premium
// provider. Adjust caps here only - never inline model names elsewhere.

export type ModelTier = 'extraction' | 'response';

export interface ModelSpec {
  slug: string;
  maxPrice: { prompt: number; completion: number };
  maxTokens: number;
  // Hard call timeout (2026-10-01, audit finding): every fetch is
  // AbortController-bounded. A hung provider call fails loud instead of
  // pinning a route open. Overridable per call (callModel opts).
  timeoutMs: number;
}

export const MODEL_TIERS: Record<ModelTier, ModelSpec> = {
  // Step 1: cheap pattern extraction, not reasoning.
  extraction: {
    slug: 'anthropic/claude-haiku-4.5:floor',
    maxPrice: { prompt: 1.0, completion: 5.0 },
    maxTokens: 200,
    timeoutMs: 30_000,
  },
  // Step 3: real reasoning model, grounded only in retrieved rows.
  // (Vision document extraction rides this tier with image payloads;
  // 20-40s is typical, 120s is the ceiling.)
  response: {
    slug: 'anthropic/claude-sonnet-4.6:floor',
    maxPrice: { prompt: 3.0, completion: 15.0 },
    maxTokens: 1500,
    timeoutMs: 120_000,
  },
};
