// The scripted demo flows (docs/kimi/DEMO_WALKTHROUGHS.md). Fixed
// documents, findings and letters; the only live data is Flow 1's prices.
// Highlight boxes are percentages of the sample SVGs in public/demo/docs
// (bill rows start at y=245 and are 34 units tall on a 600x800 page).

import type { Highlight, Script, Tone } from './script';
import type { SampleKey } from '../demo/samples';

function rows(n: number, tone: Tone, first: number, last: number): Highlight {
  return {
    n,
    tone,
    x: 1,
    y: Math.round(((245 + first * 34 - 2) / 800) * 10000) / 100,
    w: 98,
    h: Math.round((((last - first + 1) * 34 + 2) / 800) * 10000) / 100,
  };
}

const BILL_LINES = [
  "Reading every line so you don't have to...",
  'Hunting for double charges...',
  'Checking codes against the billing rules...',
  "Comparing charges to what's typical...",
];
const DENIAL_LINES = ['Reading the fine print...', 'Finding the reason they gave...', 'Checking your appeal rights and deadlines...'];
const RX_LINES = ['Checking manufacturer programs...', 'Comparing cash and insurance...', 'Looking for the lowest legal price...'];

// ---- Flow 2: Check a medical bill (Luis, ER visit) ----
export const BILL_FLOW: Script = {
  id: 'bill',
  patient: 'luis',
  title: 'ER bill review',
  start: 'intro',
  sequences: {
    intro: [
      { kind: 'arik', text: "Let's look at it. Snap a photo or pick the bill." },
      { kind: 'pick', text: 'Pick the bill', docs: ['luis-hospital-bill', 'luis-doctor-bill'], go: 'read' },
    ],
    read: [
      { kind: 'reading', docId: 'luis-hospital-bill', lines: BILL_LINES },
      {
        kind: 'summary',
        rows: [
          ['Visit', 'Sept 3 to 5, 2026 (2 nights)'],
          ['Hospital', 'Riverbend General Hospital'],
          ['Hospital bill', '$13,462 billed, you owe $6,282'],
          ['Doctor bill', '$1,326 billed, you owe $914'],
        ],
        confirm: 'Looks right',
        go: 'findings',
      },
    ],
    findings: [
      { kind: 'arik', text: "Thanks for checking. I went through every line on both bills. Here's what I found." },
      {
        kind: 'doc',
        docId: 'luis-hospital-bill',
        highlights: [rows(1, 'wrong', 1, 2), rows(2, 'wrong', 3, 4), rows(3, 'wrong', 6, 6)],
      },
      { kind: 'finding', n: 1, tone: 'wrong', amountUsd: 186, text: 'You were billed twice for the same blood count test on the same day. That looks like a duplicate.' },
      { kind: 'finding', n: 2, tone: 'wrong', amountUsd: 412, text: 'You were billed for a basic blood chemistry panel and a full one on the same day. The full panel already includes the basic tests, so these are normally billed as one.' },
      { kind: 'finding', n: 3, tone: 'wrong', amountUsd: 2950, text: 'You were charged for 3 days in the room, but your stay was 2 nights (Sept 3 to 5). That is one extra day.' },
      { kind: 'doc', docId: 'luis-doctor-bill', highlights: [rows(4, 'ask', 0, 0)] },
      { kind: 'finding', n: 4, tone: 'ask', amountUsd: 1240, text: "The doctor's visit is billed at the highest emergency level. That can be right, but it's worth asking what supported that level." },
      { kind: 'total', text: "That's {total} in charges worth questioning." },
      { kind: 'arik', text: 'Want me to challenge these?' },
      {
        kind: 'chips',
        options: [
          { label: 'Dispute with the hospital billing office', go: 'dispute' },
          { label: 'Ask for a fully itemized bill first', go: 'itemized' },
          { label: 'Ask a question', go: 'question' },
        ],
      },
    ],
    question: [
      { kind: 'arik', text: "Good idea to ask. In the real app you can ask me anything about this bill. In this walkthrough, here's the most common question: \"Will disputing hurt my credit?\" No. Asking the hospital to hold your account while they review it is exactly what the letter does." },
      {
        kind: 'chips',
        options: [
          { label: 'Dispute with the hospital billing office', go: 'dispute' },
          { label: 'Ask for a fully itemized bill first', go: 'itemized' },
        ],
      },
    ],
    dispute: [
      { kind: 'arik', text: 'Here is your dispute letter. It lists each charge, asks for a corrected bill, and asks them to hold your account from collections while they review it.' },
      { kind: 'letter', letterId: 'luis-dispute' },
      { kind: 'send', letterId: 'luis-dispute' },
      { kind: 'job', title: 'ER bill dispute', status: 'Sent · Waiting on the hospital', flow: 'bill' },
      { kind: 'end' },
    ],
    itemized: [
      { kind: 'arik', text: 'Smart first step. This letter asks for every charge with its code, and asks them to hold your account while you wait.' },
      { kind: 'letter', letterId: 'luis-itemized' },
      { kind: 'send', letterId: 'luis-itemized' },
      { kind: 'job', title: 'Itemized bill request', status: 'Sent · Waiting on the hospital', flow: 'bill' },
      { kind: 'end' },
    ],
  },
};

// ---- Flow 3: Fight a denial (Tasha, MRI denied) ----
// The deadline comes from the letter itself ("within 180 days of the date
// of this letter", dated October 6, 2026), not from a rule Arik asserts.
export const DENIAL_DEADLINE = 'April 4, 2027';

export const DENIAL_FLOW: Script = {
  id: 'denial',
  patient: 'tasha',
  title: 'MRI denial appeal',
  start: 'intro',
  sequences: {
    intro: [
      { kind: 'arik', text: "I'm sorry they said no. Let's read exactly what they wrote. Snap a photo or pick the letter." },
      { kind: 'pick', text: 'Pick the letter', docs: ['tasha-denial-letter', 'tasha-eob', 'sample-insurance-card'], go: 'read' },
    ],
    read: [
      { kind: 'reading', docId: 'tasha-denial-letter', lines: DENIAL_LINES },
      {
        kind: 'doc',
        docId: 'tasha-denial-letter',
        highlights: [
          { n: 1, tone: 'wrong', x: 1, y: 41, w: 98, h: 9.75 },
          { n: 2, tone: 'ask', x: 1, y: 15.5, w: 36, h: 2.75 },
          { n: 3, tone: 'ask', x: 1, y: 56.25, w: 98, h: 5 },
        ],
      },
      { kind: 'finding', n: 1, tone: 'wrong', amountUsd: null, text: "What they said: they don't think the MRI was needed yet, because your records didn't show 6 weeks of treatment like physical therapy first. That's about missing paperwork, not a final no." },
      { kind: 'finding', n: 2, tone: 'ask', amountUsd: null, text: 'The letter is dated October 6, 2026.' },
      { kind: 'finding', n: 3, tone: 'ask', amountUsd: null, text: `Your letter says the appeal must arrive within 180 days of that date, so you have until ${DENIAL_DEADLINE} to appeal.` },
      { kind: 'deadline', label: 'Appeal must arrive by', date: DENIAL_DEADLINE },
      { kind: 'arik', text: "Many people never appeal. Here's what I'd argue:\n\n1. Their reason is missing information: they say there was no therapy first.\n2. You did physical therapy for this knee in February. Your doctor's letter and therapy records fill that gap.\n3. You have the right to an internal appeal, and if they say no again, an outside review by an independent reviewer. Their own letter says so." },
      {
        kind: 'chips',
        options: [
          { label: 'Appeal to the insurer', go: 'appeal' },
          { label: 'Ask my doctor for a letter of medical necessity', go: 'doctor' },
          { label: 'Do both', go: 'both' },
        ],
      },
    ],
    appeal: [
      { kind: 'letter', letterId: 'tasha-appeal' },
      { kind: 'send', letterId: 'tasha-appeal' },
      { kind: 'job', title: 'MRI denial appeal', status: `Sent · Decision due by ${DENIAL_DEADLINE}`, flow: 'denial' },
      { kind: 'end' },
    ],
    doctor: [
      { kind: 'letter', letterId: 'tasha-doctor' },
      { kind: 'send', letterId: 'tasha-doctor' },
      { kind: 'job', title: 'Doctor letter request', status: 'Sent · Waiting on Lakeside Orthopedics', flow: 'denial' },
      { kind: 'end' },
    ],
    both: [
      { kind: 'arik', text: "Doing both is the strongest move. First the appeal to your insurer, then the request to Dr. Rao's office." },
      { kind: 'letter', letterId: 'tasha-appeal' },
      { kind: 'send', letterId: 'tasha-appeal' },
      { kind: 'letter', letterId: 'tasha-doctor' },
      { kind: 'send', letterId: 'tasha-doctor' },
      { kind: 'job', title: 'MRI denial appeal', status: `Sent · Decision due by ${DENIAL_DEADLINE}`, flow: 'denial' },
      { kind: 'end' },
    ],
  },
};

// ---- Flow 1: Lower my prescription cost (real prices) ----
const RX_DRUGS: Record<string, string> = { maria: 'Eliquis', james: 'Eliquis', dana: 'Zepbound' };

export function rxFlow(patient: SampleKey = 'maria', presetDrug?: string | null): Script {
  const seq = (drug: string) => [
    { kind: 'reading' as const, docId: null, lines: RX_LINES },
    { kind: 'rx_results' as const, drug },
    { kind: 'call_card' as const, drug },
    { kind: 'job' as const, title: `${drug} savings`, status: 'Options ready · Call card saved', flow: 'rx' as const },
    { kind: 'end' as const },
  ];
  const start = presetDrug && ['Eliquis', 'Zepbound', 'Dupixent'].includes(presetDrug) ? `drug_${presetDrug}` : 'intro';
  return {
    id: 'rx',
    patient,
    title: 'Prescription savings',
    start,
    sequences: {
      intro: [
        {
          kind: 'arik',
          text:
            patient === 'james'
              ? "Let's find the lowest legal price for your mom's medicine. Which one?"
              : 'Which medicine?',
        },
        {
          kind: 'chips',
          options: [
            { label: 'Eliquis', go: 'drug_Eliquis' },
            { label: 'Zepbound', go: 'drug_Zepbound' },
            { label: 'Dupixent', go: 'drug_Dupixent' },
            { label: 'Snap my prescription label', go: 'label' },
          ],
        },
      ],
      label: [{ kind: 'pick', text: 'Pick the label', docs: ['sample-pharmacy-receipt'], go: 'drug_Eliquis' }],
      drug_Eliquis: seq('Eliquis'),
      drug_Zepbound: seq('Zepbound'),
      drug_Dupixent: seq('Dupixent'),
    },
  };
}

export function defaultRxDrug(patient: SampleKey): string | null {
  return RX_DRUGS[patient] ?? null;
}

export function flowScript(flow: string, patient?: string | null, drug?: string | null): Script | null {
  if (flow === 'bill') return BILL_FLOW;
  if (flow === 'denial') return DENIAL_FLOW;
  if (flow === 'rx') {
    const p = (['maria', 'james', 'dana'].includes(patient ?? '') ? patient : 'maria') as SampleKey;
    return rxFlow(p, drug ?? null);
  }
  return null;
}
