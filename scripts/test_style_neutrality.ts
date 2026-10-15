// Style neutrality (docs/kimi/ARIK_PERSONA.md tests): style changes
// WORDING only. For fixture cases, everything the model is given except the
// style block (system prompt, prices, programs, rankings, blocks, profile,
// history) must be byte-identical across every style setting, including
// crisis and confused. Pure: builds the real prompt with
// lib/chatPrompt.ts, no model call. Run: npx tsx scripts/test_style_neutrality.ts
import { buildResponsePrompt } from '../lib/chatPrompt';
import { styleBlock, type StyleDials, type StyleResult } from '../lib/persona/styleSignals';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const SYSTEM_FILE = '# rules\n- only retrieved facts';
const card = { id: 'e1', title: 'Eliquis Co-pay Card', exploit_type: 'copay_card', patient_price_floor: 10, annual_max_savings: 3000 };
const pap = { id: 'e2', title: 'BMS Patient Assistance Foundation', exploit_type: 'pap', patient_price_floor: 0 };
const FIXTURES = [
  {
    name: 'commercial Eliquis, ranked',
    context: {
      profile: { preferred_language: 'en', explanation_style: 'standard', insurance_type: 'employer', state: 'MO' },
      medications: [{ dose: '5 mg', drugs: { name: 'Eliquis' } }],
      exploits: [card, pap],
      prices: [{ price_type: 'list', price_usd: 606, supply_days: 30 }],
      rankedPathways: { ranked: [{ title: card.title, monthlyCostUsd: 10, projectedAnnualCostUsd: 120 }], excludedPrices: [] },
    },
  },
  {
    name: 'Medicare, copay card blocked',
    context: {
      profile: { preferred_language: 'es', explanation_style: 'simple', insurance_type: 'medicare_part_d', state: 'IA' },
      medications: [],
      exploits: [pap],
      blockedCards: [card],
      prices: [],
      rankedPathways: { ranked: [{ title: pap.title, monthlyCostUsd: 0 }], blocked: [{ title: card.title, reason: 'AKS' }] },
    },
  },
  {
    name: 'pending verification only',
    context: {
      profile: { insurance_type: null, state: null },
      medications: [],
      exploits: [{ id: 'e3', title: 'Zepbound Savings Card', exploit_type: 'copay_card' }],
      prices: [],
      rankedPathways: { ranked: [], pendingVerification: [{ title: 'Zepbound Savings Card', reason: 'conflicting sources' }] },
    },
  },
];
const history = [{ role: 'user', content: 'too expensive' }, { role: 'assistant', content: 'Hi, I\'m Arik.' }];

// Every dial combination, plus crisis and confused variants.
const styles: StyleResult[] = [];
for (const length of ['short', 'normal', 'detailed'] as const)
  for (const order of ['answer_first', 'context_first'] as const)
    for (const tone of ['steady_warm', 'direct'] as const)
      for (const readingLevel of ['plain', 'standard'] as const)
        for (const pace of ['one_step', 'full_plan'] as const) {
          const dials: StyleDials = { length, order, tone, readingLevel, pace };
          styles.push({ dials, crisis: null, explicitThisTurn: {}, confused: false, spanishRequested: false, looksSpanish: false });
        }
styles.push({ ...styles[0], confused: true });
styles.push({ ...styles[0], explicitThisTurn: { length: 'short' } });
styles.push({ ...styles[0], crisis: 'self_harm' });
styles.push({ ...styles[0], crisis: 'medication_access' });

for (const f of FIXTURES) {
  for (const format of ['card', 'standard'] as const) {
    const built = styles.map((st) => {
      const block = styleBlock(st);
      const out = buildResponsePrompt({ systemPromptFile: SYSTEM_FILE, userMessage: 'is there anything cheaper?', context: f.context, history, lang: 'en', format, styleBlock: block });
      return { block, ...out, rest: out.prompt.replace(block, '<STYLE>') };
    });
    const first = built[0];
    check(`${f.name} [${format}]: ${styles.length} styles -> identical system prompt (cacheable)`, built.every((b) => b.system === first.system));
    check(`${f.name} [${format}]: identical retrieved facts (prices, programs, rankings, blocks)`, built.every((b) => JSON.stringify(b.retrievedContext) === JSON.stringify(first.retrievedContext)));
    check(`${f.name} [${format}]: prompt differs ONLY by the style block`, built.every((b) => b.rest === first.rest), `${new Set(built.map((b) => b.rest)).size} variants`);
    check(`${f.name} [${format}]: each style block appears exactly once, at the end`, built.every((b) => b.prompt.split(b.block).length === 2 && b.prompt.trimEnd().endsWith(b.block)));
    check(`${f.name} [${format}]: style text never in the system prompt`, built.every((b) => !b.system.includes('HOW_THIS_PERSON_LIKES_TO_TALK:')));
  }
}

console.log(failures === 0 ? '\nSTYLE NEUTRALITY: ALL PASS' : `\nSTYLE NEUTRALITY: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
