// Letter templates (Phase 4, docs/kimi/PLAN_PHASES_2_4.md section 5).
// Pure: the confirmed bill and the findings in, a complete letter out,
// written entirely in code. Every name, date, account number and dollar
// amount comes from the confirmed bill or a finding; nothing is guessed.
// The model may only rewrite the bounded opening and closing paragraphs
// (lib/production/real/letterDrafter.ts), never the itemized requests.
// Letters to institutions stay in English (the plan); the patient-facing
// explanation of a letter is EN/ES elsewhere.

import type { ConfirmedBill, Finding, LetterInput, LetterType } from '../production/types';

export const BILL_LETTER_TYPES: LetterType[] = ['itemized_bill_request', 'billing_dispute', 'hold_collections', 'financial_assistance_cover'];

export const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Line = ConfirmedBill['lines'][number];
const named = (l: Line) => {
  const d = l.description ? capital(l.description) : 'A charge';
  return l.code ? `${d} (${l.code})` : d;
};

// One sentence (or two) per finding, in the patient's voice.
export function findingRequest(f: Finding, bill: ConfirmedBill): string {
  const ls = f.lines.map((i) => bill.lines[i]);
  const l = ls[0];
  const amt = f.amountUsd != null ? money(f.amountUsd) : null;
  const on = l.date ? ` on ${usDate(l.date)}` : '';
  switch (f.ruleId) {
    case 'duplicate_charge':
      return `${named(l)} is listed ${ls.length === 2 ? 'twice' : `${ls.length} times`}${on}. I received it once. Please remove the duplicate charge${ls.length > 2 ? 's' : ''} of ${amt}.`;
    case 'ncci_ptp': {
      const [main, inc] = [ls[0], ls[1]];
      return f.tone === 'wrong'
        ? `${named(inc)} was billed along with ${named(main).charAt(0).toLowerCase() + named(main).slice(1)}${on}. The second already includes the first. Please remove the ${amt} charge for ${(inc.description ?? 'it').toLowerCase()}.`
        : `${named(inc)} was billed along with ${named(main).charAt(0).toLowerCase() + named(main).slice(1)}${on}. These are usually billed as one. Please explain why both were charged${amt ? `, or remove the ${amt} charge` : ''}.`;
    }
    case 'room_days': {
      const days = ls.reduce((t, x) => t + (x.units ?? 0), 0);
      const { serviceFrom: from, serviceTo: to } = bill.header;
      const nights = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : null;
      const extra = nights != null ? days - nights : null;
      return `Room and board is billed for ${days} days. I was admitted on ${usDate(from!)} and discharged on ${usDate(to!)}, which is ${nights} night${nights === 1 ? '' : 's'}. Please remove ${extra === 1 ? 'one day' : `${extra} days`}, ${amt}.`;
    }
    case 'mue_units': {
      const units = ls.reduce((t, x) => t + (x.units ?? 1), 0);
      return `${named(l)} is billed ${units} times${on}. Please explain why that many were needed, or correct the charge.`;
    }
    case 'near_duplicate':
      return `${named(l)} appears ${ls.length} times${on} at different prices. Please confirm that each was a separate service.`;
    case 'ask_about':
      return l.description && !l.code
        ? `Please explain the ${money(l.chargeUsd ?? 0)} charge listed as "${l.description}"${on} and list what it includes.`
        : `Please explain the ${money(l.chargeUsd ?? 0)} charge for ${named(l).charAt(0).toLowerCase() + named(l).slice(1)}${on}.`;
    case 'price_benchmark':
      return `Please explain how the ${money(l.chargeUsd ?? 0)} charge for ${named(l).charAt(0).toLowerCase() + named(l).slice(1)}${on} was set.`;
    default:
      return `Please review the charge for ${named(l).charAt(0).toLowerCase() + named(l).slice(1)}${on}.`;
  }
}

export interface LetterParts {
  subject: string;
  greeting: string;
  opening: string;          // bounded: the model may rewrite this
  items: string[];          // fixed: code only
  request: string;          // fixed
  closing: string;          // bounded: the model may rewrite this
  signoff: string;
}

export function buildLetter(input: LetterInput): LetterParts {
  const { bill, findings, patient } = input;
  const h = bill.header;
  const acct = h.accountNumber ? `account ${h.accountNumber}` : 'my account';
  const visit = h.serviceFrom ? (h.serviceTo && h.serviceTo !== h.serviceFrom ? ` (visit ${usDate(h.serviceFrom)} to ${usDate(h.serviceTo)})` : ` (visit ${usDate(h.serviceFrom)})`) : '';
  const stmt = h.statementDate ? `my statement dated ${usDate(h.statementDate)}` : 'my statement';
  const reach = patient.phone ? `You can reach me at ${patient.phone}.` : 'You can reach me at the phone number on my account.';
  const base = { greeting: `To the ${input.recipient.name} billing office,`, signoff: `Sincerely,\n${patient.name}` };
  switch (input.type) {
    case 'billing_dispute': {
      const wrong = findings.filter((f) => f.tone === 'wrong');
      const ask = findings.filter((f) => f.tone === 'ask');
      if (!findings.length) throw new Error('a billing dispute needs at least one finding');
      const items = [
        ...wrong.map((f, i) => `${i + 1}. ${findingRequest(f, bill)}`),
        ...(ask.length ? [wrong.length ? 'I also have questions about these charges:' : 'I have questions about these charges:'] : []),
        ...ask.map((f, i) => `${wrong.length + i + 1}. ${findingRequest(f, bill)}`),
      ];
      return {
        ...base,
        subject: `Dispute of charges on ${acct}${visit}`,
        opening: `I am writing about ${stmt}. I reviewed it line by line${wrong.length ? ' and I am disputing these charges' : ''}:`,
        items,
        request: 'Please send me a corrected statement and a fully itemized bill. While this is under review, please hold my account and do not send it to collections.',
        closing: `${reach} Thank you for your help.`,
      };
    }
    case 'itemized_bill_request':
      return {
        ...base,
        subject: `Request for an itemized bill, ${acct}${visit}`,
        opening: `I am writing about ${stmt}. I would like to review the charges before I pay.`,
        items: [],
        request: 'Please send me a fully itemized bill that lists each charge with its date, billing code, units and amount. While I review it, please hold my account and do not send it to collections.',
        closing: `${reach} Thank you for your help.`,
      };
    case 'hold_collections':
      return {
        ...base,
        subject: `Please hold ${acct} while it is under review`,
        opening: `I am reviewing the charges on ${stmt}${findings.length ? ' and have asked about some of them' : ''}.`,
        items: [],
        request: 'Please place my account on hold and do not send it to collections or report it while the review is open. Please confirm in writing that the hold is in place.',
        closing: `${reach} Thank you.`,
      };
    case 'financial_assistance_cover':
      return {
        ...base,
        greeting: `To the ${input.recipient.name} financial assistance office,`,
        subject: `Financial assistance application, ${acct}${visit}`,
        opening: `Enclosed is my application for financial assistance for ${acct}.`,
        items: [],
        request: 'Please hold collection activity on this account while my application is reviewed, and let me know in writing if anything else is needed.',
        closing: `${reach} Thank you for your help.`,
      };
    default:
      // Appeals and records requests are written from a denial letter, not
      // a bill: they come with the denial flow.
      throw new Error(`${input.type} letters are written from a denial letter, not a bill`);
  }
}

export const joinBody = (p: LetterParts) => [p.greeting, p.opening, ...p.items, p.request, p.closing, p.signoff].join('\n\n');
export const letterDateLine = (iso: string) => longDate(iso);
