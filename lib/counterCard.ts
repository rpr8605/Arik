// The "At the counter" card and the cash-vs-insurance decision for the
// best path (docs/kimi/PLAN_CASH_VS_INSURANCE.md). Pure, built in code from
// the ranking row and the program row, never by the model. EN and ES.
//
// The card appears only for a cash price or a discount card (what you hand
// a pharmacist). Card numbers (BIN, PCN, group) are shown only when the
// program row carries them with a source (db/037); otherwise the card says
// where to get them. Never a placeholder.

import { coverageFrom, decideCashVsInsurance, decisionText, STRINGS, type CashVsInsuranceResult } from './rules/cashVsInsurance';

type Lang = 'en' | 'es';

export interface PathwayLike {
  kind: string;
  title: string;
  monthlyCostUsd: number | null;
  oneTime?: boolean;
  reference?: boolean;
  source?: { title?: string | null; url?: string | null; last_verified_at?: string | null } | null;
  pharmacy?: { name: string | null; distanceMiles: number | null };
}

export interface ProgramRowLike {
  title?: string;
  card_bin?: string | null;
  card_pcn?: string | null;
  card_group?: string | null;
  card_member_id_rule?: string | null;
  card_details_source_url?: string | null;
  federal_program_allowed?: string | null;
  counts_toward_deductible?: string | null;
}

export const isCounterPath = (p: PathwayLike) =>
  p.kind === 'discount_card' || (p.kind === 'price_point' && /^(cash|discount card) price\b/i.test(p.title));

export const isCashLikePath = (p: PathwayLike) => isCounterPath(p) || p.kind === 'direct_to_patient_program';

const tri = (v: string | null | undefined) => (v === 'yes' || v === 'no' ? v : 'unknown');

// The decision for one path, for this patient's coverage. Plan cost and
// deductible status are not collected yet, so insured patients are asked.
export function decisionForPath(p: PathwayLike, program: ProgramRowLike | null, insuranceType: string | null | undefined): CashVsInsuranceResult | null {
  if (!isCashLikePath(p) || p.oneTime || p.reference) return null;
  return decideCashVsInsurance({
    coverage: coverageFrom(insuranceType),
    cashPriceUsd: p.monthlyCostUsd,
    isManufacturerProgram: p.kind === 'direct_to_patient_program',
    federalProgramAllowed: tri(program?.federal_program_allowed),
    countsTowardDeductible: tri(program?.counts_toward_deductible),
  });
}

export interface CounterCard {
  heading: string;
  say: string;
  cardLines: string[];          // BIN / PCN / group / member id, sourced
  getNumbers: { text: string; url: string | null } | null;
  where: string;
  when: string;
  caveats: string[];
  ifDifferent: string;
}

const T = {
  en: {
    heading: 'At the counter',
    sayCash: (name: string) => `"I'd like to pay the cash price for this prescription${name ? `, ${name}` : ''}. Please run it as cash, not through my insurance."`,
    sayCard: (name: string) => `"I'd like to use ${name || 'this discount card'} for this prescription. Please run it with these card numbers instead of my insurance."`,
    bin: 'BIN', pcn: 'PCN', group: 'Group', member: 'Member ID',
    getNumbers: "Get the card numbers from the program's page before you go.",
    whereAt: (n: string) => `This price is for ${n}.`,
    whereAsk: 'Ask the pharmacy whether it takes this price before they fill it.',
    when: (src: string, d: string | null) => `Price checked ${d ?? '(date not on file)'} by ${src}.`,
    ifDifferent: 'If the price at the counter is different, ask them to check the quantity and that it was run as cash. If it is still different, tell Arik what you were charged.',
  },
  es: {
    heading: 'En el mostrador',
    sayCash: (name: string) => `"Quiero pagar el precio en efectivo por esta receta${name ? `, ${name}` : ''}. Por favor cóbrela en efectivo, no con mi seguro."`,
    sayCard: (name: string) => `"Quiero usar ${name || 'esta tarjeta de descuento'} para esta receta. Por favor cóbrela con estos números de tarjeta en lugar de mi seguro."`,
    bin: 'BIN', pcn: 'PCN', group: 'Grupo', member: 'Número de miembro',
    getNumbers: 'Antes de ir, busque los números de la tarjeta en la página del programa.',
    whereAt: (n: string) => `Este precio es para ${n}.`,
    whereAsk: 'Antes de que la surtan, pregunte en la farmacia si aceptan este precio.',
    when: (src: string, d: string | null) => `Precio revisado el ${d ?? '(fecha no registrada)'} por ${src}.`,
    ifDifferent: 'Si en el mostrador el precio es otro, pida que revisen la cantidad y que la cobren en efectivo. Si sigue siendo otro, dígale a Arik cuánto le cobraron.',
  },
} as const;

export function buildCounterCard(input: { path: PathwayLike; program: ProgramRowLike | null; decision: CashVsInsuranceResult | null; lang: Lang }): CounterCard | null {
  const { path, program, decision, lang } = input;
  if (!isCounterPath(path) || path.oneTime || path.reference) return null;
  // Only when cash is a live option: "use cash", or a question whose answer
  // could make it one. Never for Medicaid (bill Medicaid first).
  const askable = ['need_plan_cost', 'need_deductible_status', 'need_coverage'];
  if (decision && decision.decision !== 'use_cash' && !(decision.decision === 'ask_patient' && askable.includes(decision.reason))) return null;
  const t = T[lang];
  const card = path.kind === 'discount_card';
  const sourced = !!program?.card_details_source_url;
  const cardLines = sourced
    ? [
        program?.card_bin ? `${t.bin}: ${program.card_bin}` : null,
        program?.card_pcn ? `${t.pcn}: ${program.card_pcn}` : null,
        program?.card_group ? `${t.group}: ${program.card_group}` : null,
        program?.card_member_id_rule ? `${t.member}: ${program.card_member_id_rule}` : null,
      ].filter((x): x is string => !!x)
    : [];
  const date = path.source?.last_verified_at ? String(path.source.last_verified_at).slice(0, 10) : null;
  return {
    heading: t.heading,
    say: card ? t.sayCard(path.title) : t.sayCash(''),
    cardLines,
    getNumbers: card && cardLines.length === 0 ? { text: t.getNumbers, url: path.source?.url ?? null } : null,
    where: path.pharmacy?.name ? t.whereAt(path.pharmacy.name) : t.whereAsk,
    when: t.when(path.source?.title ?? (lang === 'es' ? 'la fuente' : 'the source'), date),
    caveats: (decision?.caveats ?? []).map((c) => STRINGS.caveat[c][lang]),
    ifDifferent: t.ifDifferent,
  };
}

export function counterCardText(c: CounterCard): string {
  return [
    `${c.heading}:`,
    c.say,
    ...c.cardLines,
    ...(c.getNumbers ? [c.getNumbers.text + (c.getNumbers.url ? ` ${c.getNumbers.url}` : '')] : []),
    c.where,
    c.when,
    ...c.caveats,
    c.ifDifferent,
  ].join('\n');
}

// The chat's code-built note for the best path: the decision, and the
// counter card when it applies. Empty when the best path isn't a cash path.
export function cashDecisionNote(input: { best: PathwayLike | null; program: ProgramRowLike | null; insuranceType: string | null | undefined; lang: Lang }): string {
  if (!input.best) return '';
  const d = decisionForPath(input.best, input.program, input.insuranceType);
  if (!d) return '';
  const card = buildCounterCard({ path: input.best, program: input.program, decision: d, lang: input.lang });
  return `\n\n${decisionText(d, input.lang)}${card ? `\n\n${counterCardText(card)}` : ''}`;
}
