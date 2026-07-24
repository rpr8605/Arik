import { MODEL_TIERS, type ModelTier } from './modelConfig';

// Single OpenRouter entry point for every model call in the system.
// Fails loud: HTTP errors (including max_price being unmet) and empty
// completions throw - there is no silent fallback to another tier or
// provider, since a silent upgrade is exactly the kind of thing that
// turns a cost-control rule into a surprise invoice.

export async function callModel(opts: {
  tier: ModelTier;
  prompt: string;
  system?: string;
}): Promise<string> {
  const spec = MODEL_TIERS[opts.tier];
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: spec.slug,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.prompt },
      ],
      max_tokens: spec.maxTokens,
      provider: { sort: 'price', max_price: spec.maxPrice },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${opts.tier} call failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error(`OpenRouter ${opts.tier} returned no content`);
  }
  // One-line usage record per call - shows up in dev server logs and is
  // what the smoke test reads for real per-call cost accounting.
  console.log(
    `[callModel] tier=${opts.tier} model=${json.model ?? spec.slug} ` +
      `tokens=${json?.usage?.prompt_tokens ?? '?'}/${json?.usage?.completion_tokens ?? '?'}`,
  );
  return text;
}
