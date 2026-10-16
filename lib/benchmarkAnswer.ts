// What Arik says for a drug that has only a NADAC benchmark (docs/kimi/
// DRUG_DATA_TOP200.md Step 5, the recommended answer shape). Built in
// code, no model call: the benchmark is a fact about what PHARMACIES pay,
// never the patient's price, and it is worded that way every time.
//
// Shape: "no verified price you'd pay" -> the benchmark per unit with its
// week -> "cash prices are usually higher" -> ONE next step (a generic:
// what to ask the pharmacy; a brand: Arik checks manufacturer programs).
// No 30-day figure: that needs the dose, which Arik doesn't assume. For
// pills (EA) the cost of 30 at that rate is shown, labeled as arithmetic.

export interface BenchmarkRow {
  price_usd: number | string;
  pricing_unit: 'EA' | 'ML' | 'GM' | string | null;
  as_of_date: string | null;
  observed_at?: string | null;
  rate_class?: string | null;   // NADAC 'B' | 'G' | 'B-ANDA' | 'B-BIO'
}

const UNIT = {
  en: { EA: 'pill or unit', ML: 'milliliter', GM: 'gram' } as Record<string, string>,
  es: { EA: 'pastilla o unidad', ML: 'mililitro', GM: 'gramo' } as Record<string, string>,
};

const money = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function weekOf(iso: string, lang: 'en' | 'es'): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export interface BenchmarkSummary {
  asOf: string;
  units: { unit: string; low: number; high: number }[];   // most rows first
}

// The latest week only. A generic uses NADAC's generic rows ('G') and a
// brand its brand rows ('B...') when the week has any; otherwise all rows.
// One line per pricing unit (a drug can come as tablets AND pens).
export function summarizeBenchmarks(rows: BenchmarkRow[], isBrand = false): BenchmarkSummary | null {
  const valid = rows
    .map((r) => ({ price: Number(r.price_usd), unit: String(r.pricing_unit ?? '').toUpperCase(), asOf: r.as_of_date ?? r.observed_at ?? null, cls: String(r.rate_class ?? '').toUpperCase() }))
    .filter((r) => Number.isFinite(r.price) && r.price > 0 && ['EA', 'ML', 'GM'].includes(r.unit) && r.asOf);
  if (valid.length === 0) return null;
  const asOf = valid.map((r) => r.asOf!).sort().at(-1)!;
  let week = valid.filter((r) => r.asOf === asOf);
  const preferred = week.filter((r) => (isBrand ? r.cls.startsWith('B') : r.cls === 'G'));
  if (preferred.length > 0) week = preferred;
  const byUnit = new Map<string, number[]>();
  for (const r of week) {
    if (!byUnit.has(r.unit)) byUnit.set(r.unit, []);
    byUnit.get(r.unit)!.push(r.price);
  }
  const units = [...byUnit.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([unit, prices]) => ({ unit, low: Math.min(...prices), high: Math.max(...prices) }));
  return { asOf, units };
}

export function benchmarkOnlyAnswer(input: { drug: string; isBrand: boolean; rows: BenchmarkRow[]; lang: 'en' | 'es' }): string | null {
  const s = summarizeBenchmarks(input.rows, input.isBrand);
  if (!s) return null;
  const { drug, lang } = input;
  const range = (u: { low: number; high: number }) =>
    u.low === u.high ? money(u.low) : lang === 'es' ? `entre ${money(u.low)} y ${money(u.high)}` : `${money(u.low)} to ${money(u.high)}`;
  const parts = s.units.map((u) => `${lang === 'es' ? '' : 'about '}${range(u)} ${lang === 'es' ? 'por' : 'per'} ${UNIT[lang][u.unit]}`.trim());
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}${lang === 'es' ? ' y ' : ', and '}${parts.at(-1)}`;
  const pills = s.units.find((u) => u.unit === 'EA');
  const thirty = pills ? Math.round(pills.low * 30 * 100) / 100 : null;

  if (lang === 'es') {
    return [
      `Todavía no tengo un precio verificado de lo que usted pagaría por ${drug}.`,
      `Como referencia: las farmacias pagan ${joined} (NADAC, la encuesta del gobierno sobre lo que pagan las farmacias, semana del ${weekOf(s.asOf, lang)}).${thirty != null ? ` A ese costo, 30 pastillas le cuestan a la farmacia desde ${money(thirty)}.` : ''} Los precios en efectivo suelen ser más altos.`,
      input.isBrand
        ? `Siguiente paso: voy a buscar programas del fabricante para ${drug}.`
        : `Siguiente paso: pregunte en la farmacia: "¿Cuál es su precio en efectivo para ${drug}? ¿Y cuánto sería mi copago con el seguro?" Pague lo que sea más bajo.`,
    ].join('\n\n');
  }
  return [
    `I don't have a verified price you'd pay for ${drug} yet.`,
    `For reference, pharmacies pay ${joined} for it (NADAC, the government's survey of what pharmacies pay, week of ${weekOf(s.asOf, lang)}).${thirty != null ? ` At that rate, 30 pills cost the pharmacy from ${money(thirty)}.` : ''} Cash prices are usually higher than that.`,
    input.isBrand
      ? `Next step: I'll check for manufacturer programs for ${drug}.`
      : `Next step: ask the pharmacy, "What's your cash price for ${drug}? And what would my copay be with insurance?" Then pay whichever is lower.`,
  ].join('\n\n');
}
