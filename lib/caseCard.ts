// Plain words for a case, everywhere a patient sees one (home case cards and
// the case page header). Owner request 2026-10-15: no internal status names,
// case types or field names on screen. This is the ONE place internal
// values become words; scripts/test_case_card.ts proves no raw status or
// type name reaches the screen. Pure, and type-only imports, so client
// components can use it.

import type { CaseStatus, CaseType } from './cases';

// Fact fields as a patient would say them (pending corrections, "Needs you").
export const FIELD_LABELS: Record<string, string> = {
  employer_name: 'employer',
  institution_name: 'hospital or clinic',
  insurance_plan_name: 'insurance plan',
  insurance_type: 'insurance type',
  prescriber_name: 'prescriber',
  state_or_location_raw: 'location',
  zip_code: 'ZIP code',
  state: 'state',
  dose: 'dose',
  drug_name: 'medicine',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? 'a detail';
}

const TOPIC: Record<CaseType, string> = {
  prescription_savings: 'Prescription savings',
  bill_dispute: 'Medical bill',
  denial_appeal: 'Insurance denial',
  charity_care: 'Hospital financial help',
};

// A job's topic in plain words (patient home, Phase 7).
export function caseTopic(caseType: string): string {
  return TOPIC[(caseType in TOPIC ? caseType : 'prescription_savings') as CaseType];
}

const HAPPENING: Record<CaseStatus, (type: CaseType) => string> = {
  gathering_evidence: (type) =>
    type === 'prescription_savings' ? 'Arik is still checking prices.' : 'Arik is still looking into it.',
  action_ready: () => 'Your next step is ready.',
  submitted: () => 'Sent. Waiting to hear back.',
  awaiting_response: () => 'Waiting for a reply.',
  resolved_won: () => 'Done. It went your way.',
  resolved_lost: () => "Done. It didn't go your way this time.",
  closed_by_patient: () => 'You closed this one.',
  escalated: () => 'Arik suggested getting extra help with this one.',
};

const TAP: Record<CaseStatus, string> = {
  gathering_evidence: 'Tap to pick up where you left off.',
  action_ready: 'Tap to see your next step.',
  submitted: 'Tap to see what was sent.',
  awaiting_response: 'Tap to check on it.',
  resolved_won: 'Tap to see what happened.',
  resolved_lost: 'Tap to see what happened.',
  closed_by_patient: 'Tap to see what happened.',
  escalated: 'Tap to see who can help.',
};

export interface CaseCardInput {
  caseType: string;
  status: string;
  // The drug Arik looked up for this case (from its latest reply), or the
  // sample patient's drug. Null when there isn't one yet.
  drugName: string | null;
  hasReply: boolean;
  // Fields of pending corrections on this case, oldest first.
  pendingFields: string[];
}

export interface CaseCardText {
  title: string;
  happening: string;
  tap: string;
  needsYou: boolean;
}

export function caseCardText(input: CaseCardInput): CaseCardText {
  const type = (input.caseType in TOPIC ? input.caseType : 'prescription_savings') as CaseType;
  const status = (input.status in HAPPENING ? input.status : 'gathering_evidence') as CaseStatus;
  const drug = input.drugName ? input.drugName.charAt(0).toUpperCase() + input.drugName.slice(1) : null;
  const topic = type === 'prescription_savings' && drug ? `${drug} savings` : TOPIC[type];

  if (input.pendingFields.length > 0) {
    return {
      title: 'Needs you',
      happening: `${topic}: confirm your ${fieldLabel(input.pendingFields[0])} to continue.`,
      tap: 'Tap to confirm.',
      needsYou: true,
    };
  }
  if (!input.hasReply && status === 'gathering_evidence') {
    return { title: topic, happening: "Arik hasn't answered yet.", tap: 'Tap to start the conversation.', needsYou: false };
  }
  return { title: topic, happening: HAPPENING[status](type), tap: TAP[status], needsYou: false };
}
