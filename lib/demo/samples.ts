// Sample patients for the demo (DEMO_DAY.md stage 1, DEMO_WALKTHROUGHS.md
// Flow 4). Pure fixtures: they live here in code, never as database rows.
// "Chat with Arik" copies one into the visitor's own account as a case
// marked is_sample (db/028); the patient home reads these directly.
//
// Rules (docs/design/demo_5a_decisions.md):
// - Every person, company, hospital and doctor here is made up. No real
//   insurer, hospital or PBM names.
// - Drug prices are never stored here. They come from the real sourced
//   database at runtime; if a price isn't loaded, Arik says so.
// - Past-job outcomes and "Saved so far" are illustrative and always shown
//   with that tag.
// - Tested by scripts/test_demo_samples.ts.

export type SampleKey = 'maria' | 'james' | 'dana' | 'luis' | 'tasha';

export type JobStatus = 'done' | 'in_progress' | 'waiting';

export interface TimelineEvent {
  date: string; // ISO date
  kind: 'document' | 'letter' | 'sent' | 'reply' | 'outcome' | 'note';
  text: string;
}

export interface PastJob {
  title: string;
  status: JobStatus;
  date: string; // ISO date the job was opened
  outcome: string | null; // null while still open
  // Full canned history: documents, letters, the "sent" receipt (Demo, not
  // sent), the reply and the outcome.
  timeline: TimelineEvent[];
  // An open job a walkthrough plays: "Start" runs it.
  walk?: string;
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
  situation: string[]; // shown on the patient home and the chat page
  shows: string; // what feature this sample demonstrates
  caseType: 'prescription_savings' | 'bill_dispute' | 'denial_appeal';
  subject: SampleSubject;
  medications: { drug: string; dose: string | null }[];
  // The first message offered as a one-tap start in a real chat (never
  // auto-sent: a model call only happens when the visitor taps).
  starterMessage: string | null;
  walkthrough: 'chat' | 'bill_review' | 'denial_appeal';
  pastJobs: PastJob[];
  // The patient home: what needs them now, and an illustrative total.
  needsYou: { text: string; walk: string };
  savedSoFarUsd: number | null;
  savedSoFarNote: string;
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
      {
        title: 'Lab bill from Northfield Diagnostics',
        status: 'done',
        date: '2026-07-02',
        outcome: 'Bill lowered from $412 to $160 after an itemized-bill request',
        timeline: [
          { date: '2026-07-02', kind: 'document', text: 'Lab bill received: $412 due' },
          { date: '2026-07-03', kind: 'letter', text: 'Arik prepared a request for a fully itemized bill' },
          { date: '2026-07-03', kind: 'sent', text: 'Sent by fax to Northfield Diagnostics billing (Demo, not sent)' },
          { date: '2026-07-24', kind: 'reply', text: 'Northfield replied: two tests were billed in error' },
          { date: '2026-07-29', kind: 'outcome', text: 'Corrected bill: $160 due' },
        ],
      },
      {
        title: 'Charity care application at Mesa Verde Community Hospital',
        status: 'waiting',
        date: '2026-09-18',
        outcome: null,
        timeline: [
          { date: '2026-09-18', kind: 'document', text: 'Financial assistance form from Mesa Verde' },
          { date: '2026-09-19', kind: 'letter', text: 'Arik filled in the application from what Maria shared' },
          { date: '2026-09-20', kind: 'sent', text: 'Sent by mail (Demo, not sent)' },
        ],
      },
    ],
    needsYou: { text: 'Eliquis: see your lowest legal price', walk: '/walk/rx?patient=maria&drug=Eliquis' },
    savedSoFarUsd: 252,
    savedSoFarNote: 'from the lab bill',
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
      {
        title: "Rose's hearing aid bill from Coastline Audiology",
        status: 'done',
        date: '2026-05-21',
        outcome: 'Duplicate fitting charge of $240 removed',
        timeline: [
          { date: '2026-05-21', kind: 'document', text: 'Coastline Audiology bill: fitting charged twice' },
          { date: '2026-05-22', kind: 'letter', text: "Arik prepared a billing dispute for James to send on Rose's behalf" },
          { date: '2026-05-22', kind: 'sent', text: 'Sent by email (Demo, not sent)' },
          { date: '2026-06-10', kind: 'reply', text: 'Coastline agreed the second fitting charge was an error' },
          { date: '2026-06-12', kind: 'outcome', text: '$240 removed from the bill' },
        ],
      },
      {
        title: 'Medicare Extra Help application for Rose',
        status: 'in_progress',
        date: '2026-09-30',
        outcome: null,
        timeline: [
          { date: '2026-09-30', kind: 'note', text: 'Arik checked: Rose may qualify for Extra Help with drug costs' },
          { date: '2026-10-02', kind: 'letter', text: 'Application drafted with James; waiting for Rose to sign' },
        ],
      },
    ],
    needsYou: { text: "Rose's Eliquis: the copay card can't be used with Medicare. See what can", walk: '/walk/rx?patient=james&drug=Eliquis' },
    savedSoFarUsd: 240,
    savedSoFarNote: 'from the hearing aid bill',
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
      {
        title: 'Out-of-network charge from Lakeshore Urgent Care',
        status: 'done',
        date: '2026-04-09',
        outcome: 'Reprocessed in network; balance went from $685 to $75',
        timeline: [
          { date: '2026-04-09', kind: 'document', text: 'Explanation of benefits: urgent care billed out of network' },
          { date: '2026-04-10', kind: 'letter', text: 'Arik prepared a request to reprocess the claim in network' },
          { date: '2026-04-10', kind: 'sent', text: 'Sent through the plan portal (Demo, not sent)' },
          { date: '2026-05-02', kind: 'reply', text: 'Plan replied: the clinic is in network, claim reprocessed' },
          { date: '2026-05-06', kind: 'outcome', text: 'Balance went from $685 to $75' },
        ],
      },
      {
        title: 'Prior authorization for Zepbound',
        status: 'waiting',
        date: '2026-10-01',
        outcome: null,
        timeline: [
          { date: '2026-10-01', kind: 'note', text: "Dana's doctor sent the prior authorization request" },
          { date: '2026-10-08', kind: 'note', text: 'Arik is checking back weekly' },
        ],
      },
    ],
    needsYou: { text: 'Zepbound: see what it costs while the plan decides', walk: '/walk/rx?patient=dana&drug=Zepbound' },
    savedSoFarUsd: 610,
    savedSoFarNote: 'from the urgent care charge',
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
      {
        title: 'Urgent care bill from Saguaro Walk-In Clinic',
        status: 'done',
        date: '2026-03-14',
        outcome: 'Coding error fixed; $130 refunded',
        timeline: [
          { date: '2026-03-14', kind: 'document', text: 'Saguaro Walk-In Clinic bill: visit billed at a higher level than the visit' },
          { date: '2026-03-15', kind: 'letter', text: 'Arik prepared a billing dispute' },
          { date: '2026-03-15', kind: 'sent', text: 'Sent by fax (Demo, not sent)' },
          { date: '2026-04-01', kind: 'reply', text: 'Saguaro corrected the visit level' },
          { date: '2026-04-04', kind: 'outcome', text: '$130 refunded' },
        ],
      },
      {
        title: 'ER visit bills from Riverbend General',
        status: 'in_progress',
        date: '2026-09-20',
        outcome: null,
        walk: '/walk/bill',
        timeline: [
          { date: '2026-09-20', kind: 'document', text: 'Hospital statement received: $6,282 due' },
          { date: '2026-09-24', kind: 'document', text: 'Doctor statement received: $914 due' },
        ],
      },
    ],
    needsYou: { text: 'Your ER bills: check them before you pay', walk: '/walk/bill' },
    savedSoFarUsd: 130,
    savedSoFarNote: 'from the urgent care bill',
  },
  {
    key: 'tasha',
    name: 'Tasha',
    headline: 'Insurance denied her MRI',
    situation: ['Her doctor ordered a knee MRI; the plan denied the claim.', 'Has an employer plan through Fairview Schools (made up).', 'Lives in Ohio.'],
    shows: 'Denial appeal',
    caseType: 'denial_appeal',
    subject: { insuranceType: 'commercial', state: 'OH', incomePctFpl: null, householdSize: null, caringFor: null },
    medications: [],
    starterMessage: null,
    walkthrough: 'denial_appeal',
    pastJobs: [
      {
        title: 'Physical therapy visit limit',
        status: 'done',
        date: '2026-02-03',
        outcome: 'Appeal approved; 8 more visits covered',
        timeline: [
          { date: '2026-02-03', kind: 'document', text: 'Plan letter: therapy visits capped' },
          { date: '2026-02-04', kind: 'letter', text: "Arik prepared an appeal with her therapist's notes" },
          { date: '2026-02-04', kind: 'sent', text: 'Sent by fax to Summit Peak appeals (Demo, not sent)' },
          { date: '2026-02-27', kind: 'reply', text: 'Summit Peak approved the appeal' },
          { date: '2026-02-27', kind: 'outcome', text: '8 more therapy visits covered' },
        ],
      },
      {
        title: 'Knee MRI denial',
        status: 'in_progress',
        date: '2026-10-06',
        outcome: null,
        walk: '/walk/denial',
        timeline: [
          { date: '2026-10-06', kind: 'document', text: 'Denial letter received (reason code CO-50)' },
          { date: '2026-10-09', kind: 'document', text: 'Explanation of benefits received: $2,100 may be owed' },
        ],
      },
    ],
    needsYou: { text: 'MRI denial: appeal by April 4, 2027', walk: '/walk/denial' },
    savedSoFarUsd: null,
    savedSoFarNote: '8 more therapy visits covered',
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

// DEMO_MODE is set on the Vercel demo only. On for "true" or "1" (trimmed,
// any case); off for anything else, and then the picker, the walkthroughs
// and every demo API do not exist.
export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.DEMO_MODE ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
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
