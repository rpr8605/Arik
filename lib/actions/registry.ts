// Agent action registry (Phase 6, M16; BEHAVIOR.md autonomy tiers). Pure.
// Arik chooses only from these actions. Each one says its tier, what only
// the patient may do, whether it leaves the system, what must be in place
// first, and whether it leaves a receipt. canRun() is the one gate the
// data layer calls before doing anything (M16-AC8: signing, attesting,
// paying and marketing opt-ins are impossible without the patient).

export type Tier = 0 | 1 | 2 | 3;
export type PatientOnly = 'sign' | 'approve' | 'attest' | 'pay' | 'marketing_opt_in';
export type Requirement = 'authorization' | 'frozen_letter' | 'signed_letter' | 'patient_approval';

export type ActionType =
  | 'draft_letter'
  | 'authorize_arik'
  | 'sign_letter'
  | 'send_fax'
  | 'send_mail'
  | 'track_delivery'
  | 'record_reply'
  | 'propose_next_step'
  | 'decide_proposal'
  | 'notify'
  | 'attest_medical_facts'
  | 'pay_on_behalf'
  | 'marketing_opt_in';

export interface ActionDef {
  type: ActionType;
  tier: Tier;
  label: string;
  patientOnly: PatientOnly[];      // steps no one but the patient may take
  leavesSystem: boolean;
  reversible: boolean;
  requires: Requirement[];
  dataShared: string[];            // what leaves Arik, in plain words
  receipt: boolean;
  built: boolean;                  // false: listed so the gate refuses it, never built (Tier 3 or not yet)
}

export const ACTIONS: Record<ActionType, ActionDef> = {
  draft_letter: { type: 'draft_letter', tier: 0, label: 'Draft a letter', patientOnly: [], leavesSystem: false, reversible: true, requires: [], dataShared: [], receipt: false, built: true },
  authorize_arik: { type: 'authorize_arik', tier: 2, label: 'Let Arik send letters and receive replies for you', patientOnly: ['sign'], leavesSystem: false, reversible: true, requires: [], dataShared: [], receipt: true, built: true },
  sign_letter: { type: 'sign_letter', tier: 2, label: 'Sign a letter', patientOnly: ['sign'], leavesSystem: false, reversible: false, requires: ['frozen_letter'], dataShared: [], receipt: true, built: true },
  send_fax: { type: 'send_fax', tier: 2, label: 'Fax a letter', patientOnly: ['approve'], leavesSystem: true, reversible: false, requires: ['authorization', 'frozen_letter', 'signed_letter', 'patient_approval'], dataShared: ['the signed letter', 'the recipient fax number', 'a return fax number for this case'], receipt: true, built: true },
  send_mail: { type: 'send_mail', tier: 2, label: 'Mail a letter', patientOnly: ['approve'], leavesSystem: true, reversible: false, requires: ['authorization', 'frozen_letter', 'signed_letter', 'patient_approval'], dataShared: ['the signed letter', 'the recipient address', 'your return address'], receipt: true, built: true },
  track_delivery: { type: 'track_delivery', tier: 1, label: 'Watch for delivery', patientOnly: [], leavesSystem: false, reversible: true, requires: [], dataShared: [], receipt: false, built: true },
  record_reply: { type: 'record_reply', tier: 1, label: 'Read a reply', patientOnly: [], leavesSystem: false, reversible: true, requires: [], dataShared: [], receipt: true, built: true },
  propose_next_step: { type: 'propose_next_step', tier: 0, label: 'Suggest the next step', patientOnly: [], leavesSystem: false, reversible: true, requires: [], dataShared: [], receipt: false, built: true },
  decide_proposal: { type: 'decide_proposal', tier: 2, label: 'Approve or dismiss a suggested step', patientOnly: ['approve'], leavesSystem: false, reversible: true, requires: ['patient_approval'], dataShared: [], receipt: true, built: true },
  notify: { type: 'notify', tier: 1, label: 'Tell you something changed', patientOnly: [], leavesSystem: true, reversible: false, requires: [], dataShared: ['that there is an update (no health details)'], receipt: false, built: true },
  // Tier 3 (BEHAVIOR.md): listed so the gate always refuses them.
  attest_medical_facts: { type: 'attest_medical_facts', tier: 3, label: 'Attest to medical facts', patientOnly: ['attest'], leavesSystem: true, reversible: false, requires: [], dataShared: [], receipt: true, built: false },
  pay_on_behalf: { type: 'pay_on_behalf', tier: 3, label: 'Pay for the patient', patientOnly: ['pay'], leavesSystem: true, reversible: false, requires: [], dataShared: [], receipt: true, built: false },
  marketing_opt_in: { type: 'marketing_opt_in', tier: 3, label: 'Opt in to marketing', patientOnly: ['marketing_opt_in'], leavesSystem: true, reversible: true, requires: [], dataShared: [], receipt: true, built: false },
};

export interface RunState {
  actor: 'patient' | 'arik';           // who is taking this step
  authorizationOnFile: boolean;
  letterFrozen: boolean;
  letterSigned: boolean;
  patientApproved: boolean;            // a fresh one-tap approval for THIS action
}

export type Gate = { ok: true } | { ok: false; reason: string };

export function canRun(type: ActionType, s: RunState): Gate {
  const a = ACTIONS[type];
  if (!a) return { ok: false, reason: 'not in the action registry' };
  if (!a.built || a.tier === 3) return { ok: false, reason: `${a.label} is something Arik never does` };
  if (a.patientOnly.length && s.actor !== 'patient') return { ok: false, reason: `only you can ${a.patientOnly.join(' or ')} here` };
  for (const r of a.requires) {
    if (r === 'authorization' && !s.authorizationOnFile) return { ok: false, reason: 'sign the authorization first' };
    if (r === 'frozen_letter' && !s.letterFrozen) return { ok: false, reason: 'save the final copy of the letter first' };
    if (r === 'signed_letter' && !s.letterSigned) return { ok: false, reason: 'sign the letter first' };
    if (r === 'patient_approval' && !s.patientApproved) return { ok: false, reason: 'approve this step first' };
  }
  if (a.leavesSystem && a.tier >= 2 && !s.patientApproved) return { ok: false, reason: 'nothing leaves Arik without your approval' };
  return { ok: true };
}
