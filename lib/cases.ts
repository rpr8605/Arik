import { supabaseAdmin } from './supabaseAdmin';

// The case, not the conversation, is the product unit (CASE_MODEL.md).
// Status transitions are enforced HERE, in code - an illegal transition
// throws, it is never silently applied.

export const CASE_TYPES = [
  'bill_dispute',
  'denial_appeal',
  'prescription_savings',
  'charity_care',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = [
  'gathering_evidence',
  'action_ready',
  'submitted',
  'awaiting_response',
  'resolved_won',
  'resolved_lost',
  'closed_by_patient',
  'escalated',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  gathering_evidence: ['action_ready', 'closed_by_patient'],
  action_ready: ['submitted', 'gathering_evidence', 'closed_by_patient'],
  submitted: ['awaiting_response', 'closed_by_patient'],
  awaiting_response: ['resolved_won', 'resolved_lost', 'escalated', 'closed_by_patient'],
  escalated: ['awaiting_response', 'closed_by_patient'],
  resolved_won: [],
  resolved_lost: [],
  closed_by_patient: [],
};

export class IllegalTransitionError extends Error {
  constructor(from: CaseStatus, to: CaseStatus) {
    super(`Illegal case status transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

// Pure guard, exported for testing and for any caller that wants to check
// before attempting a write. transitionCase() calls this internally.
export function assertLegalTransition(from: CaseStatus, to: CaseStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalTransitionError(from, to);
  }
}

export interface ArikCase {
  id: string;
  user_id: string | null;
  managed_patient_id: string | null;
  case_type: CaseType;
  amount_at_risk_usd: number | null;
  estimated_recoverable_usd: number | null;
  status: CaseStatus;
  organizations_involved: string[] | null;
  next_action: string | null;
  next_action_due: string | null;
  created_at: string;
  updated_at: string;
}

export async function createCase(input: {
  userId: string;
  caseType: CaseType;
  managedPatientId?: string;
  amountAtRiskUsd?: number;
  estimatedRecoverableUsd?: number;
  organizationsInvolved?: string[];
  nextAction?: string;
  nextActionDue?: string;
}): Promise<ArikCase> {
  if (!CASE_TYPES.includes(input.caseType)) {
    throw new Error(`Unknown case_type: ${input.caseType}`);
  }
  const { data, error } = await supabaseAdmin()
    .from('cases')
    .insert({
      user_id: input.userId,
      managed_patient_id: input.managedPatientId ?? null,
      case_type: input.caseType,
      amount_at_risk_usd: input.amountAtRiskUsd ?? null,
      estimated_recoverable_usd: input.estimatedRecoverableUsd ?? null,
      organizations_involved: input.organizationsInvolved ?? null,
      next_action: input.nextAction ?? null,
      next_action_due: input.nextActionDue ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ArikCase;
}

export async function getCase(id: string): Promise<ArikCase | null> {
  const { data, error } = await supabaseAdmin()
    .from('cases')
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as ArikCase | null;
}

export async function listCases(userId: string): Promise<ArikCase[]> {
  const sb = supabaseAdmin();
  const { data: own, error: ownErr } = await sb
    .from('cases')
    .select()
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (ownErr) throw ownErr;

  // Caregiver view: cases belonging to patients this user manages.
  const { data: managed, error: mpErr } = await sb
    .from('managed_patients')
    .select('id')
    .eq('caregiver_user_id', userId);
  if (mpErr) throw mpErr;
  const managedIds = (managed ?? []).map((m) => m.id);
  let managedCases: ArikCase[] = [];
  if (managedIds.length > 0) {
    const { data, error } = await sb
      .from('cases')
      .select()
      .in('managed_patient_id', managedIds)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    managedCases = (data ?? []) as ArikCase[];
  }

  const byId = new Map<string, ArikCase>();
  for (const c of [...(own ?? []), ...managedCases] as ArikCase[]) byId.set(c.id, c);
  return [...byId.values()];
}

export async function transitionCase(
  id: string,
  to: CaseStatus,
  opts: { nextAction?: string; nextActionDue?: string } = {},
): Promise<ArikCase> {
  const current = await getCase(id);
  if (!current) throw new Error(`Case not found: ${id}`);
  assertLegalTransition(current.status, to);
  const { data, error } = await supabaseAdmin()
    .from('cases')
    .update({
      status: to,
      next_action: opts.nextAction ?? current.next_action,
      next_action_due: opts.nextActionDue ?? current.next_action_due,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ArikCase;
}
