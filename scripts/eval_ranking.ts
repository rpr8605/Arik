// Ranking-engine eval runner. Executes each case in
// scripts/eval_ranking_cases.mjs against the LIVE database via the same
// loader the chat route uses, then prints the engine's actual output.
// Cases with expected=null are UNGRADED — the owner supplies ground truth;
// when expected is filled in, the runner asserts against it.
// Run: npx tsx scripts/eval_ranking.ts
import { RANKING_EVAL_CASES } from './eval_ranking_cases.mjs';
import { readFileSync } from 'node:fs';

// Standalone script: tsx does not auto-load .env.local (Next does that for
// the app). Load it BEFORE importing anything that reads process.env.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (m && !m[1].startsWith('#')) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

interface Expected {
  winnerTitle?: string;
  rankedIncludes?: string[];
  rankedExcludes?: string[];
  pendingIncludes?: string[];
  blockedIncludes?: string[];
  stateNoteStatus?: string;
}

let ungraded = 0;
let passed = 0;
let failed = 0;

async function main() {
const { rankSavingsPathsForDrug } = await import('../lib/ranking');
const { supabaseAdmin } = await import('../lib/supabaseAdmin');
for (const kase of RANKING_EVAL_CASES as any[]) {
  const { drugName, insuranceType, stateCode } = kase.input;
  const { data: drugs } = await supabaseAdmin().from('drugs').select('id').ilike('name', drugName).limit(1);
  const drugId = drugs?.[0]?.id;
  const [{ data: exploits }, { data: prices }] = drugId
    ? await Promise.all([
        supabaseAdmin().from('exploits').select('*, sources!exploits_source_id_fkey(*)').eq('drug_id', drugId).eq('status', 'active'),
        supabaseAdmin().from('price_points').select('*, sources(*)').eq('drug_id', drugId),
      ])
    : [{ data: [] }, { data: [] }];

  const result = await rankSavingsPathsForDrug({
    drugName,
    patient: { insuranceType, stateCode },
    exploits: exploits ?? [],
    pricePoints: prices ?? [],
  });

  console.log(`\n=== ${kase.id} ===`);
  console.log(`situation: ${kase.situation}`);
  console.log(`ranked: ${result.ranked.map((p) => `${p.title} ($${p.monthlyCostUsd}/mo, $${p.projectedAnnualCostUsd}/yr${p.oneTime ? ', one-time' : ''})`).join(' | ') || '(none)'}`);
  console.log(`winner: ${result.winner?.title ?? '(none)'}`);
  console.log(`pendingVerification: ${result.pendingVerification.map((p) => p.title).join(' | ') || '(none)'}`);
  console.log(`notApplicable: ${result.notApplicable.map((p) => p.title).join(' | ') || '(none)'}`);
  console.log(`blocked: ${result.blocked.map((p) => p.title).join(' | ') || '(none)'}`);
  console.log(`stateNote: ${result.stateNote?.status ?? '(none)'}`);

  const exp = kase.expected as Expected | null;
  if (!exp) {
    console.log('UNGRADED — awaiting owner ground truth');
    ungraded++;
    continue;
  }
  const problems: string[] = [];
  if (exp.winnerTitle !== undefined && result.winner?.title !== exp.winnerTitle) problems.push(`winner=${result.winner?.title} expected ${exp.winnerTitle}`);
  for (const t of exp.rankedIncludes ?? []) if (!result.ranked.some((p) => p.title.includes(t))) problems.push(`ranked missing "${t}"`);
  for (const t of exp.rankedExcludes ?? []) if (result.ranked.some((p) => p.title.includes(t))) problems.push(`ranked should NOT include "${t}"`);
  for (const t of exp.pendingIncludes ?? []) if (!result.pendingVerification.some((p) => p.title.includes(t))) problems.push(`pending missing "${t}"`);
  for (const t of exp.blockedIncludes ?? []) if (!result.blocked.some((p) => p.title.includes(t))) problems.push(`blocked missing "${t}"`);
  if (exp.stateNoteStatus !== undefined && result.stateNote?.status !== exp.stateNoteStatus) problems.push(`stateNote=${result.stateNote?.status} expected ${exp.stateNoteStatus}`);
  if (problems.length === 0) { console.log('PASS'); passed++; } else { console.log(`FAIL: ${problems.join('; ')}`); failed++; }
}
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed, ${ungraded} ungraded (awaiting owner ground truth)`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
