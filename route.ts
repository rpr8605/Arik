// Example chat API route - RAG pattern, not freeform chat.
// Two model calls: cheap extraction, then grounded response.
// Swap model names/SDK calls for whatever you're routing through (matches
// your existing OpenRouter/AI Router setup from MIST).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- Step 1: cheap intent/entity extraction ---
async function extractIntent(userMessage: string) {
  const prompt = `Extract structured intent from a patient's question about
drug pricing. Return ONLY JSON, no prose.

Schema:
{
  "drug_name": string | null,
  "question_type": "price_check" | "why_did_price_change" | "find_savings" | "bill_dispute" | "denial_appeal" | "other",
  "dose": string | null,
  "employer_name": string | null,
  "institution_name": string | null,
  "insurance_plan_name": string | null,
  "prescriber_name": string | null,
  "state_or_location": string | null
}

Extract every field mentioned ANYWHERE in the message, including in
passing - not just what's directly being asked about. Example: "I work
at Apple and my Jardiance costs too much" should extract both
employer_name: "Apple" and drug_name: "Jardiance", even though only the
drug price is the direct question. See CONVERSATIONAL_ENTITY_EXTRACTION.md.

User message: "${userMessage}"`;

  // route to cheapest model - this is pattern extraction, not reasoning
  const res = await callModel({ model: 'haiku', prompt, maxTokens: 200 });
  return JSON.parse(res);
}

// --- Step 1.5: merge newly extracted entities into durable storage ---
// This is the mechanism that actually prevents re-asking - extraction
// alone is worthless if the fact isn't written somewhere checkable on
// later turns. See CONVERSATIONAL_ENTITY_EXTRACTION.md.
async function mergeExtractedEntities(userId: string, intent: any) {
  const updates: Record<string, any> = {};
  if (intent.employer_name) updates.employer_name = intent.employer_name;
  if (intent.insurance_plan_name) updates.insurance_type = intent.insurance_plan_name;
  if (intent.state_or_location) updates.state = intent.state_or_location;

  if (Object.keys(updates).length > 0) {
    const { data: existing } = await supabase
      .from('user_matching_profile')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    // Don't silently overwrite an existing non-null value - flag as a
    // possible correction instead of assuming the new extraction is right.
    const safeUpdates: Record<string, any> = {};
    const conflicts: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (existing && existing[key] && existing[key] !== value) {
        conflicts.push(key);
      } else {
        safeUpdates[key] = value;
      }
    }

    if (Object.keys(safeUpdates).length > 0) {
      await supabase.from('user_matching_profile').upsert({ id: userId, ...safeUpdates });
    }
    if (conflicts.length > 0) {
      // surfaced to the response model as a flag to ask about, not silently resolved
      return { conflicts };
    }
  }

  // prescriber_name is per-medication, not per-profile - merge separately
  // against the specific drug in play, once drug_id resolution exists.
  return { conflicts: [] };
}

// --- Step 2: query the brain, not the model ---
async function retrieveContext(userId: string, intent: any) {
  const { data: profile } = await supabase
    .from('user_matching_profile')
    .select('*')
    .eq('id', userId)
    .single();

  const { data: medications } = await supabase
    .from('user_medications')
    .select('*, drugs(*)')
    .eq('user_id', userId);

  let drugQuery = supabase.from('drugs').select('id, name, brand_names');
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
      supabase.from('exploits').select('*, sources(*)').in('drug_id', drugIds).eq('status', 'active'),
      supabase.from('price_points').select('*, sources(*)').in('drug_id', drugIds),
      supabase.from('accumulator_policies').select('*, sources(*)'),
    ]);

  return { profile, medications, exploits, prices, accumulators };
}

// --- Step 3: grounded response, only speaks from retrieved context ---
async function generateResponse(userMessage: string, context: any, history: any[], conflicts: string[] = []) {
  const systemPrompt = await loadSystemPrompt(); // chat_system_prompt.md content

  const groundedInput = `
USER_PROFILE: ${JSON.stringify(context.profile)}
USER_MEDICATIONS: ${JSON.stringify(context.medications)}
PROFILE_CONFLICTS_DETECTED: ${JSON.stringify(conflicts)}
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
  const mergeResult = await mergeExtractedEntities(userId, intent);
  const context = await retrieveContext(userId, intent);

  const { data: history } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  const response = await generateResponse(message, context, history ?? [], mergeResult.conflicts);

  const retrievedIds = (context.exploits ?? []).map((e: any) => e.id);
  await supabase.from('chat_messages').insert([
    { session_id: sessionId, role: 'user', content: message },
    { session_id: sessionId, role: 'assistant', content: response, retrieved_exploit_ids: retrievedIds },
  ]);

  return Response.json({ response, sources: context.exploits });
}

// stub - wire to your actual model router / Anthropic SDK / OpenRouter client
async function callModel(opts: { model: string; prompt: string; system?: string; maxTokens: number }) {
  throw new Error('wire this to your model router');
}
async function loadSystemPrompt() {
  return ''; // load chat_system_prompt.md contents
}
