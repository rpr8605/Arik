// Cash vs insurance (rx_routing_build.md Part A step 4; owner queue
// 2026-10-16; plan: docs/kimi/PLAN_CASH_VS_INSURANCE.md). Pure: decides
// whether a patient should pay a cash or discount price, use their
// insurance, or be asked first. Codes only; the words live in STRINGS
// (English and Spanish). Decided in code, never by the model.
//
// Regulation basis (docs/research/cash_vs_insurance_verification.md):
// - Medicaid, 42 CFR 447.15: participating providers accept "as payment in
//   full, the amounts paid by the agency plus any deductible, coinsurance
//   or copayment required by the plan". So at a pharmacy that takes
//   Medicaid a covered drug costs only the Medicaid copay. The line says
//   "copay", never "small" (447.53: up to 20% for non-preferred drugs
//   above 150% FPL). Owner approved this stronger line 2026-10-16; it is
//   marked for LEGAL REVIEW before launch (docs/legal_review_before_launch.md).
// - Medicare Part D, 42 CFR 423.100 "Incurred costs": only cost sharing
//   under the plan counts toward the out-of-pocket threshold, so a cash
//   purchase outside the plan does not count.

export type Coverage = 'uninsured' | 'commercial' | 'medicare' | 'medicaid' | 'unknown';
export type Tri = 'yes' | 'no' | 'unknown';
export type Decision = 'use_cash' | 'use_insurance' | 'ask_patient' | 'not_for_this_coverage';

export type ReasonCode =
  | 'uninsured_cheapest_sourced'
  | 'cash_cheaper_than_plan'
  | 'plan_cheaper_than_cash'
  | 'need_plan_cost'
  | 'need_deductible_status'
  | 'need_coverage'
  | 'no_cash_price'
  | 'medicaid_bill_medicaid_first'
  | 'medicaid_ask_if_covered'
  | 'medicaid_not_covered_confirm'
  | 'federal_program_not_allowed';

export type CaveatCode = 'may_not_count_toward_deductible' | 'counts_toward_deductible' | 'medicare_cash_not_counted' | 'deductible_not_met_oop';
export type QuestionCode = 'ask_copay' | 'ask_deductible' | 'ask_coverage' | 'ask_medicaid_covers';

// Reasons whose wording counsel must review before launch (owner,
// 2026-10-16). docs/legal_review_before_launch.md lists the same set.
export const LEGAL_REVIEW_REASONS: readonly ReasonCode[] = ['medicaid_bill_medicaid_first'];

export interface CashVsInsuranceInput {
  coverage: Coverage;
  cashPriceUsd: number | null;           // sourced cash / discount / program price for the same fill
  isManufacturerProgram: boolean;        // a drug maker's direct or cash program (DTP), not a pharmacy cash price
  planCostUsd?: number | null;           // the patient's copay/coinsurance for the same fill, if known
  deductibleMet?: Tri;
  countsTowardDeductible?: Tri;          // from the program row (db/037); default unknown
  federalProgramAllowed?: Tri;           // from the program row (db/037); default unknown
  drugCoveredByPlan?: Tri;
}

export interface CashVsInsuranceResult {
  decision: Decision;
  reason: ReasonCode;
  caveats: CaveatCode[];
  questions: QuestionCode[];
  legalReview: boolean;                  // owner-approved wording that counsel must review before launch
}

const result = (decision: Decision, reason: ReasonCode, caveats: CaveatCode[] = [], questions: QuestionCode[] = []): CashVsInsuranceResult => ({
  decision,
  reason,
  caveats,
  questions,
  legalReview: LEGAL_REVIEW_REASONS.includes(reason),
});

export function coverageFrom(insuranceType: string | null | undefined): Coverage {
  switch (insuranceType) {
    case 'uninsured':
      return 'uninsured';
    case 'employer':
    case 'marketplace':
    case 'commercial':
      return 'commercial';
    case 'medicare':
    case 'medicare_part_d':
    case 'medicare_advantage':
      return 'medicare';
    case 'medicaid':
      return 'medicaid';
    default:
      return 'unknown';
  }
}

export function decideCashVsInsurance(i: CashVsInsuranceInput): CashVsInsuranceResult {
  const cash = i.cashPriceUsd != null && Number.isFinite(i.cashPriceUsd) && i.cashPriceUsd >= 0 ? i.cashPriceUsd : null;
  const plan = i.planCostUsd != null && Number.isFinite(i.planCostUsd) && i.planCostUsd >= 0 ? i.planCostUsd : null;
  const counts = i.countsTowardDeductible ?? 'unknown';
  const deductibleCaveat: CaveatCode[] = counts === 'yes' ? ['counts_toward_deductible'] : ['may_not_count_toward_deductible'];

  // 1. Medicaid: never steered to cash for a covered drug.
  if (i.coverage === 'medicaid') {
    if (i.isManufacturerProgram && (i.federalProgramAllowed ?? 'unknown') !== 'yes') return result('not_for_this_coverage', 'federal_program_not_allowed');
    if (i.drugCoveredByPlan === 'no') return result('ask_patient', 'medicaid_not_covered_confirm', [], ['ask_medicaid_covers']);
    if (i.drugCoveredByPlan === 'yes') return result('use_insurance', 'medicaid_bill_medicaid_first');
    return result('ask_patient', 'medicaid_ask_if_covered', [], ['ask_medicaid_covers']);
  }

  // 2. Medicare: a drug maker's program needs an explicit yes for federal
  //    programs; any cash price carries the Part D limit caveat.
  if (i.coverage === 'medicare') {
    if (i.isManufacturerProgram && (i.federalProgramAllowed ?? 'unknown') !== 'yes') return result('not_for_this_coverage', 'federal_program_not_allowed');
    if (cash == null) return result(plan != null ? 'use_insurance' : 'ask_patient', plan != null ? 'plan_cheaper_than_cash' : 'no_cash_price', [], plan != null ? [] : ['ask_copay']);
    if (plan == null) return result('ask_patient', 'need_plan_cost', ['medicare_cash_not_counted'], ['ask_copay']);
    return cash < plan
      ? result('use_cash', 'cash_cheaper_than_plan', ['medicare_cash_not_counted'])
      : result('use_insurance', 'plan_cheaper_than_cash');
  }

  // 3. Commercial: ask when the plan cost or deductible status is unknown.
  if (i.coverage === 'commercial') {
    if (cash == null) return result(plan != null ? 'use_insurance' : 'ask_patient', plan != null ? 'plan_cheaper_than_cash' : 'no_cash_price', [], plan != null ? [] : ['ask_copay']);
    if (plan == null) return result('ask_patient', 'need_plan_cost', deductibleCaveat, ['ask_copay', 'ask_deductible']);
    if ((i.deductibleMet ?? 'unknown') === 'unknown') return result('ask_patient', 'need_deductible_status', deductibleCaveat, ['ask_deductible']);
    if (cash < plan) {
      const caveats: CaveatCode[] = [...deductibleCaveat];
      if (i.deductibleMet === 'no' && counts !== 'yes') caveats.push('deductible_not_met_oop');
      return result('use_cash', 'cash_cheaper_than_plan', caveats);
    }
    return result('use_insurance', 'plan_cheaper_than_cash');
  }

  // 4. Uninsured: the cheapest sourced option, no insurance caveats.
  if (i.coverage === 'uninsured') return cash == null ? result('ask_patient', 'no_cash_price') : result('use_cash', 'uninsured_cheapest_sourced');

  // 5. Unknown coverage: ask first.
  return result('ask_patient', 'need_coverage', [], ['ask_coverage']);
}

// ---------- Words (EN / ES). Every code has both. ----------

type Lang = 'en' | 'es';

export const STRINGS: {
  reason: Record<ReasonCode, Record<Lang, string>>;
  caveat: Record<CaveatCode, Record<Lang, string>>;
  question: Record<QuestionCode, Record<Lang, string>>;
} = {
  reason: {
    uninsured_cheapest_sourced: { en: 'Without insurance, this is the lowest sourced price I have.', es: 'Sin seguro, este es el precio más bajo con fuente que tengo.' },
    cash_cheaper_than_plan: { en: 'Paying this price costs less than your plan does for this fill.', es: 'Pagar este precio cuesta menos que su plan para esta receta.' },
    plan_cheaper_than_cash: { en: 'Your plan costs less for this fill, so use your insurance.', es: 'Su plan cuesta menos para esta receta, así que use su seguro.' },
    need_plan_cost: { en: "To compare, I need what your plan charges you for this drug.", es: 'Para comparar, necesito saber cuánto le cobra su plan por este medicamento.' },
    need_deductible_status: { en: 'To compare, I need to know whether you have met your deductible this year.', es: 'Para comparar, necesito saber si ya alcanzó su deducible este año.' },
    need_coverage: { en: 'Tell me what coverage you have, and I can say whether this price or your insurance is better.', es: 'Dígame qué cobertura tiene y le diré si le conviene este precio o su seguro.' },
    no_cash_price: { en: "I don't have a sourced cash price for this yet.", es: 'Todavía no tengo un precio en efectivo con fuente para esto.' },
    medicaid_bill_medicaid_first: { en: 'At a pharmacy that takes Medicaid, a drug Medicaid covers should cost you only your Medicaid copay (42 CFR 447.15). Ask the pharmacy to bill Medicaid.', es: 'En una farmacia que acepta Medicaid, un medicamento que Medicaid cubre solo debería costarle su copago de Medicaid (42 CFR 447.15). Pida a la farmacia que se lo cobre a Medicaid.' },
    medicaid_ask_if_covered: { en: 'With Medicaid, ask the pharmacy to bill Medicaid first. If Medicaid says no, tell me and we can look at other options.', es: 'Con Medicaid, pida a la farmacia que primero se lo cobre a Medicaid. Si Medicaid dice que no, dígamelo y buscamos otras opciones.' },
    medicaid_not_covered_confirm: { en: 'If the pharmacy billed Medicaid and it was turned down, tell me and we can look at other options.', es: 'Si la farmacia se lo cobró a Medicaid y lo rechazaron, dígamelo y buscamos otras opciones.' },
    federal_program_not_allowed: { en: "This drug maker's program isn't offered here for Medicare or Medicaid until Arik confirms the program allows it.", es: 'Este programa del fabricante no se ofrece aquí para Medicare o Medicaid hasta que Arik confirme que el programa lo permite.' },
  },
  caveat: {
    may_not_count_toward_deductible: { en: 'This payment may not count toward your deductible or out-of-pocket maximum.', es: 'Este pago puede no contar para su deducible ni para su máximo de gastos de bolsillo.' },
    counts_toward_deductible: { en: 'The program says this payment counts toward your deductible.', es: 'El programa dice que este pago cuenta para su deducible.' },
    medicare_cash_not_counted: { en: "Paying cash outside your plan won't count toward your Part D out-of-pocket limit for the year.", es: 'Pagar en efectivo fuera de su plan no cuenta para su límite anual de gastos de bolsillo de la Parte D.' },
    deductible_not_met_oop: { en: "You haven't met your deductible, so payments through your plan would move you toward it; paying cash doesn't.", es: 'Todavía no alcanza su deducible: los pagos con su plan lo acercan a él; pagar en efectivo no.' },
  },
  question: {
    ask_copay: { en: "What's your copay for this drug?", es: '¿Cuál es su copago por este medicamento?' },
    ask_deductible: { en: 'Have you met your deductible this year?', es: '¿Ya alcanzó su deducible este año?' },
    ask_coverage: { en: 'What coverage do you have: Medicare, Medicaid, a plan through work or the marketplace, or none?', es: '¿Qué cobertura tiene: Medicare, Medicaid, un plan del trabajo o del mercado de seguros, o ninguna?' },
    ask_medicaid_covers: { en: 'Did the pharmacy try billing Medicaid for it?', es: '¿La farmacia intentó cobrárselo a Medicaid?' },
  },
};

export function decisionText(r: CashVsInsuranceResult, lang: Lang): string {
  const parts = [STRINGS.reason[r.reason][lang], ...r.caveats.map((c) => STRINGS.caveat[c][lang])];
  if (r.questions.length) parts.push(r.questions.map((q) => STRINGS.question[q][lang]).join(' '));
  return parts.join(' ');
}
