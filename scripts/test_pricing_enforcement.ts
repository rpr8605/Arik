// Step 5 enforcement tests (build ticket 2026-10-01): staleness,
// allow_patient_display, allow_ai_processing - proven at the partition
// (lib/pricing/enforcement.ts), inside ranking (lib/ranking.ts), and at
// the exact prompt builder the chat route calls (lib/chatRetrieval.ts).
// Pure: no DB, no network. Run: npx tsx scripts/test_pricing_enforcement.ts

import { partitionPricesForConsent, type PriceSourceConsent } from '../lib/pricing/enforcement';
import { rankPathways } from '../lib/ranking';
import { buildPromptRetrievedContext } from '../lib/chatRetrieval';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const NOW = new Date('2026-10-01T00:00:00Z');
const isoDaysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

function src(over: Partial<PriceSourceConsent>): PriceSourceConsent {
  return {
    id: 's1',
    name: 'testsrc',
    enabled: true,
    max_staleness_hours: null,
    allow_patient_display: true,
    allow_ai_processing: true,
    ...over,
  };
}
function row(over: Record<string, unknown>): any {
  return { price_type: 'cash_pay', price_usd: 100, supply_days: 30, ...over };
}
const partition = (rows: any[], sourcesById: Record<string, PriceSourceConsent>) =>
  partitionPricesForConsent(rows, { sourcesById, now: NOW });

// --- 1. partition: staleness rules ---
{
  const expired = row({ id: 'r1', expires_at: '2026-09-01' });
  const fresh = row({ id: 'r2', expires_at: '2026-12-01' });
  const p = partition([expired, fresh], {});
  check('expired row -> excludedStale', p.excludedStale.length === 1 && p.excludedStale[0].row.id === 'r1');
  check('unexpired row -> allowed', p.allowed.length === 1 && p.allowed[0].id === 'r2');
}
{
  const s = src({ max_staleness_hours: 2160 }); // 90 days
  const stale = row({ id: 'r3', price_source_id: 's1', observed_at: isoDaysAgo(100) });
  const ok = row({ id: 'r4', price_source_id: 's1', observed_at: isoDaysAgo(10) });
  const p = partition([stale, ok], { s1: s });
  check('observed past max_staleness -> excludedStale, names source + limit',
    p.excludedStale.length === 1 && /max_staleness/.test(p.excludedStale[0].reason) && /testsrc/.test(p.excludedStale[0].reason), p.excludedStale[0]?.reason);
  check('observed within max_staleness -> allowed', p.allowed.length === 1 && p.allowed[0].id === 'r4');
}
{
  const s = src({ max_staleness_hours: 2160 });
  const noDate = row({ id: 'r5', price_source_id: 's1', observed_at: null });
  const p = partition([noDate], { s1: s });
  check('missing observed_at under staleness-bound source -> excludedStale (fail closed)', p.excludedStale.length === 1 && /missing observed_at/.test(p.excludedStale[0].reason));
}
{
  const s = src({ enabled: false });
  const p = partition([row({ id: 'r6', price_source_id: 's1', observed_at: isoDaysAgo(1) })], { s1: s });
  check('disabled source -> excludedStale', p.excludedStale.length === 1 && /disabled/.test(p.excludedStale[0].reason));
}

// --- 2. partition: consent flags ---
{
  const s = src({ allow_patient_display: false });
  const p = partition([row({ id: 'r7', price_source_id: 's1', observed_at: isoDaysAgo(1) })], { s1: s });
  check('allow_patient_display=false -> excludedNotDisplayable, never allowed', p.excludedNotDisplayable.length === 1 && p.allowed.length === 0);
}
{
  const s = src({ allow_ai_processing: false });
  const p = partition([row({ id: 'r8', price_source_id: 's1', observed_at: isoDaysAgo(1) })], { s1: s });
  check('allow_ai_processing=false -> excludedAi, never allowed', p.excludedAi.length === 1 && p.allowed.length === 0);
}
{
  const p = partition([row({ id: 'r9', price_source_id: 'does-not-exist', observed_at: isoDaysAgo(1) })], {});
  check('unresolvable source -> fail closed (not displayable)', p.excludedNotDisplayable.length === 1 && p.allowed.length === 0);
}
{
  const p = partition([row({ id: 'r10' })], {}); // legacy row, no source
  check('legacy null-source row -> allowed (pre-ingest behavior)', p.allowed.length === 1);
}

// --- 3. ranking: enforcement is applied before pathway construction ---
const baseExploit: any[] = [];
const patient = { insuranceType: 'uninsured', stateCode: null };
{
  const fresh = row({ price_type: 'cash_pay', price_usd: 300, price_source_id: 's1', observed_at: isoDaysAgo(5), sources: null });
  const r = rankPathways({
    exploits: baseExploit,
    pricePoints: [fresh],
    stateRow: null,
    banApplies: false,
    patient,
    priceSources: { s1: src({ max_staleness_hours: 2160 }) },
    asOf: NOW.toISOString(),
  });
  check('fresh source-tagged cash price ranks as a pathway', r.ranked.some((p) => p.kind === 'price_point'));
  check('nothing stale -> excludedPrices empty', r.excludedPrices.length === 0);
}
{
  const stale = row({ price_type: 'cash_pay', price_usd: 300, price_source_id: 's1', observed_at: isoDaysAgo(200), sources: null });
  const r = rankPathways({
    exploits: baseExploit,
    pricePoints: [stale],
    stateRow: null,
    banApplies: false,
    patient,
    priceSources: { s1: src({ max_staleness_hours: 2160 }) },
    asOf: NOW.toISOString(),
  });
  check('stale source-tagged price does NOT rank', r.ranked.length === 0);
  check('ranking reports the excluded stale price with a reason', r.excludedPrices.length === 1 && /max_staleness/.test(r.excludedPrices[0].reason), r.excludedPrices[0]?.reason);
}
{
  const nadac = row({ price_type: 'acquisition_benchmark', price_usd: 9.51, price_source_id: 's1', observed_at: isoDaysAgo(5), ndc: '00004026611', sources: null });
  const r = rankPathways({
    exploits: baseExploit,
    pricePoints: [nadac],
    stateRow: null,
    banApplies: false,
    patient,
    priceSources: { s1: src({ max_staleness_hours: 2160 }) }, // display=true here - benchmark skip must hold anyway
    asOf: NOW.toISOString(),
  });
  check('acquisition_benchmark never ranks as a pathway (benchmark, not a patient price)', r.ranked.length === 0);
}
{
  // NADAC row under its real db/022 flags: display=false -> not ranked, not displayed.
  const nadac = row({ price_type: 'acquisition_benchmark', price_usd: 9.51, price_source_id: 's1', observed_at: isoDaysAgo(5), sources: null });
  const r = rankPathways({
    exploits: baseExploit,
    pricePoints: [nadac],
    stateRow: null,
    banApplies: false,
    patient,
    priceSources: { s1: src({ allow_patient_display: false }) },
    asOf: NOW.toISOString(),
  });
  check('NADAC flags (display=false): not ranked', r.ranked.length === 0);
}

// --- 4. prompt builder: the AI/display gates at the exact function the route calls ---
{
  const aiBarred = row({ id: 'ai-1', price_type: 'cash_pay', price_usd: 42, price_source_id: 's1', observed_at: isoDaysAgo(2), ndc: '11111111111' });
  const allowed = row({ id: 'ok-1', price_type: 'cash_pay', price_usd: 50, price_source_id: 's2', observed_at: isoDaysAgo(2), ndc: '22222222222' });
  const { payload, excludedPrices } = buildPromptRetrievedContext({
    exploits: [],
    prices: [aiBarred, allowed],
    accumulators: [],
    counterGuidance: [],
    blockedCards: [],
    blockReason: 'AKS',
    rankedPathways: null,
    priceSources: { s1: src({ allow_ai_processing: false }), s2: src({}) },
    now: NOW,
  });
  const usableJson = JSON.stringify((payload as any).prices);
  check('allow_ai_processing=false: row is absent from the prompt price set', !usableJson.includes('11111111111'));
  check('allow_ai_processing=false: not even an exclusion NOTE reaches the prompt', !JSON.stringify(payload).includes('11111111111'));
  check('allow_ai_processing=false: exclusion is reported to the API caller with the reason', excludedPrices.length === 1 && /allow_ai_processing=false/.test(excludedPrices[0].reason));
  check('allowed row is present in the prompt price set', usableJson.includes('22222222222'));
}
{
  const internalOnly = row({ price_type: 'acquisition_benchmark', price_usd: 9.51, price_source_id: 's1', observed_at: isoDaysAgo(2), ndc: '33333333333' });
  const { payload } = buildPromptRetrievedContext({
    exploits: [],
    prices: [internalOnly],
    accumulators: [],
    counterGuidance: [],
    blockedCards: [],
    blockReason: 'AKS',
    rankedPathways: null,
    priceSources: { s1: src({ allow_patient_display: false }) },
    now: NOW,
  });
  check('allow_patient_display=false: row absent from the prompt price set', !JSON.stringify((payload as any).prices).includes('33333333333'));
  check('allow_patient_display=false: exclusion note carries no identifiers', !JSON.stringify(payload).includes('33333333333'));
}
{
  const stale = row({ price_type: 'cash_pay', price_usd: 42, price_source_id: 's1', observed_at: isoDaysAgo(200), ndc: '44444444444' });
  const { payload, excludedPrices } = buildPromptRetrievedContext({
    exploits: [],
    prices: [stale],
    accumulators: [],
    counterGuidance: [],
    blockedCards: [],
    blockReason: 'AKS',
    rankedPathways: null,
    priceSources: { s1: src({ max_staleness_hours: 2160 }) },
    now: NOW,
  });
  check('stale row excluded from prompt AND named in excluded_prices', !JSON.stringify((payload as any).prices).includes('44444444444') && excludedPrices.length === 1);
}
{
  // The whole-payload sweep: nothing AI-barred survives anywhere in what
  // the route serializes into groundedInput.
  const barred = row({ price_type: 'cash_pay', price_usd: 42, price_source_id: 's1', observed_at: isoDaysAgo(2), sources: { title: 'AI-BARRED-MARKER', url: 'x', last_verified_at: null } });
  const { payload } = buildPromptRetrievedContext({
    exploits: [],
    prices: [barred],
    accumulators: [],
    counterGuidance: [],
    blockedCards: [],
    blockReason: 'AKS',
    rankedPathways: null,
    priceSources: { s1: src({ allow_ai_processing: false }) },
    now: NOW,
  });
  check('PROOF: no trace of an AI-barred row anywhere in the prompt payload', !JSON.stringify(payload).includes('AI-BARRED-MARKER'));
}

// db/032: a weekly file re-confirming an old effective date keeps the row fresh.
{
  const src = { id: 'w', name: 'weekly', enabled: true, max_staleness_hours: 2160, allow_patient_display: true, allow_ai_processing: true } as any;
  const old = { price_source_id: 'w', observed_at: '2025-01-15', as_of_date: '2026-10-14' };
  const p1 = partitionPricesForConsent([old], { sourcesById: { w: src }, now: '2026-10-16T00:00:00Z' });
  check('as_of_date (this week) keeps an old effective date fresh', p1.allowed.length === 1);
  const p2 = partitionPricesForConsent([{ ...old, as_of_date: '2025-02-01' }], { sourcesById: { w: src }, now: '2026-10-16T00:00:00Z' });
  check('an old as_of_date is stale', p2.excludedStale.length === 1 && /observed 2025-02-01/.test(p2.excludedStale[0].reason));
}

console.log(failures === 0 ? '\nPRICING ENFORCEMENT: ALL PASS' : `\nPRICING ENFORCEMENT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
