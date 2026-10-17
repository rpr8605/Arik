// Denial engine types (Phase 5, spec Appendix B4). The rules engine
// decides (lib/rules/denials/*); a model never sets a flag, a deadline or
// an eligibility decision.

export type PlanFunding = 'fully_insured' | 'self_funded' | 'marketplace' | 'medicare_part_d' | 'medicare_advantage' | 'medicaid' | 'unknown';
export const PLAN_FUNDINGS: PlanFunding[] = ['fully_insured', 'self_funded', 'marketplace', 'medicare_part_d', 'medicare_advantage', 'medicaid', 'unknown'];

export type DenialCategory = 'no_reason_given' | 'administrative' | 'excluded_service' | 'no_prior_authorization' | 'medical_necessity' | 'other';
export const DENIAL_CATEGORIES: DenialCategory[] = ['no_reason_given', 'administrative', 'excluded_service', 'no_prior_authorization', 'medical_necessity', 'other'];

// Which decision this notice is: the plan's first answer, or its answer
// to an internal appeal (Part D: the redetermination; Medicaid: the plan
// appeal).
export type AppealLevel = 'initial' | 'internal_appeal';

// Care not yet received (pre_service), already received (post_service),
// or a payment request for a drug already bought (payment).
export type ClaimTiming = 'pre_service' | 'post_service' | 'payment';

export type MedicaidDelivery = 'managed_care' | 'state' | 'unknown';

// The patient's "Looks right" copy of a denial. Nothing in the engine runs
// on anything else (lib/rules/denials/confirm.ts is the only constructor).
export interface ConfirmedDenial {
  confirmedAt: string;
  payerName: string | null;
  providerName: string | null;           // the doctor or hospital, if the letter names one (or the patient adds it)
  planFunding: PlanFunding;
  medicaidDelivery: MedicaidDelivery;    // only read when planFunding = medicaid
  category: DenialCategory;
  carcCodes: string[];                   // numbers only, e.g. '50'
  rarcCodes: string[];                   // e.g. 'N130'
  serviceOrDrug: string | null;          // as printed
  serviceCode: string | null;            // CPT/HCPCS number, if printed
  isDrug: boolean;
  noticeDate: string;                    // ISO, the date on the notice
  dateOfService: string | null;
  requestDate: string | null;            // when the claim, request or appeal was sent, if the patient knows
  appealLevel: AppealLevel;
  timing: ClaimTiming;
  isPriorAuthDecision: boolean;
  isUrgent: boolean;
  statedReason: string | null;           // the plan's own words, as printed
  claimNumber: string | null;
  letterDeadlineDays: number | null;     // the appeal window the letter itself states
  priorAuth: { reference: string | null; serviceCode: string | null; validFrom: string; validTo: string } | null; // an approval the patient has
}

export interface Citation {
  cite: string;                          // '29 CFR 2560.503-1(h)(4)(i)'
  url: string;
}

// One deadline the patient must meet.
export interface PatientDeadline {
  ruleId: string;
  step: 'internal_appeal' | 'external_review' | 'part_d_redetermination' | 'part_d_ire' | 'ma_reconsideration' | 'medicaid_plan_appeal' | 'medicaid_fair_hearing';
  due: string | null;                    // ISO; null when the rule leaves it to the state or the notice
  windowText: string;                    // plain words: '180 days from the date on the notice'
  note: string | null;
  citation: Citation;
}

export type CheckId =
  | 'missing_specific_reason'
  | 'insurer_late'
  | 'patient_deadline'
  | 'prior_auth_on_file'
  | 'administrative_denial'
  | 'self_funded_track'
  | 'medical_necessity'
  | 'excluded_service'
  | 'external_review'
  | 'no_error_found';

export interface DenialFlag {
  id: CheckId;
  tone: 'wrong' | 'ask' | 'info';
  plainText: string;                     // plain words, no rule names (the letter cites the rule)
  citation: Citation | null;
  // patient_deadline only:
  deadline?: PatientDeadline;
  daysLeft?: number;
  status?: 'ok' | 'due_soon' | 'overdue';
  // insurer_late only: the limit the plan had and the dates compared.
  limit?: { amount: number; unit: 'days' | 'hours'; from: string; decidedOn: string };
}

export type DenialLetterType = 'insurer_appeal' | 'medical_necessity_request' | 'claim_file_request' | 'specific_reason_request' | 'external_review_request' | 'part_d_exception';
export const DENIAL_LETTER_TYPES: DenialLetterType[] = ['insurer_appeal', 'medical_necessity_request', 'claim_file_request', 'specific_reason_request', 'external_review_request', 'part_d_exception'];
