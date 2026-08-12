// scripts/reconcile_state_law_passes.mjs
// Part B1/B2/B4 of the 2026-08-11 state-law reconciliation ticket.
//
// What this is for: three independent AI research passes on state copay
// accumulator-ban laws disagree with each other. This script parses all
// three markdown tables (docs/research/state-law-pass-1..3.md) into one
// per-jurisdiction structure, diffs them, and buckets each of the 52
// jurisdictions (50 states + DC + PR) as Agree / Partial / Disagree.
// Called by: manual run (`node scripts/reconcile_state_law_passes.mjs`).
// Calls: nothing but fs. NEVER touches the database — loading is a
// separate, human-gated step (docs/build-plans/state-law-reconciliation-plan.md).
//
// Outputs:
//   docs/research/state-law-reconciliation.json    — machine-readable diff, feeds the eventual loader
//   docs/build-plans/state-law-review-priority.md  — the hand-verification worklist (Disagree first)
//
// Value normalization: Y / N / M. M = the pass hedged (unresolved,
// "regulatory effects noted", "mixed/partial") rather than asserting Y or N.
// Disagree requires a hard Y from at least one pass AND a hard N from
// another — hedges alone land in Partial. Pass 1 lumps non-listed states
// into "Other 25 States | N": those become IMPLIED N (weaker than an
// explicit N — pass 1's data may predate 2025 enactments) and are flagged.

import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const PASS_FILES = [
  'docs/research/state-law-pass-1.md',
  'docs/research/state-law-pass-2.md',
  'docs/research/state-law-pass-3.md',
];

// Canonical 52 jurisdictions. Order = output order.
const STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'],
  ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];
const NAME2CODE = Object.fromEntries(STATES.map(([c, n]) => [n, c]));

// Current seed values from the unapplied 010 file (AIDS Institute 2026
// aggregator seed) — the reconciliation exists to update THESE rows, so the
// review list annotates each state with what the seed currently claims.
const SEED = {
  CT: 'yes', DE: 'yes', IL: 'yes', IA: 'yes', LA: 'yes', NJ: 'yes', NM: 'yes',
  NY: 'yes', OK: 'yes', VA: 'yes', WV: 'yes', PR: 'yes', AZ: 'yes', AR: 'yes',
  CO: 'yes', DC: 'yes', GA: 'yes', IN: 'yes', KY: 'yes', ME: 'yes', MD: 'yes',
  NC: 'yes', ND: 'yes', OR: 'yes', TN: 'yes', TX: 'yes', WA: 'yes', VT: 'yes',
  AL: 'no', AK: 'no', CA: 'no', FL: 'no', HI: 'no', ID: 'no', MA: 'no',
  MI: 'no', MN: 'no', MS: 'no', MO: 'no', MT: 'no', NH: 'no', PA: 'no',
  RI: 'no', SC: 'no', SD: 'no', UT: 'no', WI: 'no', WY: 'no',
  NE: 'unknown', NV: 'partial', OH: 'pending',
};

const NULL_CITATION = /^(—|-|none|n\/a|not retrieved|citation not retrieved|primary citation not retrieved|regulation citation not retrieved)$/i;

// Pull only the Part 1 table region, then only its markdown rows.
function tableRows(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /Part 1/.test(l));
  const end = lines.findIndex((l, i) => i > start && /Part 2/.test(l));
  return lines
    .slice(start === -1 ? 0 : start, end === -1 ? lines.length : end)
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter(
      (cells) =>
        cells.length >= 3 &&
        !/^:?-+:?$/.test(cells[0].replace(/\s/g, '')) && // separator row
        !/state/i.test(cells[0]), // header row
    );
}

function cleanCitation(raw) {
  if (!raw || NULL_CITATION.test(raw)) return null;
  return raw;
}

function parsePass1(text) {
  const out = {};
  for (const [st, hasLaw, cit, date, erisa, carve, source] of tableRows(text)) {
    if (!/^[A-Z]{2}$/.test(st)) continue; // skips "Other 25 States" lump row
    out[st] = {
      has_law: hasLaw.startsWith('Y') ? 'Y' : 'N',
      citation: cleanCitation(cit),
      effective_date: date || null,
      erisa_scope: erisa || null,
      carve_outs: carve || null,
      source: source || null,
      implied: false,
    };
  }
  // "Other 25 States | N": any jurisdiction pass 1 didn't name individually
  // is an IMPLIED N — weaker evidence than an explicit "no law" answer.
  for (const [code] of STATES) {
    if (!out[code]) {
      out[code] = {
        has_law: 'N', citation: null, effective_date: null, erisa_scope: null,
        carve_outs: null, source: 'pass-1 "Other 25 States" lump', implied: true,
      };
    }
  }
  return out;
}

function parsePass2(text) {
  const out = {};
  for (const [st, hasLaw, cit, date, erisa, carve, source] of tableRows(text)) {
    const code = NAME2CODE[st];
    if (!code) continue;
    const v = /^Y/i.test(hasLaw) ? 'Y' : /unresolved/i.test(hasLaw) ? 'M' : 'N';
    out[code] = {
      has_law: v,
      citation: cleanCitation(cit),
      effective_date: cleanCitation(date),
      erisa_scope: cleanCitation(erisa),
      carve_outs: cleanCitation(carve),
      source: source || null,
      implied: false,
      raw: hasLaw,
    };
  }
  return out;
}

function parsePass3(text) {
  const out = {};
  for (const [st, hasLaw, cit, date, erisa, carve, source] of tableRows(text)) {
    const code = NAME2CODE[st];
    if (!code) continue;
    // "Y..." → Y; "N..." → N; anything else (Regulatory…, Mixed/partial…,
    // Partial/mixed…) is a hedge, not an answer.
    const v = /^Y/i.test(hasLaw) ? 'Y' : /^N/i.test(hasLaw) ? 'N' : 'M';
    out[code] = {
      has_law: v,
      citation: cleanCitation(cit),
      effective_date: cleanCitation(date),
      erisa_scope: cleanCitation(erisa),
      carve_outs: cleanCitation(carve),
      source: source || null,
      implied: false,
      raw: hasLaw,
    };
  }
  return out;
}

// --- citation compatibility ---------------------------------------------
// Two citations are COMPATIBLE when they demonstrably reference the same
// statute or bill (exact section-token match, shared bill number, or a
// plain section token that is the paren-stripped form of the other — e.g.
// "134/30" vs "134/30(d)"). Subsection-level differences where BOTH sides
// carry parentheticals (3216(i)(36) vs 3216(i)(37)) count as CONFLICTS and
// go to human review — cheap to check, dangerous to wave through.
function citationTokens(cit) {
  const statutes = new Set();
  const bills = new Set();
  for (const m of cit.matchAll(/§+\s*([0-9A-Za-z][\w.\-/:]*(?:\(\w+\))*)/g)) statutes.add(m[1]);
  for (const m of cit.matchAll(/\b(\d\w*(?:[-./:]\w+)+(?:\(\w+\))*)\b/g)) statutes.add(m[1]);
  for (const m of cit.matchAll(/\b(HB|SB|AB|SF|HF|LD|H|S|B|PA|Act)\s*\.?\s*(?:No\.?\s*)?(\d[\d-]*)/gi)) {
    bills.add((m[1] + m[2]).toUpperCase().replace(/[\s.]/g, ''));
  }
  statutes.delete('');
  // Drop short tokens: title-level fragments like Maine's "24-A" (title
  // number, not a section) otherwise produce false "compatible" matches.
  return { statutes: [...statutes].filter((t) => t.replace(/\(\w+\)/g, '').length >= 5), bills: [...bills] };
}

function citationsCompatible(a, b) {
  const ta = citationTokens(a);
  const tb = citationTokens(b);
  if (ta.bills.some((x) => tb.bills.includes(x))) return true;
  for (const sa of ta.statutes) {
    for (const sb of tb.statutes) {
      if (sa === sb) return true;
      const stripA = sa.replace(/\(\w+\)/g, '');
      const stripB = sb.replace(/\(\w+\)/g, '');
      const aHasParen = sa !== stripA;
      const bHasParen = sb !== stripB;
      // cross-match only when at least one side had no parenthetical
      if (stripA === stripB && (!aHasParen || !bHasParen)) return true;
    }
  }
  return false;
}

// --- bucketing ------------------------------------------------------------
function bucketFor(p1, p2, p3) {
  const vals = [p1.has_law, p2.has_law, p3.has_law];
  const hardY = vals.filter((v) => v === 'Y').length;
  const hardN = vals.filter((v) => v === 'N').length;
  if (hardY > 0 && hardN > 0) return { bucket: 'Disagree', citation_status: 'n/a' };
  if (hardY === 3) {
    const cits = [p1.citation, p2.citation, p3.citation].filter(Boolean);
    if (cits.length < 2) return { bucket: 'Partial', citation_status: 'single_citation' };
    const pairs = [[p1, p2], [p1, p3], [p2, p3]].filter(([a, b]) => a.citation && b.citation);
    const ok = pairs.every(([a, b]) => citationsCompatible(a.citation, b.citation));
    return ok
      ? { bucket: 'Agree', citation_status: 'compatible' }
      : { bucket: 'Partial', citation_status: 'conflict' };
  }
  if (hardN === 3) return { bucket: 'Agree', citation_status: 'n/a' };
  return { bucket: 'Partial', citation_status: 'hedged' }; // M present, no hard conflict
}

// --- run ------------------------------------------------------------------
const [t1, t2, t3] = PASS_FILES.map((f) => readFileSync(new URL(f, ROOT), 'utf8'));
const passes = { p1: parsePass1(t1), p2: parsePass2(t2), p3: parsePass3(t3) };

// Hand-written verification notes for states that need more than a
// citation-format check. Keyed by state code, surfaced in the review doc.
const NOTES = {
  CA: 'p1 offers a specific 2025 citation (AB 2180, two code sections); p2/p3 found nothing in core lists. Seed says no. One legislature-site lookup settles this — verify first (large state).',
  IA: 'p2+p3 say Y (SF 383, eff. July 1 2025); p1 omits IA (implied N, likely stale data). Seed already says yes. Likely a genuine 2025 enactment — confirm statute text.',
  ND: 'p2+p3 say Y (HB 1216, eff. 2025/2026); p1 omits ND (implied N, likely stale). Seed already says yes. Confirm statute text.',
  NE: 'p3 claims Neb. Rev. Stat. § 44-4606(5) via CT OLR; p1/p2 say no. Seed carries a pre-existing conflict flag (AIDS Institute 2026 omits NE). Must resolve against statute text.',
  NV: 'All three circle a REGULATORY (not statutory) mechanism: p2 says Y-but-regulation, p3 "regulatory effects noted", p1 implied N. Seed says partial. Needs a classification decision (separate mechanism class), not just a citation.',
  PA: 'p1 claims 40 P.S. § 3811 (HB 1564) eff. Jan 1 2025; p2/p3 say no enacted law (seed note: HB 2226 merely introduced Feb 2026). Verify whether any 2025 PA enactment exists.',
  IN: 'All three say Y — NOT a Y/N disagreement (the ticket expected it to be). The conflict is legislative history: p1 cites HB 1149 (eff. 2023); p3 cites HB 1604 (2025, eff. after Dec 31 2025 — matches p2\'s date). Likely original law + later expansion; confirm which sections are live.',
  DC: 'p1 gives D.C. Code § 31-3303.14 (B 24-0738, 2023); p3 gives D.C. Law 25-26; p2 is unresolved (NCSL says DC has legislation, Triage had no row). Probably Y — confirm citation.',
  MN: 'p3 hedges: "regulatory / rate-filing effects noted; not full statutory ban". p1/p2 say N. Treat as N unless a statute surfaces.',
  MS: 'p3 hedges: "mixed/partial notes in some 2026 lists" (inconsistent secondary). p1/p2 say N.',
  SC: 'p3 hedges: "partial/mixed in some lists". Seed note: H.3934/S.330 pending as of Jan 2026. p1/p2 say N.',
  PR: 'All three say Y, but citations cannot be format-matched (p1: Act No. 129-2020; p3: Laws of P.R. 26 § 4.070(B)). Likely the same law — confirm.',
  NJ: 'p1 cites N.J.S.A. 17B:27F-12 (A 536/S 1616); p3 cites S3818 (signed ~early 2026). Different bill numbers entirely. Seed note says signed Jan 13 2026. Confirm which act is live law.',
};

const records = STATES.map(([code, name]) => {
  const p1 = passes.p1[code] ?? { has_law: 'M', citation: null, note: 'absent from pass' };
  const p2 = passes.p2[code] ?? { has_law: 'M', citation: null, note: 'absent from pass' };
  const p3 = passes.p3[code] ?? { has_law: 'M', citation: null, note: 'absent from pass' };
  const { bucket, citation_status } = bucketFor(p1, p2, p3);
  return { code, name, seed: SEED[code], bucket, citation_status, note: NOTES[code] ?? null, p1, p2, p3 };
});

const disagree = records.filter((r) => r.bucket === 'Disagree');
const partial = records.filter((r) => r.bucket === 'Partial');
const agree = records.filter((r) => r.bucket === 'Agree');

// --- JSON artifact (feeds the eventual, separately-gated loader) ----------
writeFileSync(
  new URL('docs/research/state-law-reconciliation.json', ROOT),
  JSON.stringify({ generated: new Date().toISOString(), passes: PASS_FILES, records }, null, 2),
);

// --- review-priority markdown ---------------------------------------------
const yn = (p) => (p.implied ? 'N (implied — state not listed individually)' : p.has_law + (p.has_law === 'M' ? ` (hedged: "${p.raw ?? 'absent'}")` : ''));
const cell = (s) => (s ?? '—').replace(/\|/g, '/');

let md = `# State-Law Review Priority — generated by scripts/reconcile_state_law_passes.mjs
Source data: docs/research/state-law-pass-{1,2,3}.md (three independent passes, 2026-08-11).
Every value below remains SECONDARY corroboration — nothing here is statute-verified,
and nothing has been written to the live database. Loading rules + stop line:
docs/build-plans/state-law-reconciliation-plan.md.

Bucket counts: **Disagree ${disagree.length} · Partial ${partial.length} · Agree ${agree.length}** (52 jurisdictions).

## 1. Disagree (${disagree.length}) — hand-verify these FIRST

Hard Y from at least one pass vs hard N from another. Each needs a
legislature-site statute-text check before the seed row can change.

`;
for (const r of disagree) {
  md += `### ${r.code} — ${r.name} (current seed: ${r.seed})
| Pass | Has law | Citation | Effective date |
|---|---|---|---|
| 1 (Gemini) | ${yn(r.p1)} | ${cell(r.p1.citation)} | ${cell(r.p1.effective_date)} |
| 2 | ${yn(r.p2)} | ${cell(r.p2.citation)} | ${cell(r.p2.effective_date)} |
| 3 | ${yn(r.p3)} | ${cell(r.p3.citation)} | ${cell(r.p3.effective_date)} |

`;
  if (r.note) md += `**Verify:** ${r.note}\n\n`;
}

const citConflicts = partial.filter((r) => r.citation_status === 'conflict');
const hedged = partial.filter((r) => r.citation_status === 'hedged');
const single = partial.filter((r) => r.citation_status === 'single_citation');

md += `## 2. Partial (${partial.length})

### 2a. All three say Y, but citations conflict (${citConflicts.length})
Pass 2 retrieved no primary citations at all, so the conflict is always
pass 1 vs pass 3. Same-law-different-format is possible for each; confirm
against current statute text.

| State | Pass 1 citation | Pass 3 citation | Note |
|---|---|---|---|
`;
for (const r of citConflicts) {
  md += `| ${r.code} | ${cell(r.p1.citation)} | ${cell(r.p3.citation)} | ${r.note ?? 'Confirm which citation is current.'} |\n`;
}

md += `
### 2b. Hedged / unresolved answers (${hedged.length})
No hard Y-vs-N conflict, but at least one pass refused to commit.

| State | p1 | p2 | p3 | Note |
|---|---|---|---|---|
`;
for (const r of hedged) {
  md += `| ${r.code} | ${yn(r.p1)} | ${yn(r.p2)} | ${yn(r.p3)} | ${r.note ?? ''} |\n`;
}

if (single.length > 0) {
  md += `
### 2c. Only one pass provided a citation (${single.length})
`;
  for (const r of single) md += `- ${r.code} (${r.name})\n`;
}

const agreeY = agree.filter((r) => r.p1.has_law === 'Y');
const agreeN = agree.filter((r) => r.p1.has_law === 'N');
md += `
## 3. Agree (${agree.length}) — lower priority, spot-check only

- **Y with compatible citations (${agreeY.length}):** ${agreeY.map((r) => r.code).join(', ')}
- **N across all three passes (${agreeN.length}):** ${agreeN.map((r) => r.code).join(', ')}

Seed-alignment notes inside Agree: OH — all three passes say N, but the seed
says "pending" (SB 207); reconcile at load time. CA/PA are NOT here — they
are in Disagree above despite the seed saying "no".
`;

writeFileSync(new URL('docs/build-plans/state-law-review-priority.md', ROOT), md);

// --- console summary --------------------------------------------------------
console.log(`Disagree: ${disagree.length}  ->  ${disagree.map((r) => r.code).join(', ')}`);
console.log(`Partial:  ${partial.length}  (citation conflicts ${citConflicts.length}, hedged ${hedged.length}, single-citation ${single.length})`);
console.log(`Agree:    ${agree.length}  (Y ${agreeY.length}: ${agreeY.map((r) => r.code).join(', ')} | N ${agreeN.length})`);
console.log(`Total:    ${records.length} jurisdictions`);
console.log('wrote docs/research/state-law-reconciliation.json');
console.log('wrote docs/build-plans/state-law-review-priority.md');
