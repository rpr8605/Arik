// Builds the response model's prompt (persona work, 2026-10-14). Pure, so
// scripts/test_style_neutrality.ts can prove that style changes ONLY the
// style block: the system prompt and every retrieved fact are
// byte-identical for every style setting.
//
// - system: Arik's persona block (lib/persona/arik.ts) + chat_system_prompt.md.
//   Identical every turn, so prompt caching keeps working (M04-AC4).
// - prompt: the grounded input (minimal profile and medications per review
//   fix C3, retrieved context, history, message, format, language) and, last,
//   the per-person style block, which changes turn to turn (uncached part).

import { COPAY_CARD_BLOCK_REASON } from './medicareEligibility';
import { buildPromptRetrievedContext } from './chatRetrieval';
import { modelMedications, modelProfile } from './chatSubject';
import { PERSONA_SYSTEM_BLOCK } from './persona/arik';
import type { PriceSourceConsent } from './pricing/enforcement';

const LANGUAGE_NAMES: Record<'en' | 'es', string> = { en: 'English', es: 'Spanish' };

export function retrievedContextFor(context: any): Record<string, unknown> {
  const sourcesById: Record<string, PriceSourceConsent> = {};
  for (const s of context?.priceSources ?? []) sourcesById[s.id] = s;
  return buildPromptRetrievedContext({
    exploits: context?.exploits ?? [],
    prices: context?.prices ?? [],
    accumulators: context?.accumulators ?? [],
    counterGuidance: context?.counterGuidance ?? [],
    blockedCards: context?.blockedCards ?? [],
    blockReason: COPAY_CARD_BLOCK_REASON,
    rankedPathways: context?.rankedPathways ?? null,
    priceSources: sourcesById,
  }).payload;
}

export function buildSystemPrompt(systemPromptFile: string): string {
  return `${PERSONA_SYSTEM_BLOCK}\n${systemPromptFile}`;
}

export function buildResponsePrompt(input: {
  systemPromptFile: string;
  userMessage: string;
  context: any;
  history: any[];
  lang: 'en' | 'es';
  format: 'card' | 'standard';
  styleBlock: string;
  retryNote?: string;
}): { system: string; prompt: string; retrievedContext: Record<string, unknown> } {
  const retrievedContext = retrievedContextFor(input.context);
  const prompt = `
USER_PROFILE: ${JSON.stringify(modelProfile(input.context?.profile))}
USER_MEDICATIONS: ${JSON.stringify(modelMedications(input.context?.medications))}
RETRIEVED_CONTEXT: ${JSON.stringify(retrievedContext)}
CONVERSATION_HISTORY: ${JSON.stringify(input.history ?? [])}
USER_MESSAGE: ${input.userMessage}
${input.retryNote ? `REGENERATION NOTE (the previous answer was rejected by the grounding check): ${input.retryNote}\n` : ''}RESPONSE_FORMAT: ${input.format} ('card' = guided advocate format per the system
prompt: one-sentence answer, ONE next step (if more steps exist, end with
"Want the rest?"), boundary line, then stop. 'standard' = existing structure
with the same boundary line.)
RESPONSE_LANGUAGE: ${LANGUAGE_NAMES[input.lang]} (${input.lang}). Write the entire
response in this language. Exception - citations: quote every source
verbatim in its original language, never translated. Translating a
verbatim citation breaks the grounding guarantee; this is a correctness
rule, not a style preference.
${input.styleBlock}
`;
  return { system: buildSystemPrompt(input.systemPromptFile), prompt, retrievedContext };
}
