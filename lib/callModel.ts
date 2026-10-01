import { MODEL_TIERS, type ModelTier } from './modelConfig';

// Single OpenRouter entry point for every model call in the system.
// Fails loud: HTTP errors (including max_price being unmet) and empty
// completions throw - there is no silent fallback to another tier or
// provider, since a silent upgrade is exactly the kind of thing that
// turns a cost-control rule into a surprise invoice.

// An image for vision-capable tiers (document intake sends page/photo
// images to the extraction tier as data-URL content parts).
export interface ModelImage {
  mediaType: 'image/jpeg' | 'image/png';
  base64: string;
}

export async function callModel(opts: {
  tier: ModelTier;
  prompt: string;
  system?: string;
  images?: ModelImage[];
  maxTokens?: number; // per-call override (document extraction needs more than the chat-extraction default); the tier default holds otherwise
  timeoutMs?: number; // per-call override; the tier's timeoutMs holds otherwise
}): Promise<string> {
  const spec = MODEL_TIERS[opts.tier];
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

  // Multimodal content parts when images are present; plain string
  // otherwise so existing callers and models are unaffected.
  const userContent =
    opts.images && opts.images.length > 0
      ? [
          { type: 'text', text: opts.prompt },
          ...opts.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
          })),
        ]
      : opts.prompt;

  // Standing rule: no unbounded waits. A hung OpenRouter connection
  // aborts at the tier's timeoutMs and throws a clear error - it never
  // silently pins the route open.
  const timeoutMs = opts.timeoutMs ?? spec.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: spec.slug,
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: userContent },
        ],
        max_tokens: opts.maxTokens ?? spec.maxTokens,
        provider: { sort: 'price', max_price: spec.maxPrice },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`OpenRouter ${opts.tier} call timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

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
