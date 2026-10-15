// Letters for the demo walkthroughs, written once and stored as fixtures
// (docs/kimi/DEMO_WALKTHROUGHS.md: no live letter drafting today). Plain,
// calm and specific, from the patient, never legal advice. Every person,
// office, address and number here is made up; fax numbers are 555-01xx.
// "{phone}" is the one editable field (Edit in the letter view).

export const LETTER_FOOTER =
  'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.';

export interface Recipient {
  name: string;
  dept: string;
  address: string;
  fax: string;
  email: string;
  portal: string;
}

export interface DemoLetter {
  id: string;
  title: string;
  from: string;
  date: string;
  to: Recipient;
  subject: string;
  paragraphs: string[];
  signoff: string;
  attachments: string[];
}

const RIVERBEND: Recipient = {
  name: 'Riverbend General Hospital',
  dept: 'Patient Billing Office',
  address: '1200 Riverbend Parkway, Mesa Vista, AZ 85000',
  fax: '(480) 555-0142',
  email: 'billing@riverbend-general.example',
  portal: 'Riverbend patient portal',
};

const SUMMIT_APPEALS: Recipient = {
  name: 'Summit Peak Health Plan',
  dept: 'Appeals and Grievances',
  address: 'PO Box 0177, Fairhaven, OH 43000',
  fax: '(614) 555-0177',
  email: 'appeals@summitpeak.example',
  portal: 'Summit Peak member portal',
};

const LAKESIDE: Recipient = {
  name: 'Lakeside Orthopedics',
  dept: 'Office of Dr. Anita Rao',
  address: '45 Lakeside Drive, Fairhaven, OH 43000',
  fax: '(614) 555-0163',
  email: 'records@lakeside-ortho.example',
  portal: 'Lakeside patient portal',
};

export const LETTERS: Record<string, DemoLetter> = {
  'luis-dispute': {
    id: 'luis-dispute',
    title: 'Billing dispute',
    from: 'Luis Moreno, account RGH-4471902, phone {phone}',
    date: 'October 15, 2026',
    to: RIVERBEND,
    subject: 'Dispute of charges on account RGH-4471902 (visit 09/03/2026 to 09/05/2026)',
    paragraphs: [
      'I am writing about my statement dated 09/20/2026. I reviewed it line by line and I am disputing these charges:',
      '1. Blood count test (85025) is listed twice on 09/03/2026. I received one test. Please remove the duplicate charge of $186.00.',
      '2. A basic blood chemistry panel (80048) was billed along with a full panel (80053) on the same day. The full panel includes the basic tests. Please remove the $412.00 charge for the basic panel.',
      '3. Room and board is billed for 3 days. I was admitted on 09/03/2026 and discharged on 09/05/2026, which is 2 nights. Please remove one day, $2,950.00.',
      'Please send me a corrected statement and a fully itemized bill. While this is under review, please hold my account and do not send it to collections.',
      'You can reach me at {phone}. Thank you for your help.',
    ],
    signoff: 'Luis Moreno',
    attachments: ['Hospital statement dated 09/20/2026 (sample)', 'List of disputed charges from Arik'],
  },
  'luis-itemized': {
    id: 'luis-itemized',
    title: 'Request for an itemized bill',
    from: 'Luis Moreno, account RGH-4471902, phone {phone}',
    date: 'October 15, 2026',
    to: RIVERBEND,
    subject: 'Request for a fully itemized bill, account RGH-4471902',
    paragraphs: [
      'Please send me a fully itemized bill for my visit from 09/03/2026 to 09/05/2026. For each charge, please include the date, the billing code, the quantity and the amount.',
      'Several charges on my statement look like they may be duplicates or errors, and I would like to review the full detail before I pay.',
      'While I wait for the itemized bill, please hold my account and do not send it to collections.',
      'You can reach me at {phone}. Thank you.',
    ],
    signoff: 'Luis Moreno',
    attachments: ['Hospital statement dated 09/20/2026 (sample)'],
  },
  'tasha-appeal': {
    id: 'tasha-appeal',
    title: 'Appeal to the insurer',
    from: 'Tasha Brooks, member ID SPH-000-118-204, phone {phone}',
    date: 'October 15, 2026',
    to: SUMMIT_APPEALS,
    subject: 'Appeal of claim SP-26-0922-4410 (knee MRI, code 73721), denied October 6, 2026',
    paragraphs: [
      'I am appealing your decision of October 6, 2026 to deny my knee MRI (code 73721, done 09/22/2026). The denial says the records did not show at least 6 weeks of conservative treatment, such as physical therapy.',
      'I did try conservative treatment first. I completed physical therapy for this knee starting in February 2026, and my plan approved additional therapy visits at that time. My knee pain continued after therapy, so my doctor ordered the MRI.',
      'I have asked Dr. Anita Rao at Lakeside Orthopedics to send a letter of medical necessity and my therapy records. Please include them in your review.',
      'Please review this decision again. If you uphold the denial, please tell me how to request an external review by an independent review organization, as your letter describes.',
      'You can reach me at {phone}.',
    ],
    signoff: 'Tasha Brooks',
    attachments: ['Denial letter dated October 6, 2026 (sample)', 'Explanation of benefits (sample)', 'Physical therapy records (requested)'],
  },
  'tasha-doctor': {
    id: 'tasha-doctor',
    title: 'Request to my doctor',
    from: 'Tasha Brooks, phone {phone}',
    date: 'October 15, 2026',
    to: LAKESIDE,
    subject: 'Request for a letter of medical necessity and records for my knee MRI appeal',
    paragraphs: [
      'Dr. Rao, my insurer, Summit Peak Health Plan, denied the knee MRI you ordered (done 09/22/2026). They say the records did not show 6 weeks of conservative treatment before imaging.',
      'I am appealing. Could your office please send me, or fax directly to Summit Peak Appeals at (614) 555-0177:',
      '1. A letter of medical necessity explaining why the MRI was needed.',
      '2. My records showing the physical therapy I did for this knee starting in February 2026, and how my symptoms continued afterward.',
      'My appeal must be received by April 4, 2027. Thank you for your help. You can reach me at {phone}.',
    ],
    signoff: 'Tasha Brooks',
    attachments: ['Denial letter dated October 6, 2026 (sample)'],
  },
};

export function fillLetter(text: string, phone: string): string {
  return text.replaceAll('{phone}', phone.trim() || '(phone number)');
}
