// Denial codes (CARC/RARC), numbers only. No X12 description is copied
// anywhere (spec Appendix B4 ground rules). Arik's own per-code wording
// lives in db/041's denial_codes table as 'needs_review' and is shown only
// once the owner approves it; the screen otherwise shows the number, a
// link to x12.org and the plain explanation of the denial CATEGORY below,
// which the patient confirms.

import type { DenialCategory } from './types';

export const X12_CODES_URL = 'https://x12.org/codes';

// Which category a CARC number suggests. A suggestion for the confirm
// screen only: the patient confirms the category.
const CARC_CATEGORY: Record<string, DenialCategory> = {
  // care judged not needed
  '50': 'medical_necessity', '56': 'medical_necessity', '150': 'medical_necessity', '151': 'medical_necessity',
  // approval or referral missing
  '15': 'no_prior_authorization', '197': 'no_prior_authorization', '198': 'no_prior_authorization',
  // paperwork: coding, missing information, duplicates, filing time, eligibility
  '4': 'administrative', '11': 'administrative', '16': 'administrative', '18': 'administrative', '22': 'administrative', '29': 'administrative', '31': 'administrative',
  '125': 'administrative', '140': 'administrative', '181': 'administrative', '182': 'administrative', '206': 'administrative', '252': 'administrative',
  // not a covered benefit
  '49': 'excluded_service', '55': 'excluded_service', '96': 'excluded_service', '109': 'excluded_service', '119': 'excluded_service', '167': 'excluded_service', '204': 'excluded_service',
};

export function categoryFromCodes(carc: string[]): DenialCategory | null {
  // Most specific first: a medical necessity or approval code decides the
  // argument even when a paperwork code rides along.
  const order: DenialCategory[] = ['no_prior_authorization', 'medical_necessity', 'excluded_service', 'administrative'];
  const found = new Set(carc.map((c) => CARC_CATEGORY[c]).filter(Boolean));
  return order.find((c) => found.has(c)) ?? null;
}

// The patient's screen: our words for each category (always shown).
export const CATEGORY_TEXT: Record<DenialCategory, { title: string; plain: string }> = {
  no_reason_given: { title: 'No reason given', plain: 'The letter says no, but not why. You have a right to know the specific reason.' },
  administrative: { title: 'A paperwork problem', plain: 'Something about how the claim was filled out or sent, not a decision about your care. These are often fixed by the doctor\'s office.' },
  excluded_service: { title: 'Not covered by the plan', plain: 'The plan says your benefits do not include this. Ask exactly which words in the plan it relied on.' },
  no_prior_authorization: { title: 'Approval was needed first', plain: 'The plan says it had to approve this before you got it. Check whether an approval was asked for or given.' },
  medical_necessity: { title: 'Not medically necessary', plain: 'The plan does not agree the care was needed. Your doctor\'s letter and records are the usual answer.' },
  other: { title: 'Another reason', plain: 'The reason does not fit the usual groups. Arik will help you answer what the letter says.' },
};

export const isCarc = (s: string) => /^\d{1,3}$/.test(s) && Number(s) > 0;
export const isRarc = (s: string) => /^(M|N|MA)\d{1,3}$/.test(s);
