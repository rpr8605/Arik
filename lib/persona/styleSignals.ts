// Reading how a person likes to talk (docs/kimi/ARIK_PERSONA.md section 2),
// in code: pure, deterministic, no model call, no network, so it costs
// nothing. Tested by scripts/test_persona.ts.
//
// Inputs are ONLY what the person wrote in this conversation plus a style
// preference they explicitly saved. The signature has no profile,
// insurance, age or location parameter on purpose: Arik never infers
// personality from outside data. Dials are recomputed every turn and never
// stored or logged (only a preference the user states and saves is kept).

import type { CrisisKind, Lang } from './arik';

export interface StyleDials {
  length: 'short' | 'normal' | 'detailed';
  order: 'answer_first' | 'context_first';
  tone: 'steady_warm' | 'direct';
  readingLevel: 'plain' | 'standard';
  pace: 'one_step' | 'full_plan';
}

export const DEFAULT_DIALS: StyleDials = {
  length: 'normal',
  order: 'answer_first',
  tone: 'steady_warm',
  readingLevel: 'plain',
  pace: 'one_step',
};

// A preference the person saved (user_style_prefs) or set as the existing
// "simple" explanation style (owner decision 2026-10-14: simple = the
// explicit plain, one-step preference).
export interface ExplicitPrefs {
  length?: StyleDials['length'] | null;
  order?: StyleDials['order'] | null;
  simple?: boolean;
}

export interface StyleResult {
  dials: StyleDials;
  crisis: CrisisKind | null;
  // Explicit asks in the LATEST message only: drive the short
  // acknowledgement and the one-tap "Remember this?" offer.
  explicitThisTurn: { length?: StyleDials['length']; order?: StyleDials['order']; pace?: StyleDials['pace'] };
  confused: boolean;
  // Language never switches here (it has its own consent-ledgered path);
  // these only drive an offer to switch.
  spanishRequested: boolean;
  looksSpanish: boolean;
}

// --- Crisis (owner decision 2026-10-14: deterministic, shown first) ---

const SELF_HARM = [
  /\bkill(ing)? my ?self\b/i,
  /\bsuicid(e|al)\b/i,
  /\bend (it all|my life)\b/i,
  /\b(want|wanna|going) to die\b/i,
  /\bhurt(ing)? my ?self\b/i,
  /\bself[- ]?harm\b/i,
  /\bno reason to (live|go on)\b/i,
  /\bbetter off dead\b/i,
  /\bdon'?t want to (live|be here)( anymore)?\b/i,
  /\bsuicid/i, // es: suicidio, suicidarme
  /\bmatarme\b/i,
  /\bquitarme la vida\b/i,
  /\bquiero morir(me)?\b/i,
  /\bhacerme da[ñn]o\b/i,
  /\bno quiero vivir\b/i,
];

// Medicines whose sudden loss can be dangerous within hours or days.
const LIFE_SUSTAINING = /\b(insulin[a-z]*|inhaler|albuterol|epi-?pen|epinephrine|nitro(glycerin)?|seizure|anti-?seizure|heart (med|medicine|medication|pills?)|blood thinner|eliquis|xarelto|warfarin|transplant|anti-?rejection|dialysis|oxygen|insulina|inhalador)\b/i;
// Spanish forms avoid a trailing \b: in JS regex an accented letter (ó)
// is not a word character, so \b after it never matches.
const CANT_GET_NOW = /\b(can'?t (get|afford|fill|pick up)|cannot (get|afford|fill)|ran out|run out|out of|no more|rationing|ration(ed)? my|skipping doses|without (my|any))\b|\bno (tengo|puedo (comprar|pagar|conseguir))|\bse me acab(ó|o)/i;
const URGENT = /\b(today|tonight|right now|now|this (morning|afternoon|evening)|hoy|ahora|esta noche)\b|\bran out\b|\bout of\b|\bse me acab(ó|o)/i;

export function detectCrisis(message: string): CrisisKind | null {
  const text = message ?? '';
  if (SELF_HARM.some((re) => re.test(text))) return 'self_harm';
  if (LIFE_SUSTAINING.test(text) && CANT_GET_NOW.test(text) && URGENT.test(text)) return 'medication_access';
  return null;
}

// --- Style ---

const ASK_SHORT = /\b(just tell me|short version|keep it short|shorter|too long|tl;?dr|bottom line|just the (number|price|answer)|brief(ly)?|in short|m[aá]s corto|resumen|solo dime)\b/i;
const ASK_DETAILED = /\b(explain( it)?|full breakdown|more detail(s)?|in detail|walk me through|details please|tell me more|expl[ií]came|m[aá]s detalles?)\b/i;
const ASK_SLOW = /\b(slow down|one (thing|step) at a time|step by step|too (much|fast)|m[aá]s despacio|paso a paso)\b/i;
const ASK_FULL = /\b(full plan|all the steps|everything at once|whole plan|todo el plan)\b/i;
const ASK_CONTEXT_FIRST = /\b(why\b|how come|por qu[eé])/i;
const STRESS = /\b(scared|afraid|terrified|can'?t afford|angry|furious|overwhelmed|panic(king)?|stressed|desperate|ridiculous|outrageous|unfair|crying|miedo|asustad[oa]|no puedo pagar|enojad[oa]|abrumad[oa])\b|!{2,}/i;
const CONFUSED = /\b(what (does|did) (that|this|it) mean|what that means|i (don'?t|do not) (understand|get it)|confus(ed|ing)|lost me|no entiendo)\b|\bwhat\?|\bhuh\?|\bqu(é|e) significa/i;
const SPANISH_ASK = /\b(en espa[ñn]ol|in spanish|habla(s)? espa[ñn]ol)\b/i;
const SPANISH_WORDS = /\b(que|qu[eé]|el|la|los|las|de|mi|mis|no|para|por|con|medicamento|seguro|precio|receta|cu[aá]nto|cuesta|gracias|hola|necesito|tengo|puedo|ayuda)\b/gi;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, ' ').replace(/\s+/g, ' ').trim();

function similar(a: string, b: string): boolean {
  const ta = new Set(normalize(a).split(' ').filter((w) => w.length > 2));
  const tb = new Set(normalize(b).split(' ').filter((w) => w.length > 2));
  if (ta.size < 3 || tb.size < 3) return normalize(a) === normalize(b) && normalize(a).length > 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.8;
}

function explicitAsks(message: string): StyleResult['explicitThisTurn'] {
  const out: StyleResult['explicitThisTurn'] = {};
  if (ASK_SHORT.test(message)) {
    out.length = 'short';
    out.order = 'answer_first';
  } else if (ASK_DETAILED.test(message)) {
    out.length = 'detailed';
  }
  if (ASK_SLOW.test(message)) out.pace = 'one_step';
  else if (ASK_FULL.test(message)) out.pace = 'full_plan';
  return out;
}

export function detectStyle(recentUserMessages: string[], explicitPrefs: ExplicitPrefs = {}): StyleResult {
  const messages = recentUserMessages.filter((m) => typeof m === 'string' && m.trim() !== '').slice(-8);
  const latest = messages[messages.length - 1] ?? '';
  const crisis = detectCrisis(latest);
  const looksSpanish = (latest.match(SPANISH_WORDS) ?? []).length >= 3;
  const spanishRequested = SPANISH_ASK.test(latest);

  // Crisis: dials frozen at neutral, nothing else read.
  if (crisis) {
    return { dials: { ...DEFAULT_DIALS }, crisis, explicitThisTurn: {}, confused: false, spanishRequested, looksSpanish };
  }

  const dials: StyleDials = { ...DEFAULT_DIALS };
  const locked = new Set<keyof StyleDials>();
  const set = <K extends keyof StyleDials>(k: K, v: StyleDials[K], lock = false) => {
    if (locked.has(k)) return;
    dials[k] = v;
    if (lock) locked.add(k);
  };

  // 1. Inferred signals (weakest).
  const avgLen = messages.length ? messages.reduce((n, m) => n + m.length, 0) / messages.length : 0;
  const stressed = messages.slice(-3).some((m) => STRESS.test(m));
  if (messages.length >= 2 && avgLen < 40) {
    set('length', 'short');
    if (!stressed) set('tone', 'direct');
  }
  if (stressed) {
    // Complementary fit, not mirroring: calm and warm, one step at a time.
    set('tone', 'steady_warm');
    set('pace', 'one_step');
    if (avgLen > 300) set('length', 'normal');
  }
  if (/^\s*\$?\d/.test(latest)) set('order', 'answer_first');
  else if (ASK_CONTEXT_FIRST.test(latest)) set('order', 'context_first');
  const repeated = messages.length >= 2 && messages.slice(0, -1).some((m) => similar(m, latest));
  const confused = repeated || CONFUSED.test(latest);
  if (confused) {
    set('readingLevel', 'plain');
    if (dials.length === 'detailed') set('length', 'normal');
  }

  // 2. Saved preference (stronger than inference).
  if (explicitPrefs.simple) {
    set('readingLevel', 'plain', true);
    set('pace', 'one_step', true);
  }
  if (explicitPrefs.length) set('length', explicitPrefs.length, true);
  if (explicitPrefs.order) set('order', explicitPrefs.order, true);

  // 3. Explicit asks in this conversation win immediately, later ones over
  // earlier ones, for the rest of the conversation.
  locked.clear();
  for (const m of messages) {
    const ask = explicitAsks(m);
    if (ask.length) dials.length = ask.length;
    if (ask.order) dials.order = ask.order;
    if (ask.pace) dials.pace = ask.pace;
  }

  return { dials, crisis: null, explicitThisTurn: explicitAsks(latest), confused, spanishRequested, looksSpanish };
}

// The per-turn style block for the response model's UNCACHED prompt. Plain
// words, under 80 tokens.
const WORDS: Record<keyof StyleDials, Record<string, string>> = {
  length: { short: 'short replies', normal: 'normal-length replies', detailed: 'detailed replies' },
  order: { answer_first: 'answer first', context_first: 'brief context, then the answer' },
  tone: { steady_warm: 'steady and warm', direct: 'direct, no small talk' },
  readingLevel: { plain: 'plain everyday words', standard: 'standard wording' },
  pace: { one_step: 'one step at a time', full_plan: 'the full plan in order' },
};

export function styleBlock(style: StyleResult): string {
  if (style.crisis) {
    return 'HOW_THIS_PERSON_LIKES_TO_TALK: neutral. Crisis language detected: your crisis instruction comes first; Arik already showed crisis resources above your reply.';
  }
  const d = style.dials;
  const parts = [WORDS.length[d.length], WORDS.order[d.order], WORDS.tone[d.tone], WORDS.readingLevel[d.readingLevel], WORDS.pace[d.pace]];
  let block = `HOW_THIS_PERSON_LIKES_TO_TALK: ${parts.join('; ')}.`;
  if (style.confused) block += ' They seem confused: re-explain differently (simpler words, an example), not longer, then ask once "Did that make more sense?"';
  const ask = style.explicitThisTurn;
  if (ask.length || ask.pace) block += ' They just asked for this: acknowledge in a few words ("Got it, short answers.").';
  return block;
}

// --- Intro (persona section 1; added in code, never by the model) ---

// introShownOnWelcome: the case was started from the welcome screen, whose
// greeting bubble already showed the intro (owner decision 2026-10-15), so
// the first reply doesn't repeat it. Cases started any other way keep it.
export function introFor(input: {
  assistantMessagesInCase: number;
  userHasEarlierConversation: boolean;
  crisis: CrisisKind | null;
  introShownOnWelcome?: boolean;
}): 'full' | 'short' | null {
  if (input.crisis) return null;
  if (input.assistantMessagesInCase > 0) return null;
  if (input.introShownOnWelcome) return null;
  return input.userHasEarlierConversation ? 'short' : 'full';
}

// --- Cognitive load watchdog: free measurement, counts only ---

export function measureLoad(text: string): { numbers: number; bullets: number; actions: number } {
  const body = (text ?? '').split('---DETAILS---')[0];
  const numbers = (body.match(/\$\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|\b\d{3,}\b/g) ?? []).length;
  const lines = body.split('\n');
  const bullets = lines.filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length;
  const actions = lines.filter((l) => /^\s*\d+[.)]\s+/.test(l)).length;
  return { numbers, bullets, actions };
}

export type { Lang };
