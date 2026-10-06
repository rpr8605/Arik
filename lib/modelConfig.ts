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
  // maxTokens 2500 (was 1500): the trust receipt must never be truncated -
  // eval_responses showed both candidate models hitting the 1500 cap and
  // losing the ---DETAILS--- section on long contexts (2026-10-05).
  // Sonnet 5.5 (2026-10-05): passed eval_responses at the 4.6 baseline
  // (8/12 each; 5.5's failures are receipt truncations on long contexts,
  // 4.6's are invented numbers). Slug and max_price verified against the
  // OpenRouter models API ($2/$10 per M tokens vs 4.6's $3/$15).
  response: {
    slug: 'anthropic/claude-sonnet-5.5:floor',
    maxPrice: { prompt: 2.0, completion: 10.0 },
    maxTokens: 2500,
    timeoutMs: 120_000,
  },
};
