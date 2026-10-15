// Sample patients for the demo (DEMO_DAY.md stage 1). Pure fixtures: they
// live here in code, never as database rows. "Try a sample patient" copies
// one into the visitor's own account as a case marked is_sample (db/028).
//
// Rules (docs/design/demo_5a_decisions.md):
// - Every person, company, hospital and doctor here is made up. No real
//   insurer, hospital or PBM names.
// - Drug prices are never stored here. They come from the real sourced
//   database at chat time; if a price isn't loaded, chat says so.
// - Past-job outcomes are illustrative and always shown with that tag.
// - Tested by scripts/test_demo_samples.ts.

export type SampleKey = 'maria' | 'james' | 'dana' | 'luis' | 'tasha';

export type JobStatus = 'done' | 'in_progress' | 'waiting';

export interface PastJob {
  title: string;
  status: JobStatus;
  date: string; // ISO date the job was opened
  outcome: string | null; // null while still open
}

export interface SampleSubject {
  // The situation chat is about. For a caregiver sample it is the person
  // being cared for, so the Medicare copay-card block applies to them.
  insuranceType: 'uninsured' | 'commercial' | 'medicare' | 'medicaid';
  state: string;
  incomePctFpl: number | null;
  householdSize: number | null;
  caringFor: { name: string; relationship: string } | null;
}

export interface SamplePatient {
  key: SampleKey;
  name: string;
  headline: string; // one line on the picker
  situation: string[]; // shown on the case page
  shows: string; // what feature this sample demonstrates
  caseType: 'prescription_savings' | 'bill_dispute' | 'denial_appeal';
  subject: SampleSubject;
  medications: { drug: string; dose: string | null }[];
  // The first message offered as a one-tap start (never auto-sent: a model
  // call only happens when the visitor taps).
  starterMessage: string | null;
  // Walkthroughs arrive in later stages; until then the case says so.
  walkthrough: 'chat' | 'bill_review' | 'denial_appeal';
  pastJobs: PastJob[];
}

export const SAMPLE_LABEL = 'Sample patient, fictional';
export const ILLUSTRATIVE_TAG = 'Illustrative example';

export const SAMPLE_PATIENTS: SamplePatient[] = [
  {
    key: 'maria',
    name: 'Maria',
    headline: 'Uninsured, takes Eliquis',
    situation: ['No insurance right now, paying cash at the pharmacy.', 'Takes Eliquis 5 mg twice a day.', 'Lives in Texas.'],
    shows: 'Prescription savings',
    caseType: 'prescription_savings',
    subject: { insuranceType: 'uninsured', state: 'TX', incomePctFpl: 180, householdSize: 1, caringFor: null },
    medications: [{ drug: 'Eliquis', dose: '5 mg twice a day' }],
    starterMessage: "I don't have insurance and Eliquis costs too much. What are my real options?",
    walkthrough: 'chat',
    pastJobs: [
      { title: 'Lab bill from Northfield Diagnostics', status: 'done', date: '2026-07-02', outcome: 'Bill lowered from $412 to $160 after an itemized-bill request' },
      { title: 'Charity care application at Mesa Verde Community Hospital', status: 'waiting', date: '2026-09-18', outcome: null },
    ],
  },
  {
    key: 'james',
    name: 'James',
    headline: 'Caring for his mom Rose, who is on Medicare',
    situation: ['Helps his mom Rose, 78, with her medicines and bills.', 'Rose has Medicare Part D and takes Eliquis 5 mg twice a day.', 'Rose lives in Florida.'],
    shows: 'Caregiver mode, with the Medicare copay card rule',
    caseType: 'prescription_savings',
    subject: { insuranceType: 'medicare', state: 'FL', incomePctFpl: null, householdSize: null, caringFor: { name: 'Rose', relationship: 'mother' } },
    medications: [{ drug: 'Eliquis', dose: '5 mg twice a day' }],
    starterMessage: "My mom is on Medicare Part D and her Eliquis copay is too high. Can she use the manufacturer's copay card?",
    walkthrough: 'chat',
    pastJobs: [
      { title: "Rose's hearing aid bill from Coastline Audiology", status: 'done', date: '2026-05-21', outcome: 'Duplicate fitting charge of $240 removed' },
      { title: 'Medicare Extra Help application for Rose', status: 'in_progress', date: '2026-09-30', outcome: null },
    ],
  },
  {
    key: 'dana',
    name: 'Dana',
    headline: 'Employer plan, prescribed Zepbound',
    situation: ['Has insurance through work (Brightline Logistics, made up).', 'Prescribed Zepbound; the plan has not approved it yet.', 'Lives in Illinois.'],
    shows: 'A real pricing conflict and the manufacturer direct price',
    caseType: 'prescription_savings',
    subject: { insuranceType: 'commercial', state: 'IL', incomePctFpl: null, householdSize: null, caringFor: null },
    medications: [{ drug: 'Zepbound', dose: null }],
    starterMessage: 'My employer plan is not covering Zepbound yet. What does it cost and how can I pay less?',
    walkthrough: 'chat',
    pastJobs: [
      { title: 'Out-of-network charge from Lakeshore Urgent Care', status: 'done', date: '2026-04-09', outcome: 'Reprocessed in network; balance went from $685 to $75' },
      { title: 'Prior authorization for Zepbound', status: 'waiting', date: '2026-10-01', outcome: null },
    ],
  },
  {
    key: 'luis',
    name: 'Luis',
    headline: 'ER visit bill that looks too high',
    situation: ['Went to the ER at Riverbend General Hospital (made up) in September.', 'Got a hospital bill and a separate doctor bill.', 'Lives in Arizona, employer plan.'],
    shows: 'Bill review',
    caseType: 'bill_dispute',
    subject: { insuranceType: 'commercial', state: 'AZ', incomePctFpl: null, householdSize: null, caringFor: null },
    medications: [],
    starterMessage: null,
    walkthrough: 'bill_review',
    pastJobs: [
      { title: 'Urgent care bill from Saguaro Walk-In Clinic', status: 'done', date: '2026-03-14', outcome: 'Coding error fixed; $130 refunded' },
    ],
  },
  {
    key: 'tasha',
    name: 'Tasha',
    headline: 'Insurance denied her MRI',
    situation: ['Her doctor ordered a knee MRI; the plan denied it.', 'Has an employer plan through Fairview Schools (made up).', 'Lives in Ohio.'],
    shows: 'Denial appeal',
    caseType: 'denial_appeal',
    subject: { insuranceType: 'commercial', state: 'OH', incomePctFpl: null, householdSize: null, caringFor: null },
    medications: [],
    starterMessage: null,
    walkthrough: 'denial_appeal',
    pastJobs: [
      { title: 'Physical therapy visit limit', status: 'done', date: '2026-02-03', outcome: 'Appeal approved; 8 more visits covered' },
      { title: 'Knee MRI denial', status: 'in_progress', date: '2026-10-06', outcome: null },
    ],
  },
];

export function sampleByKey(key: string | null | undefined): SamplePatient | null {
  return SAMPLE_PATIENTS.find((s) => s.key === key) ?? null;
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  done: 'Done',
  in_progress: 'In progress',
  waiting: 'Waiting on reply',
};

// DEMO_MODE is set on the Vercel demo only. Off (unset or anything but
// "true"), the picker and every sample API do not exist.
export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

// The per-tab sample session id is generated in the browser
// (crypto.randomUUID) and only ever accepted in this shape.
export function isValidSampleSessionId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Mirrors purge_idle_sample_cases() in db/028 so the rule is testable.
export const SAMPLE_IDLE_MINUTES = 60;
export function isSampleIdleExpired(lastActive: Date, now: Date): boolean {
  return now.getTime() - lastActive.getTime() > SAMPLE_IDLE_MINUTES * 60_000;
}
