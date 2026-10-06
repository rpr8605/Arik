// Pure unit tests for the grounding guard (S1 hardening 2026-10-05).
// No network: the model is a stub. Run: npx tsx scripts/test_grounding_guard.ts
import {
  buildAllowedFacts,
  findUnmatchedClaims,
  withGroundingGuard,
} from '../lib/groundingGuard';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// Facts: the retrieved context for a fake Eliquis case.
const ctx = {
  ranked_pathways: [
    { title: 'Eliquis Co-pay Card', monthlyCostUsd: 10, projectedAnnualCostUsd: 120 },
    { title: 'list price', monthlyCostUsd: 521, projectedAnnualCostUsd: 6252 },
  ],
  exploits: [{ title: 'Eliquis Co-pay Card', annual_max_savings: 2000 }],
};
const facts = buildAllowedFacts({
  retrievedContext: ctx,
  profile: { insurance_type: 'employer', state: 'IA' },
  knownPrograms: ['Eliquis Co-pay Card (BMS/Pfizer) - $10 per fill', 'Zepbound Savings Card (commercial, drug covered)'],
  allowedTitles: ['Eliquis Co-pay Card (BMS/Pfizer) - $10 per fill'],
});

// --- findUnmatchedClaims ---
check('clean text passes', findUnmatchedClaims('The card is $10 per fill, up to $2,000 a year.', facts).length === 0);
check('invented dollar amount flagged', findUnmatchedClaims('You would pay $99.', facts).includes('$99'));
check('K abbreviation of a real figure passes', findUnmatchedClaims('The cap is $2K a year.', facts).length === 0);
check('invented percentage flagged', findUnmatchedClaims('That saves 80%.' , facts).includes('80%'));
check('bare 3+ digit number flagged when not in data', findUnmatchedClaims('List is about 6125 per year.', facts).includes('6125'));
check('foreign program name flagged', findUnmatchedClaims('Try the Zepbound Savings Card instead.', facts).some((f) => f.includes('zepbound')));
check('small structural numbers never flagged', findUnmatchedClaims('Option 1: fill a 30-day supply, take 5 mg twice daily.', facts).length === 0);
check('phone-shaped numbers never flagged', findUnmatchedClaims('Call 800-555-1234 for the program.', facts).length === 0);

// --- withGroundingGuard flow ---
const fb = () => 'FALLBACK: sourced options only.';

async function main() {
// pass: first response clean
{
  const r = await withGroundingGuard({
    generate: async () => 'The card is $10 per fill. Source listed below.',
    facts, fallback: fb,
  });
  check('pass: clean first response used, no trips', r.text.includes('$10') && r.trips === 0 && !r.regenerated && !r.fellBack);
}

// regenerate-then-pass: first response invents, second is clean
{
  let calls = 0;
  let sawNote = '';
  const r = await withGroundingGuard({
    generate: async (note?: string) => {
      calls++;
      if (calls === 1) return 'You would pay $99 with the card.';
      sawNote = note ?? '';
      return 'The card is $10 per fill.';
    },
    facts, fallback: fb,
  });
  check('regenerate: second clean response used', r.text.includes('$10') && r.regenerated && !r.fellBack);
  check('regenerate: retry note lists the offender', sawNote.includes('$99'), sawNote.slice(0, 60));
  check('regenerate: trips counted', r.trips === 1);
}

// fallback: both responses invent
{
  const logs: string[] = [];
  const r = await withGroundingGuard({
    generate: async () => 'You would pay $99, maybe $77.',
    facts, fallback: fb, log: (l) => logs.push(l),
  });
  check('fallback: deterministic answer replaces the model text', r.text.startsWith('FALLBACK') && r.fellBack && r.trips === 2);
  check('fallback: guard trip logged as counts only', logs.length === 1 && /trips=2/.test(logs[0]) && !/99|77/.test(logs[0]), logs[0]);
}
}

main().then(() => {
  console.log(failures === 0 ? '\nGROUNDING GUARD: ALL PASS' : `\nGROUNDING GUARD: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
