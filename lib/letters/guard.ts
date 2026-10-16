// Guard for the one sentence a model may add to a letter (the "bounded
// paragraph"). Pure. The sentence must carry no facts at all: no digits,
// no dollar signs, no names or places, no placeholders, nothing legal or
// threatening, short. Everything factual in a letter is written by code
// (lib/letters/templates.ts).

const EM_DASH = String.fromCharCode(0x2014);

export const BANNED_LETTER_WORDS = /\b(attorneys?|lawyers?|lawsuits?|sue|suing|legal action|court|guarantee[ds]?|fraud(ulent)?|illegal|demand|threat|legal advice|liable|liability|penalt(y|ies))\b/i;

export function boundedSentenceProblems(s: string): string[] {
  const p: string[] = [];
  const t = s.trim();
  if (!t) p.push('empty');
  if (t.length > 220) p.push('longer than 220 characters');
  if (/\d/.test(t)) p.push('contains a number');
  if (/[$%{}<>@#]/.test(t)) p.push('contains a symbol that could carry a fact');
  if (t.includes(EM_DASH)) p.push('em dash');
  if (BANNED_LETTER_WORDS.test(t)) p.push('legal or threatening wording');
  if (/\n/.test(t)) p.push('more than one paragraph');
  // Capitalized words other than the first word and "I" are names,
  // places or programs: facts the model was never given.
  const caps = t.split(/\s+/).slice(1).filter((w) => /^[A-Z]/.test(w) && !/^I('|$|[.,])/.test(w));
  if (caps.length) p.push(`names a person, place or program: ${caps.slice(0, 3).join(', ')}`);
  if (!/^[A-Z]/.test(t) || !/[.!]$/.test(t)) p.push('not one plain sentence');
  if ((t.match(/[.!?](\s|$)/g) ?? []).length > 2) p.push('more than two sentences');
  return p;
}
