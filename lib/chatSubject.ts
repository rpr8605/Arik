// Whose situation a chat turn is about, and what of it the model may see
// (review fixes C1 and C3, 2026-10-14). Pure; tested by
// scripts/test_chat_subject.ts. The chat route calls resolveChatSubject()
// once per turn and uses the result for retrieval, the copay-card block,
// ranking and the prompt.
//
// C1: a case can belong to a managed patient (caregiver mode). The old
// route used the CAREGIVER's own profile, so the Medicare copay-card
// hard-block (NN-6) was decided on the wrong person's insurance. The
// subject is now the managed patient. managed_patients has no coverage
// field yet, so a managed patient's insurance is UNKNOWN, and with unknown
// coverage manufacturer copay cards are hidden with a plain reason instead
// of being offered to someone who may be on Medicare. (Follow-up: store the
// managed patient's coverage so this can be decided properly.)
//
// C3: the model sees only MODEL_PROFILE_FIELDS. Demographic flags, chronic
// conditions, income, employer, zip and the rest of the profile row never
// enter a prompt (NN-9, data minimization before any BAA provider).

import { isManufacturerCopayPath, partitionCopayCardsForInsurance } from './medicareEligibility';
import { resolveLocation } from './resolveLocation';

// The only profile fields that may reach the response model.
export const MODEL_PROFILE_FIELDS = ['preferred_language', 'explanation_style', 'insurance_type', 'state'] as const;
export type ModelProfile = Partial<Record<(typeof MODEL_PROFILE_FIELDS)[number], string | null>>;

export function modelProfile(profile: Record<string, any> | null | undefined): ModelProfile {
  const out: ModelProfile = {};
  for (const f of MODEL_PROFILE_FIELDS) out[f] = profile?.[f] ?? null;
  return out;
}

// Medications as the model sees them: drug and dose only (no prescriber,
// no ids, no notes).
export function modelMedications(meds: any[] | null | undefined): { drug: string | null; dose: string | null }[] {
  return (meds ?? []).map((m) => ({ drug: m?.drugs?.name ?? null, dose: m?.dose ?? null }));
}

export interface ManagedPatientRef {
  id: string;
  zip_code: string | null;
}

export interface ChatSubject {
  kind: 'self' | 'managed_patient';
  managedPatientId: string | null;
  // Facts about the person the case is about. Language and explanation
  // style always come from the person READING (the session user).
  insuranceType: string | null;
  state: string | null;
  incomePctFpl: number | null;
  householdSize: number | null;
  preferredLanguage: string | null;
  explanationStyle: string | null;
  coverageUnknownManaged: boolean;
}

export function resolveChatSubject(input: {
  userProfile: Record<string, any> | null;
  managedPatient: ManagedPatientRef | null;
}): ChatSubject {
  const reader = input.userProfile;
  if (!input.managedPatient) {
    return {
      kind: 'self',
      managedPatientId: null,
      insuranceType: reader?.insurance_type ?? null,
      state: reader?.state ?? null,
      incomePctFpl: reader?.income_pct_fpl ?? null,
      householdSize: reader?.household_size ?? null,
      preferredLanguage: reader?.preferred_language ?? null,
      explanationStyle: reader?.explanation_style ?? null,
      coverageUnknownManaged: false,
    };
  }
  const zip = input.managedPatient.zip_code;
  return {
    kind: 'managed_patient',
    managedPatientId: input.managedPatient.id,
    insuranceType: null,
    state: zip ? resolveLocation(zip).state ?? null : null,
    incomePctFpl: null,
    householdSize: null,
    preferredLanguage: reader?.preferred_language ?? null,
    explanationStyle: reader?.explanation_style ?? null,
    coverageUnknownManaged: true,
  };
}

// The subject as a profile-shaped object for prompt and guard use.
export function subjectModelProfile(subject: ChatSubject): ModelProfile {
  return {
    preferred_language: subject.preferredLanguage,
    explanation_style: subject.explanationStyle,
    insurance_type: subject.insuranceType,
    state: subject.state,
  };
}

export const MANAGED_UNKNOWN_COVERAGE_REASON =
  "Manufacturer copay cards are hidden for the person you're helping because Arik doesn't know their " +
  'insurance yet, and these cards are illegal to use with Medicare or Medicaid (federal Anti-Kickback Statute).';

// The copay-card partition for a subject: known government coverage uses
// the existing hard-block; a managed patient with unknown coverage has
// every manufacturer copay path held back too.
export function partitionCopayCardsForSubject<T extends { exploit_type?: string | null; eligibility_criteria?: Record<string, unknown> | null }>(
  exploits: T[],
  subject: ChatSubject,
): { viable: T[]; blocked: T[]; reason: 'government' | 'managed_unknown' | null } {
  if (subject.coverageUnknownManaged && !subject.insuranceType) {
    const viable: T[] = [];
    const blocked: T[] = [];
    for (const e of exploits) (isManufacturerCopayPath(e) ? blocked : viable).push(e);
    return { viable, blocked, reason: blocked.length ? 'managed_unknown' : null };
  }
  const { viable, blocked } = partitionCopayCardsForInsurance(exploits, subject.insuranceType);
  return { viable, blocked, reason: blocked.length ? 'government' : null };
}
