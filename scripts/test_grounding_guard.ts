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

// --- Review fix C2: identifiers, dates and contact details are not facts ---
{
  // The review probe: the only real figure is $3,000; everything else is
  // id / timestamp / zip / phone noise that used to whitelist invented prices.
  const noisy = buildAllowedFacts({
    retrievedContext: {
      exploits: [{
        id: '3f2a1c10-9b25-4e8d-a150-7d2e30f45b99', title: 'Card', annual_max_savings: 3000,
        source_id: '45aa1c10-9b25-4e8d-a150-7d2e30f45b99', last_verified_at: '2026-10-05T14:30:25.123Z',
        support_phone: '1-855-354-7847', effective_date: '2026-01-01',
        eligibility_notes: 'Updated 2026-08-12; see https://example.com/terms/2045?id=150',
      }],
    },
    profile: { insurance_type: 'employer', state: 'MO', zip_code: '64111', updated_at: '2026-10-14T19:52:40Z' },
  });
  const invented = ['$10/month', '$25 per fill', '$30', '$45', '$99', '$150', '$2026', '$64111', '$855', '$2045', '$14'];
  const leaked = invented.filter((c) => findUnmatchedClaims(`You pay ${c}.`, noisy).length === 0);
  check('C2: invented prices are flagged despite id/timestamp/zip/phone/url noise', leaked.length === 0, `passed: ${leaked.join(', ') || 'none'}`);
  check('C2: the one real figure still passes ($3,000 and $3K)', findUnmatchedClaims('The cap is $3,000 a year ($3K).', noisy).length === 0);
}
{
  // Real figures written inside free text (program terms) still count.
  const textFacts = buildAllowedFacts({
    retrievedContext: { exploits: [{ title: 'PAP', eligibility_notes: 'Household income up to 400% FPL; saves up to $13,000 a year; $35 per month cap.' }] },
    profile: null,
  });
  check('C2: numbers inside program text are allowed', findUnmatchedClaims('If income is under 400% FPL you could save up to $13,000, or pay $35 a month.', textFacts).length === 0);
  check('C2: decimal money matches with or without trailing zero', findUnmatchedClaims('About $13.50 per fill.', buildAllowedFacts({ retrievedContext: { ranked_pathways: [{ monthlyCostUsd: 13.5 }] }, profile: null })).length === 0);
}
check('C2: verification dates and plain years in the reply are not flagged', findUnmatchedClaims('Verified 2026-10-05; the 2026 Part D cap applies.', facts).length === 0);
check('C2: a year written as money is still checked', findUnmatchedClaims('That costs $2025.', facts).includes('$2025'));
check('C2: phone with a leading 1- is not flagged', findUnmatchedClaims('Call 1-855-354-7847 today.', facts).length === 0);

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
