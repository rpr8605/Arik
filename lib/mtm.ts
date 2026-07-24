import { supabaseAdmin } from './supabaseAdmin';

// MTM eligibility (REFERRAL_NETWORK.md): pure computation against data
// already in user_matching_profile / user_medications. No external API.
//
// Threshold is the CMS figure for 2026 - "Based on analysis of 2024 PDE
// data, the MTM cost threshold will be $1,276 for 2026" (CY2026 MTM
// Program memo, v.05.06.2025, per 42 CFR 423.153(d)(2)(i)(C)). Plans may
// set LOWER thresholds and CMS structures targeting as multiple chronic
// conditions AND multiple Part D drugs AND cost, with plan flexibility -
// so this is an inclusive screen. Results are presented as "likely
// eligible," never a hard boolean (HANDOFF.md, locked 2026-07-24).

export const MTM_COST_THRESHOLD_USD = 1276; // CY2026, re-verify annually
export const MTM_MIN_CHRONIC_CONDITIONS = 3;
export const MTM_MIN_PART_D_MEDICATIONS = 8;

export interface MtmInput {
  chronicConditionsCount: number;
  partDMedicationCount: number;
  estimatedAnnualDrugCostUsd: number;
}

export interface MtmResult extends MtmInput {
  meetsConditionCriteria: boolean;
  meetsMedicationCountCriteria: boolean;
  meetsCostThreshold: boolean;
  likelyEligible: boolean;
}

export function computeMtmEligibility(input: MtmInput): MtmResult {
  const meetsConditionCriteria = input.chronicConditionsCount >= MTM_MIN_CHRONIC_CONDITIONS;
  const meetsMedicationCountCriteria = input.partDMedicationCount >= MTM_MIN_PART_D_MEDICATIONS;
  const meetsCostThreshold = input.estimatedAnnualDrugCostUsd >= MTM_COST_THRESHOLD_USD;
  // Inclusive screen per REFERRAL_NETWORK.md: (conditions OR med count) AND cost.
  const likelyEligible = meetsCostThreshold && (meetsConditionCriteria || meetsMedicationCountCriteria);
  return { ...input, meetsConditionCriteria, meetsMedicationCountCriteria, meetsCostThreshold, likelyEligible };
}

// Loads the patient's own data and stores the check. Requires the
// service-role env (server runtime); the pure function above is the
// testable core.
export async function computeAndStoreMtmCheck(userId: string): Promise<MtmResult & { id: string }> {
  const sb = supabaseAdmin();
  const [{ data: profile }, { data: meds }] = await Promise.all([
    sb.from('user_matching_profile').select('chronic_conditions').eq('id', userId).maybeSingle(),
    sb.from('user_medications').select('current_monthly_cost_usd').eq('user_id', userId),
  ]);
  const result = computeMtmEligibility({
    chronicConditionsCount: (profile?.chronic_conditions ?? []).length,
    partDMedicationCount: (meds ?? []).length,
    estimatedAnnualDrugCostUsd:
      (meds ?? []).reduce((sum, m) => sum + (Number(m.current_monthly_cost_usd) || 0), 0) * 12,
  });
  const { data, error } = await sb
    .from('mtm_eligibility_checks')
    .insert({
      user_id: userId,
      chronic_conditions_count: result.chronicConditionsCount,
      part_d_medication_count: result.partDMedicationCount,
      estimated_annual_drug_cost_usd: result.estimatedAnnualDrugCostUsd,
      meets_condition_criteria: result.meetsConditionCriteria,
      meets_medication_count_criteria: result.meetsMedicationCountCriteria,
      meets_cost_threshold: result.meetsCostThreshold,
      eligible: result.likelyEligible,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { ...result, id: data.id };
}
