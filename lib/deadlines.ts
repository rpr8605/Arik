import { supabaseAdmin } from './supabaseAdmin';

// Deadline engine (CASE_MODEL.md): deadlines are computed, stored, and
// surfaced as a persistent countdown - never a one-time chat mention.
//
// Every rule carries its basis. Rules whose basis is a repo doc rather
// than a verified external source are flagged sourceUnverified, and the
// stored deadline row gets source_id = null + last_verified_at = null
// until a real source row exists - same honesty rule as everything else.
// If no rule matches, the engine says so instead of guessing.

export interface DeadlineRule {
  id: string;
  days: number; // calendar days from notice_date to filing_deadline
  basis: string;
  sourceUnverified: boolean;
  payerNames?: string[]; // case-insensitive substring matches
  planTypes?: string[]; // matches user_matching_profile.insurance_type values
}

export const APPEAL_DEADLINE_RULES: DeadlineRule[] = [
  {
    id: 'uhc_commercial_internal_appeal',
    days: 65,
    basis:
      'UHC commercial internal appeal window (README.md, payer-specific). ' +
      'Verify against the patient\'s current plan documents before relying on it.',
    sourceUnverified: true,
    payerNames: ['uhc', 'unitedhealthcare', 'united healthcare', 'optum'],
  },
  {
    id: 'aetna_commercial_internal_appeal',
    days: 180,
    basis:
      'Aetna internal appeal window (README.md, payer-specific). ' +
      'Verify against the patient\'s current plan documents before relying on it.',
    sourceUnverified: true,
    payerNames: ['aetna'],
  },
  {
    id: 'medicare_advantage_reconsideration',
    days: 60,
    basis:
      'Medicare Advantage plan reconsideration window, CMS minimum ' +
      '(README.md). Verify against current CMS MA rules before relying on it.',
    sourceUnverified: true,
    planTypes: ['medicare_advantage'],
  },
  {
    id: 'erisa_group_internal_appeal_floor',
    days: 180,
    basis:
      'ERISA 29 CFR 2560.503-1: group health plans must allow at least 180 ' +
      'days to file an internal appeal.',
    sourceUnverified: true,
    planTypes: ['employer'],
  },
  {
    id: 'part_d_redetermination',
    days: 60,
    basis:
      'Medicare Part D redetermination request window. ' +
      'Verify against current CMS Part D rules before relying on it.',
    sourceUnverified: true,
    planTypes: ['medicare_part_d'],
  },
];

export function matchDeadlineRule(input: {
  payerName?: string;
  planType?: string;
}): DeadlineRule | null {
  const payer = input.payerName?.toLowerCase();
  if (payer) {
    const byPayer = APPEAL_DEADLINE_RULES.find((r) =>
      r.payerNames?.some((n) => payer.includes(n)),
    );
    if (byPayer) return byPayer;
  }
  if (input.planType) {
    const byPlan = APPEAL_DEADLINE_RULES.find((r) =>
      r.planTypes?.includes(input.planType!),
    );
    if (byPlan) return byPlan;
  }
  return null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysRemaining(filingDeadline: string): number {
  const ms = new Date(`${filingDeadline}T00:00:00Z`).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export type ComputeDeadlineResult =
  | { stored: true; deadline: Record<string, unknown>; daysRemaining: number; basis: string; sourceUnverified: boolean }
  | { stored: false; reason: 'no_rule'; message: string };

export async function computeAndStoreDeadline(
  caseId: string,
  input: {
    noticeDate: string; // ISO date from the denial/notice letter
    presumedReceiptDate?: string;
    payerName?: string;
    planType?: string;
    requiredAttachments?: string[];
  },
): Promise<ComputeDeadlineResult> {
  const rule = matchDeadlineRule(input);
  if (!rule) {
    return {
      stored: false,
      reason: 'no_rule',
      message:
        'No deadline rule on file for this payer/plan combination. Confirm the ' +
        'filing deadline from the denial letter and plan document - Arik does ' +
        'not guess deadlines.',
    };
  }
  const filingDeadline = addDays(input.noticeDate, rule.days);
  const { data, error } = await supabaseAdmin()
    .from('deadlines')
    .insert({
      case_id: caseId,
      rule_jurisdiction: rule.id,
      plan_type: input.planType ?? null,
      notice_date: input.noticeDate,
      presumed_receipt_date: input.presumedReceiptDate ?? null,
      filing_deadline: filingDeadline,
      required_attachments: input.requiredAttachments ?? null,
      // source_id intentionally null until the rule is verified against an
      // external source row; last_verified_at stays null for the same reason.
    })
    .select()
    .single();
  if (error) throw error;
  return {
    stored: true,
    deadline: data,
    daysRemaining: daysRemaining(filingDeadline),
    basis: rule.basis,
    sourceUnverified: rule.sourceUnverified,
  };
}

export async function listDeadlines(caseId: string) {
  const { data, error } = await supabaseAdmin()
    .from('deadlines')
    .select()
    .eq('case_id', caseId)
    .order('filing_deadline', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d) => ({
    ...d,
    days_remaining: daysRemaining(d.filing_deadline),
  }));
}
