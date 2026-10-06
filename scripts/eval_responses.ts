// Response-model eval (M04-AC3). Runs the 12 ranking eval cases through
// the chat route's response path - generateResponse() with the same
// grounded RETRIEVED_CONTEXT the route builds - and checks the MODEL's
// answer against the deterministic ranking output:
//   1. recommended option and price match the ranking engine's winner
//      (null-winner cases must hedge, never name a confident winner)
//   2. no $ number appears that is not in the retrieved data
//   3. no other drug's program is named
//   4. trust receipt present (boundary line + ---DETAILS--- marker)
// The grading logic is mechanical; ground truth stays the owner-supplied
// expected.* in eval_ranking_cases.mjs (nothing self-grades).
//
// Run: npx tsx scripts/eval_responses.ts [--model <slug>] [--cases id,id]
// Token/cost accounting prints at the end (pricing per token verified
// against the OpenRouter models API 2026-10-05).
import { RANKING_EVAL_CASES } from './eval_ranking_cases.mjs';
import { readFileSync } from 'node:fs';

// Load .env.local BEFORE importing anything that reads process.env.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
  if (m && !m[1].startsWith('#')) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const argv = process.argv.slice(2);
const modelOverride = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : null;
const onlyCases = argv.includes('--cases') ? argv[argv.indexOf('--cases') + 1].split(',') : null;

// USD per token (models API, 2026-10-05). Cache reads are 0.1x prompt,
// cache writes 1.25x prompt (Anthropic pass-through pricing).
const PRICING: Record<string, { prompt: number; completion: number }> = {
  'anthropic/claude-sonnet-4.6': { prompt: 3e-6, completion: 15e-6 },
  'anthropic/claude-sonnet-5.5': { prompt: 2e-6, completion: 10e-6 },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Distinctive fragments of a program title: the head before " - ..." and
// any (...) alias, e.g. "Eliquis Direct-to-Patient Program (Eliquis 360
// Support)" -> ["eliquis direct to patient program", "eliquis 360 support"].
const fragCandidates = (title: string): string[] => {
  const head = title.split(' - ')[0];
  const out = [norm(head.split('(')[0])];
  const inner = head.match(/\(([^)]+)\)/)?.[1];
  if (inner) out.push(norm(inner));
  return out.filter((f) => f.length > 0);
};

async function main() {
  const { MODEL_TIERS } = await import('../lib/modelConfig');
  if (modelOverride) {
    console.log(`response tier overridden for this run: ${MODEL_TIERS.response.slug} -> ${modelOverride}`);
    MODEL_TIERS.response = { ...MODEL_TIERS.response, slug: modelOverride };
  }
  const modelUsed = MODEL_TIERS.response.slug.replace(/:floor$/, '');
  const price = PRICING[modelUsed];
  if (!price) throw new Error(`no pricing entry for ${modelUsed} - add it from the models API, never guess`);

  const { rankSavingsPathsForDrug } = await import('../lib/ranking');
  const { partitionCopayCardsForInsurance, COPAY_CARD_BLOCK_REASON } = await import('../lib/medicareEligibility');
  const { buildPromptRetrievedContext } = await import('../lib/chatRetrieval');
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');
  const { generateGroundedResponse } = await import('../app/api/chat/route');
  type ModelUsage = import('../lib/callModel').ModelUsage;

  // Every exploit title, for the foreign-program check.
  const { data: allExploits } = await supabaseAdmin().from('exploits').select('title, drugs(name)');

  let passed = 0;
  let failed = 0;
  let guardTrips = 0;
  let guardFallbacks = 0;
  const usages: ModelUsage[] = [];
  const cases = RANKING_EVAL_CASES.filter((k: any) => !onlyCases || onlyCases.includes(k.id));

  for (const kase of cases as any[]) {
    const { drugName, insuranceType, stateCode } = kase.input;
    const exp = kase.expected;

    // Same loading as scripts/eval_ranking.ts.
    const { data: drugs } = await supabaseAdmin().from('drugs').select('id').ilike('name', drugName).limit(1);
    const drugId = drugs?.[0]?.id;
    const [{ data: exploits }, { data: prices }] = drugId
      ? await Promise.all([
          supabaseAdmin().from('exploits').select('*, sources!exploits_source_id_fkey(*)').eq('drug_id', drugId).eq('status', 'active'),
          supabaseAdmin().from('price_points').select('*, sources(*)').eq('drug_id', drugId),
        ])
      : [{ data: [] }, { data: [] }];

    const { viable, blocked } = partitionCopayCardsForInsurance(exploits ?? [], insuranceType);
    const ranking = await rankSavingsPathsForDrug({
      drugName,
      patient: { insuranceType, stateCode, drugCovered: kase.input.drugCovered ?? null },
      exploits: exploits ?? [],
      pricePoints: prices ?? [],
    });

    // The route's consent gates read price_sources per row (db/022).
    const srcIds = [...new Set((prices ?? []).map((p: any) => p.price_source_id).filter(Boolean))] as string[];
    const { data: priceSourceRows } = srcIds.length
      ? await supabaseAdmin().from('price_sources').select('id, name, enabled, max_staleness_hours, allow_patient_display, allow_ai_processing').in('id', srcIds)
      : { data: [] as any[] };
    const priceSources = Object.fromEntries((priceSourceRows ?? []).map((s: any) => [s.id, s]));
    const { payload: retrievedContext } = buildPromptRetrievedContext({
      exploits: viable,
      prices: prices ?? [],
      accumulators: [],
      counterGuidance: [],
      blockedCards: blocked,
      blockReason: COPAY_CARD_BLOCK_REASON,
      rankedPathways: ranking,
      priceSources,
    });

    const context = {
      profile: { insurance_type: insuranceType, state: stateCode },
      medications: [],
      exploits: viable,
      blockedCards: blocked,
      prices: prices ?? [],
      priceSources: priceSourceRows ?? [],
      rankedPathways: ranking,
    };
    let text: string;
    try {
      // The full production response path: model + grounding guard +
      // code-appended boundary line and trust receipt.
      const result = await generateGroundedResponse({
        message: `I take ${drugName}. What are my options?`,
        context, history: [], lang: 'en', format: 'standard',
        blockedNote: '', ranking,
        onUsage: (u: ModelUsage) => usages.push(u),
      });
      text = result.text;
      guardTrips += result.guardTrips;
      if (result.fellBack) guardFallbacks++;
    } catch (e) {
      // A failed/truncated model call is a failed case, not a crashed run.
      console.log(`FAIL ${kase.id}: model call error: ${(e as Error).message.slice(0, 120)}`);
      failed++;
      continue;
    }

    // Grade what the patient would see: the route appends the boundary
    // line deterministically when the model drops it (route.ts:405-411).
    // ---DETAILS--- has no code guarantee - a truncated receipt still fails.
    let graded = text;
    if (!/what i can.t guarantee/i.test(graded)) {
      graded += "\n\nWhat I can't guarantee: program enrollment decisions, pharmacy acceptance, and the exact final price at the counter.";
    }

    const problems: string[] = [];
    const normText = norm(graded);

    // 1. winner + winner's price
    if (exp.winnerTitle === null) {
      if (!/pending|not confirmed|unverified|blocked|no confident|can't confirm/i.test(graded)) {
        problems.push('null-winner case: no pending/blocked hedge found');
      }
    } else {
      const wfs = fragCandidates(exp.winnerTitle);
      if (!wfs.some((f) => normText.includes(f))) problems.push(`winner not recommended (missing "${wfs[0]}")`);
      const w = ranking.winner;
      const figs = [w?.monthlyCostUsd, w?.projectedAnnualCostUsd].filter((n) => n != null) as number[];
      const figHit = figs.some((n) =>
        graded.includes(`$${Number(n.toFixed(2)).toLocaleString('en-US')}`) ||
        graded.includes(`$${Math.round(n).toLocaleString('en-US')}`) ||
        graded.includes(`$${n}`));
      if (w && figs.length > 0 && !figHit) {
        problems.push(`winner price missing (monthly $${w.monthlyCostUsd} / annual $${w.projectedAnnualCostUsd})`);
      }
    }

    // 2. no invented $ numbers (every $ figure must exist in the data the
    // model saw; commas normalized)
    const allowed = new Set(
      [...JSON.stringify({ retrievedContext, profile: context.profile }).matchAll(/\d[\d,]*(?:\.\d+)?/g)]
        .map((m) => m[0].replace(/,/g, '')),
    );
    // "$13K" is the retrieved 13,000 abbreviated, not an invention - expand
    // it before checking. A bare "$13" with no K still gets checked as 13.
    const found: string[] = [];
    for (const m of graded.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?[kK]\b/g)) found.push(String(Number(m[1].replace(/,/g, '')) * 1000));
    for (const m of graded.matchAll(/\$\s?([\d,]+(?:\.\d+)?)(?!\s?[kK]\b)/g)) found.push(m[1].replace(/,/g, ''));
    const invented = [...new Set(found)].filter((f) => !allowed.has(f));
    if (invented.length > 0) problems.push(`invented number(s): ${invented.map((f) => `$${f}`).join(', ')}`);

    // 3. no other drug's program named
    for (const e of (allExploits ?? []) as any[]) {
      if (e.drugs?.name === drugName) continue;
      const f = fragCandidates(e.title)[0];
      if (f.length > 6 && normText.includes(f)) problems.push(`foreign program named: "${e.title}"`);
    }

    // 4. trust receipt
    if (!/what i can.t guarantee/i.test(graded)) problems.push('boundary line missing');
    if (!graded.includes('---DETAILS---')) problems.push('---DETAILS--- marker missing');

    const deduped = [...new Set(problems)];
    if (deduped.length === 0) { console.log(`PASS ${kase.id}`); passed++; }
    else {
      console.log(`FAIL ${kase.id}: ${deduped.join('; ')}`);
      if (argv.includes('--verbose')) {
        console.log(`  [tail] ...${graded.slice(-400).replace(/\n/g, ' | ')}`);
      }
      failed++;
    }
  }

  const cost = usages.reduce((sum, u) => {
    const uncached = Math.max(0, u.promptTokens - u.cachedTokens - u.cacheCreationTokens);
    return sum + uncached * price.prompt + u.cachedTokens * price.prompt * 0.1 +
      u.cacheCreationTokens * price.prompt * 1.25 + u.completionTokens * price.completion;
  }, 0);
  const turns = usages.length || 1;
  console.log(`\nmodel: ${modelUsed}`);
  console.log(`${passed} passed, ${failed} failed`);
  console.log(`grounding guard: ${guardTrips} trip(s), ${guardFallbacks} fallback(s)`);
  console.log(`cost: $${cost.toFixed(4)} total over ${usages.length} turns; avg $${(cost / turns).toFixed(4)}/turn`);
  console.log(`tokens: prompt=${usages.reduce((s, u) => s + u.promptTokens, 0)} cached=${usages.reduce((s, u) => s + u.cachedTokens, 0)} completion=${usages.reduce((s, u) => s + u.completionTokens, 0)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
