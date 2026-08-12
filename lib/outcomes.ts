import { supabaseAdmin } from './supabaseAdmin';
import { RESOLVED_STATUSES } from './cases';

// Outcome verification (CASE_MODEL.md): required before any success fee,
// never a yes/no. A row only counts as verified savings when
// patient_confirmed is true.

// Pure decision (unit-tested by scripts/test_outcomes.ts): the outcome-
// confirmation prompt shows exactly when a case has reached a terminal
// status and no patient-confirmed outcome exists yet.
export function shouldPromptOutcomeConfirmation(
  status: string,
  hasConfirmedOutcome: boolean,
): boolean {
  return (RESOLVED_STATUSES as readonly string[]).includes(status) && !hasConfirmedOutcome;
}

export async function hasConfirmedOutcome(caseId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from('case_outcomes')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('patient_confirmed', true);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function recordOutcome(
  caseId: string,
  fields: {
    originalAmountOwedUsd?: number;
    revisedAmountOwedUsd?: number;
    refundReceivedUsd?: number;
    futureMonthlySavingsUsd?: number;
    savingsDurationMonths?: number;
    proofDocumentId?: string;
    causedByArik?: boolean;
    isRecurring?: boolean;
    arikConfidence?: 'high' | 'medium' | 'low';
    pharmacyUsed?: string;
  },
) {
  const { data, error } = await supabaseAdmin()
    .from('case_outcomes')
    .insert({
      case_id: caseId,
      original_amount_owed_usd: fields.originalAmountOwedUsd ?? null,
      revised_amount_owed_usd: fields.revisedAmountOwedUsd ?? null,
      refund_received_usd: fields.refundReceivedUsd ?? null,
      future_monthly_savings_usd: fields.futureMonthlySavingsUsd ?? null,
      savings_duration_months: fields.savingsDurationMonths ?? null,
      proof_document_id: fields.proofDocumentId ?? null,
      caused_by_arik: fields.causedByArik ?? null,
      is_recurring: fields.isRecurring ?? null,
      arik_confidence: fields.arikConfidence ?? null,
      pharmacy_used: fields.pharmacyUsed ?? null,
      patient_confirmed: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function confirmOutcome(outcomeId: string, confirmed: boolean) {
  const { data, error } = await supabaseAdmin()
    .from('case_outcomes')
    .update({ patient_confirmed: confirmed })
    .eq('id', outcomeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listOutcomes(caseId: string) {
  const { data, error } = await supabaseAdmin()
    .from('case_outcomes')
    .select()
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
