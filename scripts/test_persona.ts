// Pure tests for the persona (docs/kimi/ARIK_PERSONA.md): crisis detection
// and replies, style dials, explicit overrides, intro, the style block,
// the load measurement and reply composition. No model, no network.
// Run: npx tsx scripts/test_persona.ts
import { composeReply, CRISIS_REPLY, INTRO, PERSONA_SYSTEM_BLOCK } from '../lib/persona/arik';
import { DEFAULT_DIALS, detectCrisis, detectStyle, introFor, measureLoad, styleBlock } from '../lib/persona/styleSignals';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// --- Crisis detection ---
for (const m of [
  "I can't afford this, I just want to kill myself",
  'Honestly I feel suicidal about this bill',
  "I don't want to live anymore with these costs",
  'Me quiero morir, no puedo pagar esto',
  'Estoy pensando en suicidarme',
]) check(`self-harm detected: "${m}"`, detectCrisis(m) === 'self_harm');
for (const m of [
  "I ran out of insulin and can't afford a refill today",
  "I'm out of my inhaler right now and can't get it",
  "Can't get my blood thinner tonight, pharmacy says the card failed",
  'Se me acabó la insulina y no puedo comprarla hoy',
]) check(`life-sustaining medication today detected: "${m}"`, detectCrisis(m) === 'medication_access');
for (const m of [
  'This price is killing me',
  'My dad died last year and the hospital keeps billing',
  'How much is insulin with my plan?',
  'I need my inhaler refilled next month, what is cheapest?',
  'The copay card is dead, it never works',
]) check(`no crisis: "${m}"`, detectCrisis(m) === null);

// --- Crisis replies (code-written, shown first) ---
check('self-harm reply (en) is the owner wording, with 988 and 911',
  CRISIS_REPLY.self_harm.en === "If you're thinking about hurting yourself, call or text 988 (Suicide & Crisis Lifeline), free, any time. If you're in immediate danger, call 911.");
check('self-harm reply (es) has 988 and 911', /988/.test(CRISIS_REPLY.self_harm.es) && /911/.test(CRISIS_REPLY.self_harm.es));
check('medication reply: pharmacist or prescriber now, urgent care or ER if in danger',
  /pharmacist/.test(CRISIS_REPLY.medication_access.en) && /prescribed/.test(CRISIS_REPLY.medication_access.en) && /urgent care or the ER/.test(CRISIS_REPLY.medication_access.en));

// --- Style dials ---
{
  const r = detectStyle(['just tell me the price']);
  check('"just tell me the price" -> short + answer first', r.dials.length === 'short' && r.dials.order === 'answer_first');
}
{
  const q = 'How do I get the Eliquis copay card to work at my pharmacy counter?';
  const r = detectStyle([q, q]);
  check('repeated question -> plain + re-explain', r.confused && r.dials.readingLevel === 'plain' && /re-explain/.test(styleBlock(r)));
}
{
  const r = detectStyle(['I do not understand what that means']);
  check('"I do not understand" -> confused', r.confused);
}
{
  const r = detectStyle(['Hola, necesito ayuda con el precio de mi medicamento, no tengo seguro']);
  check('Spanish message -> offer Spanish (never auto-switch)', r.looksSpanish && !r.spanishRequested);
  check('"en español" -> explicit Spanish request', detectStyle(['can you answer en español']).spanishRequested);
}
{
  const r = detectStyle(['This is ridiculous, I am so angry, they keep denying my claim and I am scared I cannot afford it']);
  check('angry/scared -> steady-warm, one step (never direct-sharp)', r.dials.tone === 'steady_warm' && r.dials.pace === 'one_step');
}
check('no signals -> defaults', JSON.stringify(detectStyle(['What is the cheapest way to fill my Eliquis prescription this month?']).dials) === JSON.stringify(DEFAULT_DIALS));
check('empty history -> defaults', JSON.stringify(detectStyle([]).dials) === JSON.stringify(DEFAULT_DIALS));

// --- Explicit beats inferred ---
{
  const r = detectStyle(['ok', 'sure', 'explain it in detail please']);
  check('explicit "explain in detail" beats terse inferred short', r.dials.length === 'detailed');
}
{
  const r = detectStyle(['give me the full breakdown'], { length: 'short' });
  check('explicit ask this conversation beats the saved preference', r.dials.length === 'detailed');
}
{
  const r = detectStyle(['ok', 'sure', 'fine'], { length: 'detailed' });
  check('saved preference beats inference', r.dials.length === 'detailed');
}
{
  const r = detectStyle(['too long', 'now what about the other card?']);
  check('an explicit ask lasts for the rest of the conversation', r.dials.length === 'short');
  check('...but is only offered for "Remember this?" on the turn it was asked', !r.explicitThisTurn.length);
}
check('"simple" setting = plain + one step', (() => { const r = detectStyle(['give me the full plan'], { simple: true }); return r.dials.readingLevel === 'plain'; })());

// --- Crisis freezes dials ---
{
  const r = detectStyle(['too long, short version', 'I want to end my life']);
  check('crisis freezes dials at neutral', r.crisis === 'self_harm' && JSON.stringify(r.dials) === JSON.stringify(DEFAULT_DIALS));
  check('crisis style block defers to the crisis instruction', /Crisis language detected/.test(styleBlock(r)));
}

// --- Style block size ---
for (const msgs of [['just tell me'], ['I am confused, what does that mean?'], ['explain, slow down please']]) {
  const block = styleBlock(detectStyle(msgs));
  const words = block.split(/\s+/).length;
  check(`style block under ~80 tokens (${words} words)`, words <= 60, block);
}

// --- Intro ---
check('first reply ever -> full intro', introFor({ assistantMessagesInCase: 0, userHasEarlierConversation: false, crisis: null }) === 'full');
check('first reply in a new case for a returning user -> short intro', introFor({ assistantMessagesInCase: 0, userHasEarlierConversation: true, crisis: null }) === 'short');
check('later replies -> no intro', introFor({ assistantMessagesInCase: 2, userHasEarlierConversation: false, crisis: null }) === null);
check('crisis -> no intro', introFor({ assistantMessagesInCase: 0, userHasEarlierConversation: false, crisis: 'self_harm' }) === null);
check('intro text is exact', INTRO.en.full.startsWith("Hi, I'm Arik. I'm an AI that works for you, not for your insurance company, pharmacy or drug maker.") && INTRO.en.short === "Hi, it's Arik again.");

// --- Composition order ---
check('intro goes before the answer', composeReply({ body: 'Answer.', crisis: null, intro: 'full', lang: 'en', shortCircuit: false }) === `${INTRO.en.full}\n\nAnswer.`);
check('crisis reply goes first, before the model text', composeReply({ body: 'Model text.', crisis: 'medication_access', intro: null, lang: 'en', shortCircuit: false }).startsWith(CRISIS_REPLY.medication_access.en));
check('self-harm on a short-circuit path: crisis reply alone, no task text', composeReply({ body: 'I don\'t have anything in my data...', crisis: 'self_harm', intro: null, lang: 'en', shortCircuit: true }) === CRISIS_REPLY.self_harm.en);
check('medication crisis on a short-circuit path keeps the useful answer', composeReply({ body: 'No data.', crisis: 'medication_access', intro: null, lang: 'es', shortCircuit: true }) === `${CRISIS_REPLY.medication_access.es}\n\nNo data.`);
check('no intro, no crisis -> body unchanged', composeReply({ body: 'x', crisis: null, intro: null, lang: 'en', shortCircuit: false }) === 'x');

// --- Load watchdog ---
{
  const m = measureLoad('You pay $10 a month, or $120 a year, 50% off.\n\n1. Call\n2. Enroll\n- note\n---DETAILS---\n$999 $888');
  check('load measurement counts numbers, bullets, actions (details excluded)', m.numbers === 3 && m.bullets === 3 && m.actions === 2, JSON.stringify(m));
}

// --- Persona block ---
check('persona block says AI, never human', /You are an AI/.test(PERSONA_SYSTEM_BLOCK) && /Never pretend to be human/.test(PERSONA_SYSTEM_BLOCK));
check('persona block forbids urgency/fear/flattery/false reassurance', /urgency, fear, flattery, false reassurance/.test(PERSONA_SYSTEM_BLOCK));
check('persona block: style never changes substance', /never change prices, programs, eligibility, rankings/.test(PERSONA_SYSTEM_BLOCK));
check('persona block has no em dashes', !PERSONA_SYSTEM_BLOCK.includes('—'));

console.log(failures === 0 ? '\nPERSONA: ALL PASS' : `\nPERSONA: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
