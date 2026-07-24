// Example chat API route - RAG pattern, not freeform chat.
// Two model calls: cheap extraction, then grounded response.
// Swap model names/SDK calls for whatever you're routing through (matches
// your existing OpenRouter/AI Router setup from MIST).

import { createClient } from '@supabase/supabase-js';

// Created lazily per call - a module-level client crashes Next's
// build-time page-data collection when env vars aren't present.
function supabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// --- Step 1: cheap intent/entity extraction ---
async function extractIntent(userMessage: string) {
  const prompt = `Extract structured intent from a patient's question about
drug pricing. Return ONLY JSON, no prose.

Schema:
{
  "drug_name": string | null,
  "question_type": "price_check" | "why_did_price_change" | "find_savings" | "other",
  "dose": string | null
}

User message: "${userMessage}"`;

  // route to cheapest model - this is pattern extraction, not reasoning
  const res = await callModel({ model: 'haiku', prompt, maxTokens: 200 });
  return JSON.parse(res);
}

// --- Step 2: query the brain, not the model ---
async function retrieveContext(userId: string, intent: any) {
  const { data: profile } = await supabase()
    .from('user_matching_profile')
    .select('*')
    .eq('id', userId)
    .single();

  const { data: medications } = await supabase()
    .from('user_medications')
    .select('*, drugs(*)')
    .eq('user_id', userId);

  let drugQuery = supabase().from('drugs').select('id, name, brand_names');
  if (intent.drug_name) {
    // matches both generic name and brand_names array - patients type
    // brand names ("Jardiance") more often than generic (empagliflozin)
    drugQuery = drugQuery.or(
      `name.ilike.%${intent.drug_name}%,brand_names.cs.{${intent.drug_name}}`
    );
  }
  const { data: drugs } = await drugQuery;
  const drugIds = (drugs ?? []).map((d) => d.id);

  const [{ data: exploits }, { data: prices }, { data: accumulators }] =
    await Promise.all([
      supabase().from('exploits').select('*, sources(*)').in('drug_id', drugIds).eq('status', 'active'),
      supabase().from('price_points').select('*, sources(*)').in('drug_id', drugIds),
      supabase().from('accumulator_policies').select('*, sources(*)'),
    ]);

  return { profile, medications, exploits, prices, accumulators };
}

// --- Step 3: grounded response, only speaks from retrieved context ---
async function generateResponse(userMessage: string, context: any, history: any[]) {
  const systemPrompt = await loadSystemPrompt(); // chat_system_prompt.md content

  const groundedInput = `
USER_PROFILE: ${JSON.stringify(context.profile)}
USER_MEDICATIONS: ${JSON.stringify(context.medications)}
RETRIEVED_CONTEXT: ${JSON.stringify({
    exploits: context.exploits,
    prices: context.prices,
    accumulators: context.accumulators,
  })}
CONVERSATION_HISTORY: ${JSON.stringify(history)}
USER_MESSAGE: ${userMessage}
`;

  // route to a real reasoning model here - this call needs judgment, not just pattern match
  return callModel({ model: 'sonnet', system: systemPrompt, prompt: groundedInput, maxTokens: 1000 });
}

export async function POST(req: Request) {
  // Per CASE_MODEL.md: chat_sessions.case_id ties this session to a specific
  // case. Session creation (tied to a case) happens in the case-creation
  // flow, not here - this route assumes sessionId already resolves to a
  // case-scoped session.
  const { message, sessionId, userId } = await req.json();

  const intent = await extractIntent(message);
  const context = await retrieveContext(userId, intent);

  const { data: history } = await supabase()
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  const response = await generateResponse(message, context, history ?? []);

  const retrievedIds = (context.exploits ?? []).map((e: any) => e.id);
  await supabase().from('chat_messages').insert([
    { session_id: sessionId, role: 'user', content: message },
    { session_id: sessionId, role: 'assistant', content: response, retrieved_exploit_ids: retrievedIds },
  ]);

  return Response.json({ response, sources: context.exploits });
}

// stub - wire to the MIST project's OpenRouter setup (decided 2026-07-24;
// config lives outside this repo). Typed as returning string so the file
// type-checks before the real implementation lands.
async function callModel(opts: { model: string; prompt: string; system?: string; maxTokens: number }): Promise<string> {
  throw new Error('wire this to your model router');
}
async function loadSystemPrompt(): Promise<string> {
  return ''; // load chat_system_prompt.md contents
}
