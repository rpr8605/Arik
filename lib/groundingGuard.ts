// Grounding guard (S1 hardening, 2026-10-05). After the response model
// replies, every dollar amount, percentage, multi-digit number and known
// program name in the reply is checked against the retrieved data plus
// the ranking engine's output. On any unmatched item the model
// regenerates once with the offenders listed; if it still fails, the
// caller returns the deterministic sourced-options answer (the model's
// text is discarded). Guard trips are logged as COUNTS ONLY - never the
// offending content (it never reached the patient anyway).
//
// Deliberate boundary: bare numbers under 3 digits (doses, "2 options",
// "30 days") and phone-number shapes are never flagged - they are
// structural or patient-supplied, not claims.

export interface GuardedFacts {
  numbers: Set<string>;   // every figure the model may cite (commas stripped)
  foreignNames: string[]; // normalized known program titles NOT in this context
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const titleFrag = (title: string) => norm(title.split(' - ')[0].split('(')[0]);

export function buildAllowedFacts(input: {
  retrievedContext: unknown;
  profile: unknown;
  knownPrograms?: string[];  // every exploit title in the DB
  allowedTitles?: string[];  // titles present in this case's context
}): GuardedFacts {
  const json = JSON.stringify({ ctx: input.retrievedContext ?? null, profile: input.profile ?? null });
  const numbers = new Set(
    [...json.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '')),
  );
  const allowed = new Set((input.allowedTitles ?? []).map(titleFrag));
  const foreignNames = (input.knownPrograms ?? [])
    .map(titleFrag)
    .filter((f) => f.length > 6 && !allowed.has(f));
  return { numbers, foreignNames: [...new Set(foreignNames)] };
}

export function findUnmatchedClaims(text: string, facts: GuardedFacts): string[] {
  const bad = new Set<string>();

  // 1. Dollar amounts ("$13K" expands to 13000 before the check).
  const dollarMatches = [...text.matchAll(/\$\s?[\d,]+(?:\.\d+)?\s?[kK]?\b/g)].map((m) => m[0]);
  for (const raw of dollarMatches) {
    const numPart = raw.match(/([\d,]+(?:\.\d+)?)/)![1].replace(/,/g, '');
    const value = String(Number(numPart) * (/[kK]\s*$/.test(raw.trim()) ? 1000 : 1));
    const trimmed = value.replace(/\.0+$/, '');
    if (!facts.numbers.has(value) && !facts.numbers.has(trimmed)) bad.add(raw.trim());
  }

  // Remaining scans run on text with $ amounts and phone shapes removed.
  let rest = text;
  for (const d of dollarMatches) rest = rest.split(d).join(' ');
  rest = rest.replace(/\(?\d{3}\)?[-. )]\d{3}[-. ]\d{4}\b/g, ' ');

  // 2. Percentages.
  for (const m of rest.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
    if (!facts.numbers.has(m[1])) bad.add(`${m[1]}%`);
  }

  // 3. Bare numbers with 3+ digits (a price or limit said without the $).
  for (const m of rest.matchAll(/\b(\d{3,}(?:\.\d+)?)\b/g)) {
    if (!facts.numbers.has(m[1])) bad.add(m[1]);
  }

  // 4. Known program names from OTHER drugs (foreign to this context).
  const normText = norm(text);
  for (const f of facts.foreignNames) if (normText.includes(f)) bad.add(`program not in data: ${f}`);

  return [...bad];
}

export interface GuardOutcome {
  text: string;
  trips: number;       // 0 = clean first pass, 1 = regenerated clean, 2 = fell back
  regenerated: boolean;
  fellBack: boolean;
}

export async function withGroundingGuard(opts: {
  generate: (retryNote?: string) => Promise<string>;
  facts: GuardedFacts;
  fallback: () => string;
  log?: (line: string) => void;
}): Promise<GuardOutcome> {
  const first = await opts.generate();
  const firstBad = findUnmatchedClaims(first, opts.facts);
  if (firstBad.length === 0) return { text: first, trips: 0, regenerated: false, fellBack: false };

  const second = await opts.generate(
    'Your previous answer mentioned these items that are NOT in the retrieved data: ' +
      `${firstBad.join(', ')}. Remove every one of them and answer only from the retrieved data.`,
  );
  const secondBad = findUnmatchedClaims(second, opts.facts);
  if (secondBad.length === 0) {
    opts.log?.('[groundingGuard] trips=1 regenerated=1 fellBack=0');
    return { text: second, trips: 1, regenerated: true, fellBack: false };
  }
  opts.log?.('[groundingGuard] trips=2 regenerated=1 fellBack=1');
  return { text: opts.fallback(), trips: 2, regenerated: true, fellBack: true };
}
