// Demo sample patients (DEMO_DAY.md stage 1): fixtures and rules, pure.
// Run: npx tsx scripts/test_demo_samples.ts

import {
  ILLUSTRATIVE_TAG,
  SAMPLE_LABEL,
  SAMPLE_PATIENTS,
  isDemoMode,
  isSampleIdleExpired,
  isValidSampleSessionId,
  sampleByKey,
} from '../lib/demo/samples';
import { partitionCopayCardsForSubject, resolveChatSubject } from '../lib/chatSubject';
import { SAMPLE_DOCS, availableSampleDocs, cameraDoc } from '../lib/demo/sampleDocs';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// --- Fixtures ---
check('five sample patients', SAMPLE_PATIENTS.length === 5);
check('the five from DEMO_DAY stage 1', ['maria', 'james', 'dana', 'luis', 'tasha'].every((k) => sampleByKey(k)));
check('label text is exact', SAMPLE_LABEL === 'Sample patient, fictional');
check('illustrative tag text is exact', ILLUSTRATIVE_TAG === 'Illustrative example');
check('unknown key -> null', sampleByKey('nobody') === null && sampleByKey(null) === null);
check('each sample has 1 to 3 past jobs', SAMPLE_PATIENTS.every((s) => s.pastJobs.length >= 1 && s.pastJobs.length <= 3));
check('every past job date is a real ISO date before demo day', SAMPLE_PATIENTS.every((s) => s.pastJobs.every((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.date) && j.date < '2026-10-15')));
check('open jobs have no outcome; done jobs have one', SAMPLE_PATIENTS.every((s) => s.pastJobs.every((j) => (j.status === 'done') === (j.outcome !== null))));

// No real insurer, PBM, pharmacy chain or hospital system names anywhere in
// the fixtures (demo_5a_decisions.md). Program names (Medicare, Extra Help)
// and the drug names are allowed.
const REAL_NAMES = [
  'Aetna', 'Cigna', 'UnitedHealth', 'United Healthcare', 'Humana', 'Anthem', 'Elevance', 'Blue Cross', 'Blue Shield', 'BCBS',
  'Kaiser', 'Centene', 'Molina', 'Oscar', 'Highmark', 'Caremark', 'CVS', 'Express Scripts', 'Optum', 'Walgreens', 'Rite Aid',
  'Walmart', 'Costco', 'Kroger', 'GoodRx', 'Mark Cuban', 'Cost Plus', 'HCA', 'Tenet', 'Ascension', 'CommonSpirit', 'Mayo',
  'Cleveland Clinic', 'Banner', 'Advocate', 'Northwell', 'Prime Therapeutics', 'MedImpact',
];
const text = JSON.stringify(SAMPLE_PATIENTS);
const hits = REAL_NAMES.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
check('no real insurer, PBM, pharmacy or hospital names', hits.length === 0, hits.join(', '));
check('no em dashes in fixture text', !text.includes('—'));

// No drug prices are stored: past-job dollar figures are bills, never a
// medication, so nothing can contradict the real sourced prices.
const drugs = new Set(SAMPLE_PATIENTS.flatMap((s) => s.medications.map((m) => m.drug.toLowerCase())));
check('no past job mentions a medication (no invented drug prices)', SAMPLE_PATIENTS.every((s) => s.pastJobs.every((j) => ![...drugs].some((d) => `${j.title} ${j.outcome ?? ''}`.toLowerCase().includes(d)) || !/\$/.test(j.outcome ?? ''))));
check('chat samples offer a first question; walkthrough samples wait for their stage',
  SAMPLE_PATIENTS.every((s) => (s.walkthrough === 'chat') === (s.starterMessage !== null)));

// --- Whose situation chat uses ---
const visitorOnMedicare = { insurance_type: 'medicare', state: 'NY', preferred_language: 'en', explanation_style: 'simple' };
const maria = resolveChatSubject({ userProfile: visitorOnMedicare, managedPatient: null, sample: sampleByKey('maria')!.subject });
check("Maria: her situation, not the visitor's (uninsured, TX)", maria.insuranceType === 'uninsured' && maria.state === 'TX');
check("Maria: language and explanation style still come from the reader", maria.preferredLanguage === 'en' && maria.explanationStyle === 'simple');
const james = resolveChatSubject({ userProfile: { insurance_type: 'commercial' }, managedPatient: null, sample: sampleByKey('james')!.subject });
check("James: chat is about his mom Rose (Medicare), not James", james.kind === 'managed_patient' && james.insuranceType === 'medicare' && james.state === 'FL');
const copayCard = { exploit_type: 'copay_card', eligibility_criteria: {} };
const pap = { exploit_type: 'pap', eligibility_criteria: {} };
const jamesCards = partitionCopayCardsForSubject([copayCard, pap], james);
check('James: the Medicare copay-card block applies (government reason)', jamesCards.blocked.includes(copayCard) && jamesCards.viable.includes(pap) && jamesCards.reason === 'government');
const dana = resolveChatSubject({ userProfile: null, managedPatient: null, sample: sampleByKey('dana')!.subject });
check('Dana: employer plan keeps the copay card', partitionCopayCardsForSubject([copayCard], dana).viable.includes(copayCard));
check('no sample -> unchanged visitor subject', resolveChatSubject({ userProfile: visitorOnMedicare, managedPatient: null }).insuranceType === 'medicare');

// --- Switch, session id, idle rule ---
check('DEMO_MODE unset -> off', isDemoMode({}) === false);
check('DEMO_MODE=1 -> off (only "true" turns it on)', isDemoMode({ DEMO_MODE: '1' }) === false);
check('DEMO_MODE=true -> on', isDemoMode({ DEMO_MODE: 'true' }) === true);
check('sample session id: a UUID is accepted', isValidSampleSessionId('3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'));
check('sample session id: junk, SQL and empty are rejected', ['', 'abc', "x' or 1=1 --", null, 42].every((v) => !isValidSampleSessionId(v)));
const t0 = new Date('2026-10-15T12:00:00Z');
check('idle: 59 minutes -> kept', !isSampleIdleExpired(t0, new Date(t0.getTime() + 59 * 60_000)));
check('idle: 61 minutes -> purged', isSampleIdleExpired(t0, new Date(t0.getTime() + 61 * 60_000)));

// --- Demo document picker ---
check('picker lists the six planned sample documents', SAMPLE_DOCS.length === 6);
check('documents without an image or flow stay hidden (none exist before stages 3 and 4)', availableSampleDocs().length === SAMPLE_DOCS.filter((d) => d.image && d.flow).length);
const withBill = [{ ...SAMPLE_DOCS[3], image: '/demo/eob.png', flow: '/x' }, { ...SAMPLE_DOCS[0], image: '/demo/hb.png', flow: '/demo/bill' }];
check('a document shows once its image and flow exist', availableSampleDocs(withBill).length === 2);
check('the fake camera frames the first available bill, never a denial letter', cameraDoc(withBill)?.kind === 'hospital_bill' && cameraDoc([withBill[0]]) === null);
check('picker titles are fictional people only', SAMPLE_DOCS.every((d) => !REAL_NAMES.some((n) => d.title.toLowerCase().includes(n.toLowerCase()))));

console.log(failures === 0 ? '\nDEMO SAMPLES: ALL PASS' : `\nDEMO SAMPLES: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
