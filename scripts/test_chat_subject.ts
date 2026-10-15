// Pure tests for lib/chatSubject.ts (review fixes C1 and C3, 2026-10-14).
// Run: npx tsx scripts/test_chat_subject.ts
import {
  MANAGED_UNKNOWN_COVERAGE_REASON,
  MODEL_PROFILE_FIELDS,
  modelMedications,
  modelProfile,
  partitionCopayCardsForSubject,
  resolveChatSubject,
  subjectModelProfile,
} from '../lib/chatSubject';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// A caregiver on an employer plan in Missouri, with every sensitive field set.
const caregiver = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  insurance_type: 'employer',
  state: 'MO',
  zip_code: '64111',
  income_pct_fpl: 420,
  household_size: 3,
  employer_name: 'Acme Co',
  insurance_plan_name: 'Acme PPO',
  chronic_conditions: ['diabetes'],
  demographic_eligibility_flags: { veteran: true },
  income_bracket: '75-100k',
  preferred_language: 'es',
  explanation_style: 'simple',
};
const card = { title: 'Eliquis Co-pay Card', exploit_type: 'copay_card', eligibility_criteria: { requires: 'commercial_insurance' } };
const pap = { title: 'BMS Patient Assistance', exploit_type: 'pap', eligibility_criteria: {} };

// --- C1: whose situation ---
{
  const self = resolveChatSubject({ userProfile: caregiver, managedPatient: null });
  check('own case: subject is the user, with their insurance/state/income', self.kind === 'self' && self.insuranceType === 'employer' && self.state === 'MO' && self.incomePctFpl === 420 && self.householdSize === 3 && !self.coverageUnknownManaged);
}
{
  const managed = resolveChatSubject({ userProfile: caregiver, managedPatient: { id: 'mp-1', zip_code: '50309' } });
  check("managed case: never uses the caregiver's insurance, state, income or household", managed.kind === 'managed_patient' && managed.insuranceType === null && managed.state === null && managed.incomePctFpl === null && managed.householdSize === null);
  check('managed case: language and explanation style follow the reader', managed.preferredLanguage === 'es' && managed.explanationStyle === 'simple');
  check('managed case: coverage marked unknown, id carried', managed.coverageUnknownManaged && managed.managedPatientId === 'mp-1');
}

// --- C1: copay-card block per subject ---
{
  const managed = resolveChatSubject({ userProfile: caregiver, managedPatient: { id: 'mp-1', zip_code: null } });
  const r = partitionCopayCardsForSubject([card, pap], managed);
  check('caregiver (employer plan) helping a patient of unknown coverage: copay card held back', r.blocked.length === 1 && r.blocked[0] === card && r.viable.length === 1 && r.viable[0] === pap && r.reason === 'managed_unknown');
  check('held-back reason names Medicare/Medicaid and the statute', /Medicare or Medicaid/.test(MANAGED_UNKNOWN_COVERAGE_REASON) && /Anti-Kickback/.test(MANAGED_UNKNOWN_COVERAGE_REASON));
  const none = partitionCopayCardsForSubject([pap], managed);
  check('managed, no cards in context: nothing blocked, no reason', none.blocked.length === 0 && none.reason === null);
}
{
  const medicareSelf = resolveChatSubject({ userProfile: { ...caregiver, insurance_type: 'medicare_part_d' }, managedPatient: null });
  const r = partitionCopayCardsForSubject([card, pap], medicareSelf);
  check('own Medicare case: existing hard-block still applies', r.blocked.length === 1 && r.reason === 'government');
}
{
  const commercialSelf = resolveChatSubject({ userProfile: caregiver, managedPatient: null });
  const r = partitionCopayCardsForSubject([card, pap], commercialSelf);
  check('own commercial case: card stays available', r.blocked.length === 0 && r.viable.length === 2 && r.reason === null);
}

// --- C3: what the model may see ---
{
  const p = modelProfile(caregiver);
  const keys = Object.keys(p).sort();
  check('model profile has exactly the allowed fields', JSON.stringify(keys) === JSON.stringify([...MODEL_PROFILE_FIELDS].sort()), keys.join(','));
  const json = JSON.stringify(p);
  for (const banned of ['demographic', 'veteran', 'chronic', 'diabetes', 'income', '420', 'employer_name', 'Acme', 'zip', '64111', 'household', 'plan_name']) {
    check(`model profile never contains "${banned}"`, !json.includes(banned), json);
  }
  check('model profile of null is all-null, not a crash', Object.values(modelProfile(null)).every((v) => v === null));
}
{
  const managed = resolveChatSubject({ userProfile: caregiver, managedPatient: { id: 'mp-1', zip_code: '50309' } });
  const p = subjectModelProfile(managed);
  check("managed case: model profile shows unknown insurance, not the caregiver's", p.insurance_type === null && p.state === null && p.preferred_language === 'es');
}
{
  const meds = modelMedications([
    { id: 'm1', user_id: 'u1', prescriber_name: 'Dr. Real Name', dose: '5 mg', notes: 'private', drugs: { id: 'd1', name: 'Eliquis', drug_class: 'anticoagulant' } },
  ]);
  check('model medications are drug + dose only', JSON.stringify(meds) === JSON.stringify([{ drug: 'Eliquis', dose: '5 mg' }]), JSON.stringify(meds));
  check('model medications of null is empty', modelMedications(null).length === 0);
}

console.log(failures === 0 ? '\nCHAT SUBJECT: ALL PASS' : `\nCHAT SUBJECT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
