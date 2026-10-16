// The real LetterDrafters (Phase 4).
// - codeLetterDrafter: the whole letter from code templates. The default.
// - modelLetterDrafter: the same letter, plus ONE sentence a model writes
//   to set a calm, cooperative tone. The model is told only the letter
//   type and how many items it lists: no names, no account, no services,
//   no dates, no amounts, so no patient data leaves the server. The
//   sentence passes boundedSentenceProblems (lib/letters/guard.ts); one
//   regeneration with the problems listed, then the letter goes out
//   without it (usedFallback).

import { callModel, type ModelUsage } from '../../callModel';
import { boundedSentenceProblems } from '../../letters/guard';
import { buildLetter, joinBody } from '../../letters/templates';
import { LETTER_FOOTER, type DraftLetter, type LetterDrafter, type LetterInput } from '../types';

export const codeLetterDrafter: LetterDrafter = {
  name: 'code-templates',
  async draft(input: LetterInput): Promise<DraftLetter> {
    const p = buildLetter(input);
    return { type: input.type, subject: p.subject, body: joinBody(p), footer: LETTER_FOOTER, drafter: 'code-templates', usedFallback: false };
  },
};

const KIND: Record<string, string> = {
  billing_dispute: 'a patient disputing some hospital bill charges',
  itemized_bill_request: 'a patient asking a hospital for an itemized bill',
  hold_collections: 'a patient asking a hospital to pause collections during a review',
  financial_assistance_cover: 'a patient sending a financial assistance application to a hospital',
};

export type SentenceWriter = (prompt: string) => Promise<string>;

export const openRouterSentence = (onUsage?: (u: ModelUsage) => void): SentenceWriter => (prompt) =>
  callModel({ tier: 'response', prompt, maxTokens: 120, timeoutMs: 30_000, onUsage });

export function modelLetterDrafter(write: SentenceWriter = openRouterSentence()): LetterDrafter {
  return {
    name: 'code-templates+model-sentence',
    async draft(input: LetterInput): Promise<DraftLetter> {
      const p = buildLetter(input);
      const items = input.findings.length;
      const base = `Write ONE short sentence (under 30 words) for a letter from ${KIND[input.type] ?? 'a patient to a hospital'}${items ? ` about ${items} item${items === 1 ? '' : 's'}` : ''}. It goes right after the opening and should sound calm, polite and cooperative, showing the patient wants to resolve this. No numbers, no names, no dates, no promises, nothing legal or threatening. Return only the sentence.`;
      let sentence: string | null = null;
      let problems: string[] = [];
      for (let attempt = 0; attempt < 2 && sentence == null; attempt++) {
        const prompt = attempt === 0 ? base : `${base}\n\nYour last sentence was rejected because: ${problems.join('; ')}. Write a new one.`;
        try {
          const raw = (await write(prompt)).trim().replace(/^["']|["']$/g, '');
          problems = boundedSentenceProblems(raw);
          if (!problems.length) sentence = raw;
        } catch (e) {
          problems = [`model call failed: ${(e as Error).message.slice(0, 80)}`];
        }
      }
      const body = joinBody(sentence ? { ...p, opening: `${p.opening.replace(/:$/, '.')} ${sentence}${p.opening.endsWith(':') ? ' Here is what I found:' : ''}` } : p);
      return {
        type: input.type,
        subject: p.subject,
        body,
        footer: LETTER_FOOTER,
        drafter: sentence ? 'code-templates+model-sentence' : 'code-templates',
        usedFallback: sentence == null,
      };
    },
  };
}
