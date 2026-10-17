// Denial letter templates (Phase 5). Pure: the confirmed denial, the check
// flags and the argument points in, a complete letter out, written by
// code. Every name, date, code and number comes from the confirmed denial,
// a computed deadline or a rule (denialLetterProblems proves it). The
// medical necessity request asks the doctor for a letter; Arik writes no
// clinical judgment. Download only: nothing is sent.

import { LETTER_FOOTER } from '../walkthrough/letters';
import { buildArguments, type AppealArgument, type ArgumentContext } from '../rules/denials/arguments';
import { reasonRuleId } from '../rules/denials/checks';
import { usDate } from '../rules/denials/format';
import { DENIAL_RULES, patientDeadline, rule } from '../rules/denials/rules';
import type { ConfirmedDenial, DenialFlag, DenialLetterType, PatientDeadline } from '../rules/denials/types';
import type { LetterParts } from './templates';

export interface DenialLetterInput {
  type: DenialLetterType;
  patient: { name: string; phone: string | null };
  denial: ConfirmedDenial;
  flags: DenialFlag[];
  context: ArgumentContext;
  date: string;              // ISO, the letter date
}

const EMPLOYER_ACA = ['fully_insured', 'self_funded', 'marketplace'];

// Which letters fit this denial, best first.
export function denialLetterOptions(d: ConfirmedDenial, flags: DenialFlag[]): DenialLetterType[] {
  const out: DenialLetterType[] = [];
  const has = (id: DenialFlag['id']) => flags.some((f) => f.id === id);
  if (has('missing_specific_reason')) out.push('specific_reason_request');
  if (d.planFunding === 'self_funded') out.push('claim_file_request');
  const finalEmployer = EMPLOYER_ACA.includes(d.planFunding) && d.appealLevel === 'internal_appeal';
  const maUpheld = d.planFunding === 'medicare_advantage' && d.appealLevel === 'internal_appeal';
  if (finalEmployer) out.push('external_review_request');
  else if (!maUpheld) out.push('insurer_appeal');
  if (d.category === 'medical_necessity') out.push('medical_necessity_request');
  if (d.planFunding === 'medicare_part_d' && d.appealLevel === 'initial' && (d.category === 'excluded_service' || d.category === 'other')) out.push('part_d_exception');
  if (EMPLOYER_ACA.includes(d.planFunding) && !out.includes('claim_file_request')) out.push('claim_file_request');
  return out;
}

function appealName(d: ConfirmedDenial): string {
  if (d.planFunding === 'medicare_part_d') return d.appealLevel === 'initial' ? 'redetermination' : 'reconsideration by the independent review entity';
  if (d.planFunding === 'medicare_advantage') return 'reconsideration';
  if (d.planFunding === 'medicaid') return d.appealLevel === 'initial' ? 'appeal' : 'State fair hearing';
  return 'internal appeal';
}

export function buildDenialLetter(input: DenialLetterInput): LetterParts & { arguments: AppealArgument[] } {
  const { denial: d, patient } = input;
  const payer = d.payerName ?? 'the plan';
  const claim = d.claimNumber ? `claim ${d.claimNumber}` : 'my claim';
  const service = d.serviceOrDrug ? `${d.serviceOrDrug}${d.serviceCode ? ` (code ${d.serviceCode})` : ''}` : d.serviceCode ? `code ${d.serviceCode}` : 'the care you denied';
  const dos = d.dateOfService ? `, date of service ${usDate(d.dateOfService)}` : '';
  const notice = `your letter dated ${usDate(d.noticeDate)}`;
  const reach = patient.phone ? `You can reach me at ${patient.phone}.` : 'You can reach me at the phone number on file with you.';
  const quote = d.statedReason ? ` Your letter says: "${d.statedReason}"` : '';
  const codes = d.carcCodes.length ? ` The denial codes listed are ${d.carcCodes.join(', ')}.` : '';
  const dl: PatientDeadline | null = patientDeadline(d);
  const args = buildArguments(d, input.flags, input.context);
  const base = { greeting: `To ${payer},`, signoff: `Sincerely,\n${patient.name}` };
  const numbered = (xs: string[]) => xs.map((s, i) => `${i + 1}. ${s}`);

  switch (input.type) {
    case 'insurer_appeal': {
      const name = appealName(d);
      return {
        ...base,
        arguments: args,
        subject: `Request for ${name}, ${claim}`,
        opening: `I am asking for a ${name} of the decision in ${notice} about ${service}${dos}.${quote}${codes}`,
        items: numbered(args.map((a) => a.sentence)),
        request: `Please reverse this decision and cover ${d.serviceOrDrug ?? 'this care'}.${d.isUrgent ? ' This is urgent, and I ask for an expedited (fast) decision.' : ''} Please send your decision to me in writing.`,
        closing: `${reach} Thank you.`,
      };
    }
    case 'external_review_request':
      return {
        ...base,
        arguments: args,
        subject: `Request for external review, ${claim}`,
        opening: `I am asking for an external review of your final internal decision in ${notice} about ${service}${dos} (45 CFR 147.136).${quote}`,
        items: numbered(args.filter((a) => a.type !== 'review_again').map((a) => a.sentence)),
        request: `Please send my request and my claim file to an independent review organization, and tell me in writing which organization was assigned.${d.isUrgent ? ' This is urgent, and I ask for an expedited external review.' : ''}`,
        closing: `${reach} Thank you.`,
      };
    case 'claim_file_request': {
      const items = ['Copies of all documents, records and other information relevant to my claim, free of charge (29 CFR 2560.503-1(h)(2)(iii)).', 'The plan documents that apply to this claim, including the summary plan description.', 'The diagnosis and treatment codes on the claim and what they mean (45 CFR 147.136(b)(2)(ii)(E)(2)). This request is not itself an appeal.'];
      if (d.category === 'medical_necessity') items.push('The clinical reasoning and any criteria or guideline you relied on (29 CFR 2560.503-1(g)(1)(v)(B)).');
      return {
        ...base,
        arguments: args,
        subject: `Request for my claim file, ${claim}`,
        opening: `I am writing about ${notice} about ${service}${dos}. Before I appeal, please send me:`,
        items: numbered(items),
        request: dl?.due ? `My appeal deadline is ${usDate(dl.due)}, so please send these as soon as possible.` : 'Please send these as soon as possible.',
        closing: `${reach} Thank you.`,
      };
    }
    case 'specific_reason_request': {
      const rid = reasonRuleId(d);
      const cite = rid ? ` (${rule(rid).citation.cite})` : '';
      return {
        ...base,
        arguments: args,
        subject: `Request for the specific reason for your decision, ${claim}`,
        opening: `${capital(notice)} denied ${service}${dos}, but it does not give the specific reason${cite}.`,
        items: numbered(['The specific reason for the denial.', 'The denial code and what it means, and the plan rule or standard you used.', 'Any internal guideline or criterion you relied on.']),
        request: dl?.due ? `I need this to prepare my appeal, which is due ${usDate(dl.due)}. Please reply in writing as soon as possible.` : 'I need this to prepare my appeal. Please reply in writing as soon as possible.',
        closing: `${reach} Thank you.`,
      };
    }
    case 'part_d_exception':
      return {
        ...base,
        arguments: args,
        subject: `Request for a coverage exception for ${d.serviceOrDrug ?? 'my drug'}`,
        opening: `I am asking for an exception so my plan covers ${service} (42 CFR 423.578)${d.claimNumber ? `, regarding ${claim}` : ''}.${quote}`,
        items: numbered([`My prescriber will send, or has enclosed, a supporting statement, which the rule requires (42 CFR 423.578).`, 'Please tell me in writing if you need anything else to decide.']),
        request: d.isUrgent ? 'This is urgent, and I ask for an expedited decision.' : 'Please send your decision to me in writing.',
        closing: `${reach} Thank you.`,
      };
    case 'medical_necessity_request': {
      const items = [
        'A letter, in your own words, explaining why I need this care. Please include anything you know about the plan\'s reason for saying no.',
        'My medical records related to this care, including office notes and any test results.',
      ];
      if (d.isPriorAuthDecision || d.category === 'no_prior_authorization') items.push('Any record of a request for approval your office sent to the plan, and the plan\'s reply.');
      return {
        ...base,
        greeting: `To ${d.providerName ? `the office of ${d.providerName}` : 'my doctor\'s office'},`,
        arguments: args,
        subject: `Request for a letter and records for my appeal, ${claim}`,
        opening: `${payer} denied ${service}${dos} in a letter dated ${usDate(d.noticeDate)}.${quote} I am appealing, and I am asking for your help. Please send me:`,
        items: numbered(items),
        request: dl?.due ? `My appeal is due ${usDate(dl.due)}, so please send these before then.` : 'Please send these as soon as you can.',
        closing: `${reach} Thank you for your help.`,
      };
    }
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- The contract every denial letter honors ----------

const EM_DASH = String.fromCharCode(0x2014);
const EXTRA_CITES = ['29 CFR 2560.503-1(g)(1)(v)(B)', '29 CFR 2560.503-1(h)(2)(iii)', '45 CFR 147.136(b)(2)(ii)(E)(2)', '45 CFR 147.136', '42 CFR 423.578', '42 CFR 422.101(b)', '42 CFR 423.568(h)', '42 CFR 423.590(c)', '42 CFR 438.402(c)(1)(i)(A)'];
// Clinical judgment Arik must never write (M12-AC4).
const CLINICAL = /\b(?:this|the) (?:care|service|treatment|drug|medication|procedure|test) (?:is|was) (?:medically necessary|necessary|appropriate|needed)\b|\bclinically (?:indicated|appropriate)\b|\bstandard of care\b/i;

export function denialLetterProblems(letter: { subject: string; body: string; footer: string }, input: DenialLetterInput): string[] {
  const p: string[] = [];
  const d = input.denial;
  if (letter.footer !== LETTER_FOOTER) p.push('footer is not the required text');
  const all = `${letter.subject}\n${letter.body}`;
  if (all.includes(EM_DASH)) p.push('em dash');
  if (/[{}]/.test(all)) p.push('unfilled placeholder');
  if (/\b(attorney|lawyer|lawsuit|sue|legal action|legal advice|court)\b/i.test(all)) p.push('legal-advice or threat wording');
  // The plan's own quoted words may say anything; the rest may not judge care.
  const own = d.statedReason ? all.split(d.statedReason).join(' ') : all;
  if (CLINICAL.test(own)) p.push('clinical judgment');
  // Grounding: strip everything that came from the record or a rule; no
  // digit may remain.
  const dl = patientDeadline(d);
  const flagLimits = input.flags.map((f) => f.limit).filter((x): x is NonNullable<DenialFlag['limit']> => !!x);
  const allowedText = [
    ...DENIAL_RULES.flatMap((r) => r.citation.cite.split('; ')), ...EXTRA_CITES,
    d.statedReason, d.serviceOrDrug, d.payerName, d.providerName, d.claimNumber, d.serviceCode, d.priorAuth?.reference, input.patient.phone, input.patient.name,
    d.carcCodes.join(', '), ...d.carcCodes, ...d.rarcCodes,
    ...flagLimits.map((l) => `${l.amount} ${l.unit}`),
    ...[d.noticeDate, d.dateOfService, d.requestDate, d.priorAuth?.validFrom, d.priorAuth?.validTo, dl?.due, input.date].filter((x): x is string => !!x).map(usDate),
    ...(input.context.coverageRules ?? []).flatMap((r) => [r.displayId, r.title]),
    'Part D', 'Part B',
  ].filter((x): x is string => !!x).sort((a, b) => b.length - a.length);
  let rest = all.replace(/^\d{1,2}\. /gm, '');   // list numbers
  for (const a of allowedText) rest = rest.split(a).join(' ');
  for (const m of rest.match(/\d[\d/.,-]*/g) ?? []) p.push(`number not from the record or a rule: ${m}`);
  if (d.claimNumber && !all.includes(d.claimNumber)) p.push('claim number missing');
  return p;
}
