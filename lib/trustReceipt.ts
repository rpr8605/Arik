// Deterministic trust receipt (S1 hardening, 2026-10-05). The receipt is
// built in CODE from the ranking engine's output and retrieved sources -
// option, price, source, verification date, exclusions. The model never
// writes it (evals showed receipt sections are what token caps truncate).
//
// Also home of buildFallbackOptions: the deterministic "here are the
// sourced options" answer the grounding guard falls back to when the
// model twice produces ungrounded figures.

interface PathwayLike {
  title: string;
  monthlyCostUsd?: number | null;
  projectedAnnualCostUsd?: number | null;
  priceSemantics?: string | null;
  oneTime?: boolean;
  source?: { title?: string | null; url?: string | null; last_verified_at?: string | null } | null;
}

const T = {
  en: {
    header: 'Why Arik believes this (every figure from the cited source):',
    perMonth: (m: string, y: string | null) => `$${m}/month${y ? ` ($${y}/year)` : ''}`,
    asLowAs: (m: string) => `as low as $${m} per fill`,
    source: (title: string, verified: string | null) =>
      `Source: ${title}${verified ? `, verified ${verified.slice(0, 10)}` : ', verification date not on file'}.`,
    pending: 'Pending verification (no number trusted yet):',
    bridge: 'One-time bridge, first fill only (not an ongoing cost):',
    firstFill: (m: string) => `$${m} for the first fill only`,
    blocked: 'Not offered for your coverage:',
    withheld: 'Withheld as stale or not display-permitted:',
    missing: 'Still missing:',
    missingNone: 'nothing - every recommendation above has a cited source and date.',
    fallbackLead: 'Here are the sourced options I can confirm:',
    fallbackNone: 'I could not confirm a sourced option from my data just now.',
    boundary:
      "What I can't guarantee: program enrollment decisions, pharmacy acceptance, and the exact final price at the counter.",
  },
  es: {
    header: 'Por qué Arik cree esto (cada cifra viene de la fuente citada):',
    perMonth: (m: string, y: string | null) => `$${m}/mes${y ? ` ($${y}/año)` : ''}`,
    asLowAs: (m: string) => `desde $${m} por recarga`,
    source: (title: string, verified: string | null) =>
      `Fuente: ${title}${verified ? `, verificado ${verified.slice(0, 10)}` : ', fecha de verificación no registrada'}.`,
    pending: 'Pendiente de verificación (ningún número confirmado aún):',
    bridge: 'Puente de una sola vez, solo la primera recarga (no es un costo continuo):',
    firstFill: (m: string) => `$${m} solo por la primera recarga`,
    blocked: 'No disponible para su cobertura:',
    withheld: 'Retenido por desactualizado o no permitido:',
    missing: 'Aún falta:',
    missingNone: 'nada - cada recomendación tiene fuente citada y fecha.',
    fallbackLead: 'Estas son las opciones con fuente que puedo confirmar:',
    fallbackNone: 'No pude confirmar una opción con fuente en mis datos ahora mismo.',
    boundary:
      'Lo que no puedo garantizar: las decisiones de inscripción del programa, la aceptación de la farmacia, ni el precio final exacto en el mostrador.',
  },
} as const;

type Strings = (typeof T)[keyof typeof T];

function money(n: number | null | undefined): string | null {
  return n == null ? null : Number(n.toFixed(2)).toLocaleString('en-US');
}

// A one-time offer never gets a monthly or yearly figure, even if an
// older caller still passes it among the ongoing pathways.
function bridgeLine(p: PathwayLike, s: Strings): string {
  const m = money(p.monthlyCostUsd);
  const src = p.source?.title ?? 'source not linked';
  return `- ${s.bridge} ${p.title}${m ? `: ${s.firstFill(m)}` : ''}. ${s.source(src, p.source?.last_verified_at ?? null)}`;
}

function pathwayLine(p: PathwayLike, s: Strings): string {
  if (p.oneTime) return bridgeLine(p, s);
  const m = money(p.monthlyCostUsd);
  const price =
    p.priceSemantics === 'as_low_as' && m
      ? s.asLowAs(m)
      : m
        ? s.perMonth(m, money(p.projectedAnnualCostUsd ?? null))
        : 'price not confirmed';
  const src = p.source?.title ?? 'source not linked';
  return `- ${p.title}: ${price}. ${s.source(src, p.source?.last_verified_at ?? null)}`;
}

export function buildTrustReceipt(input: {
  ranking: {
    ranked?: PathwayLike[];
    bridges?: PathwayLike[];
    pendingVerification?: { title: string; reason: string }[];
    blocked?: { title: string; reason: string }[];
    excludedPrices?: { label: string; reason: string }[];
  } | null;
  exploits?: PathwayLike[]; // sources used when no ranking ran
  lang: 'en' | 'es';
}): string {
  const s = T[input.lang];
  const lines: string[] = ['---DETAILS---', s.header];
  const r = input.ranking;
  if (r && (r.ranked?.length ?? 0) > 0) {
    for (const p of r.ranked!) lines.push(pathwayLine(p, s));
  } else if ((input.exploits?.length ?? 0) > 0) {
    for (const e of input.exploits!) lines.push(pathwayLine(e, s));
  }
  for (const b of r?.bridges ?? []) lines.push(bridgeLine(b, s));
  for (const p of r?.pendingVerification ?? []) lines.push(`${s.pending} ${p.title} - ${p.reason}`);
  for (const b of r?.blocked ?? []) lines.push(`${s.blocked} ${b.title}.`);
  for (const x of r?.excludedPrices ?? []) lines.push(`${s.withheld} ${x.label} (${x.reason}).`);
  const gaps = [...(r?.ranked ?? []), ...(r?.bridges ?? [])].filter((p) => !p.source?.title).map((p) => p.title);
  lines.push(`${s.missing} ${gaps.length ? gaps.join('; ') : s.missingNone}`);
  return lines.join('\n');
}

// Deterministic fallback answer for the grounding guard: options straight
// from the engine, no model wording. Boundary line included.
export function buildFallbackOptions(input: {
  ranking: { ranked?: PathwayLike[]; bridges?: PathwayLike[] } | null;
  lang: 'en' | 'es';
}): string {
  const s = T[input.lang];
  const ranked = (input.ranking?.ranked ?? []).filter((p) => !p.oneTime);
  const bridges = [...(input.ranking?.bridges ?? []), ...(input.ranking?.ranked ?? []).filter((p) => p.oneTime)];
  const lines: string[] = [ranked.length || bridges.length ? s.fallbackLead : s.fallbackNone];
  ranked.forEach((p, i) => {
    const m = money(p.monthlyCostUsd);
    lines.push(`${i + 1}. ${p.title}${m ? ` - ${s.perMonth(m, money(p.projectedAnnualCostUsd ?? null))}` : ''}`);
  });
  for (const b of bridges) {
    const m = money(b.monthlyCostUsd);
    lines.push(`${s.bridge} ${b.title}${m ? ` - ${s.firstFill(m)}` : ''}`);
  }
  lines.push('', s.boundary);
  return lines.join('\n');
}
