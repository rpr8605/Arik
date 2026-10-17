// Replies (Phase 6): read an incoming reply (inbound fax or the patient's
// upload), classify it, and propose the next step. Pure, no model. The
// classification is a suggestion the patient can change; the proposal is
// only a proposal: approving it drafts a letter at most, and sending that
// letter is its own approval (nothing sends without approval).

import type { ConfirmedDenial, DenialLetterType } from '../rules/denials/types';
import type { LetterType } from '../production/types';

export type ReplyKind = 'approved' | 'denied_again' | 'info_requested' | 'collections_notice' | 'corrected_bill' | 'unknown';
export const REPLY_KINDS: ReplyKind[] = ['approved', 'denied_again', 'info_requested', 'collections_notice', 'corrected_bill', 'unknown'];

export interface ReplyReading {
  kind: ReplyKind;
  signals: string[];     // the phrases that decided it, for the timeline
}

const find = (t: string, re: RegExp) => {
  const m = t.match(re);
  return m ? m[0] : null;
};

export function classifyReply(text: string): ReplyReading {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const signals: string[] = [];
  const hit = (re: RegExp) => {
    const s = find(t, re);
    if (s) signals.push(s);
    return !!s;
  };
  // Most specific first: a collection notice or corrected bill can mention
  // a denial or a request in passing.
  if (hit(/this is an attempt to collect a debt|debt collector|collection agency|(?:placed|referred|assigned) (?:with|to|for) (?:a )?collection/)) return { kind: 'collections_notice', signals };
  if (hit(/corrected (?:bill|statement|claim)|revised (?:bill|statement)|adjusted (?:balance|statement|bill)|we have (?:removed|adjusted|corrected|credited)/)) return { kind: 'corrected_bill', signals };
  if (hit(/(?:need|needs|require|requires|requesting) (?:additional|more) information|please (?:send|provide|submit) (?:the following|us|copies|a copy|additional)|request for (?:additional )?information|we cannot (?:process|complete|decide) .{0,40}until|unable to (?:process|complete) .{0,40}without/)) return { kind: 'info_requested', signals };
  const negApproval = /(?:not|unable to|cannot) (?:be )?approve|not approved/.test(t);
  if (!negApproval && hit(/(?:has|have) been approved|is approved|we (?:have )?approved|overturn(?:ed)? (?:our|the) (?:decision|denial)|revers(?:ed|ing) (?:our|the) (?:decision|denial)|decided in your favor|will (?:now )?(?:cover|pay for|process payment)/)) return { kind: 'approved', signals };
  if (hit(/upheld|uphold|affirm(?:ed|s)? (?:our|the) (?:decision|denial)|(?:still|again) (?:denied|not covered)|has been denied|is denied|not approved|unable to approve|we (?:are )?denying/)) return { kind: 'denied_again', signals };
  return { kind: 'unknown', signals };
}

export interface Proposal {
  step: 'record_outcome' | 'draft_letter' | 'review_new_bill' | 'reply_with_information' | 'wait_for_reviewer' | 'read_it_yourself';
  letterType: LetterType | DenialLetterType | null;   // the letter Arik would draft if approved
  title: string;
  why: string;
}

const EMPLOYER_ACA = ['fully_insured', 'self_funded', 'marketplace'];

// `from` is what was sent; `denial` is the confirmed denial behind it, if any.
export function proposeNextStep(kind: ReplyKind, from: { letterType: LetterType | DenialLetterType; denial: ConfirmedDenial | null }, text = ''): Proposal {
  const d = from.denial;
  switch (kind) {
    case 'approved':
      return { step: 'record_outcome', letterType: null, title: 'Record the win', why: 'The reply says yes. Check the next statement or explanation of benefits matches, then record what you saved.' };
    case 'collections_notice':
      return { step: 'draft_letter', letterType: 'hold_collections', title: 'Ask them to hold collections', why: 'A collection notice arrived while your dispute is open. Arik can draft a letter asking them to pause collections in writing.' };
    case 'corrected_bill':
      return { step: 'review_new_bill', letterType: null, title: 'Check the corrected bill', why: 'They sent a corrected bill. Add it to this case so Arik can check it line by line again.' };
    case 'info_requested':
      return /medical records?|letter of medical necessity|clinical|doctor|physician/i.test(text)
        ? { step: 'draft_letter', letterType: 'medical_necessity_request', title: 'Ask your doctor for what they need', why: 'They asked for medical information. Arik can draft the request to your doctor for a letter and your records.' }
        : { step: 'reply_with_information', letterType: null, title: 'Send what they asked for', why: 'They asked for more information. Gather the items listed in their letter; Arik will help you send them.' };
    case 'denied_again': {
      if (!d) return { step: 'draft_letter', letterType: 'billing_dispute', title: 'Ask again, in writing', why: 'They said no. Arik can draft a follow-up asking a supervisor to review it, with your earlier letter attached.' };
      if (EMPLOYER_ACA.includes(d.planFunding)) return { step: 'draft_letter', letterType: 'external_review_request', title: 'Ask for an external review', why: 'The plan upheld its denial. An independent reviewer can overturn it, and the plan must follow that decision. Add the plan\'s new letter to this case so Arik can work out your deadline.' };
      if (d.planFunding === 'medicare_advantage') return { step: 'wait_for_reviewer', letterType: null, title: 'Watch for the independent reviewer', why: 'Your Medicare Advantage plan must send your case to an independent reviewer on its own. Watch for their letter.' };
      if (d.planFunding === 'medicare_part_d' || d.planFunding === 'medicaid') return { step: 'draft_letter', letterType: 'insurer_appeal', title: d.planFunding === 'medicaid' ? 'Ask for a State fair hearing' : 'Ask the independent review entity', why: 'The plan said no again. The next level is outside the plan. Add the new letter to this case so Arik can work out the deadline, then draft it.' };
      return { step: 'read_it_yourself', letterType: null, title: 'Check the next step on the letter', why: 'The plan said no again. The letter should explain the next level of appeal and its deadline.' };
    }
    default:
      return { step: 'read_it_yourself', letterType: null, title: 'Tell Arik what this says', why: 'Arik could not tell what kind of reply this is. Pick what it says, and Arik will suggest the next step.' };
  }
}
