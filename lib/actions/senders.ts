// Send executors (Phase 6, M16-AC9) behind interfaces, demo and real side
// by side, one contract (scripts/test_actions.ts runs it on both).
// - Demo executors: deterministic, labeled "Practice send". Nothing leaves
//   Arik; the events and confirmation numbers are simulated and say so.
// - Real executors: stubs that refuse until a fax or mail vendor that has
//   signed a BAA is configured. Only such a vendor may ever be added here.
// SEND_EXECUTOR picks: unset or 'demo' -> demo; anything else -> the
// refusing stubs (a misconfiguration fails closed, never sends).

import { createHash } from 'node:crypto';

export type SendEventKind = 'queued' | 'sent' | 'delivered' | 'failed' | 'printed' | 'mailed' | 'in_transit';
export interface SendEvent {
  kind: SendEventKind;
  at: string;            // ISO
  detail: string;        // plain words, no patient data
}

export interface SendResult {
  confirmation: string;  // the vendor's confirmation number
  tracking: string | null;
  events: SendEvent[];
  practice: boolean;     // true: simulated, nothing left Arik
}

export interface Address {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
}

export interface FaxSender {
  readonly name: string;
  readonly allowsRealPatientData: boolean;   // true only for a vendor under a signed BAA
  send(req: { jobId: string; to: string; pdf: Uint8Array; now: Date }): Promise<SendResult>;
  inboundNumber(caseId: string): Promise<string>;
}

export interface MailSender {
  readonly name: string;
  readonly allowsRealPatientData: boolean;
  send(req: { jobId: string; to: Address; from: Address; pdf: Uint8Array; certified: boolean; now: Date }): Promise<SendResult>;
}

const short = (s: string, n = 10) => createHash('sha256').update(s).digest('hex').slice(0, n).toUpperCase();
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

export const FAX_RE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
export const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const demoFaxSender: FaxSender = {
  name: 'demo-fax',
  allowsRealPatientData: false,
  async send({ jobId, to, pdf, now }) {
    if (!FAX_RE.test(to.trim())) throw new Error('not a fax number');
    if (!pdf.length) throw new Error('nothing to send');
    return {
      confirmation: `PRACTICE-FAX-${short(jobId)}`,
      tracking: null,
      practice: true,
      events: [
        { kind: 'queued', at: now.toISOString(), detail: 'Practice send: queued. Nothing left Arik.' },
        { kind: 'sent', at: plus(now, 1 * MIN), detail: 'Practice send: fax transmitted (simulated).' },
        { kind: 'delivered', at: plus(now, 2 * MIN), detail: 'Practice send: the receiving fax confirmed all pages (simulated).' },
      ],
    };
  },
  // A practice return "number" that cannot be dialed, one per case.
  async inboundNumber(caseId) {
    return `PRACTICE-${short(caseId, 6)}`;
  },
};

export const demoMailSender: MailSender = {
  name: 'demo-mail',
  allowsRealPatientData: false,
  async send({ jobId, to, from, pdf, certified, now }) {
    for (const a of [to, from]) if (!a.name.trim() || !a.line1.trim() || !a.city.trim() || !/^[A-Z]{2}$/.test(a.state) || !ZIP_RE.test(a.zip)) throw new Error('incomplete address');
    if (!pdf.length) throw new Error('nothing to send');
    const tracking = certified ? `PRACTICE-CERT-${short(`${jobId}-track`, 12)}` : null;
    return {
      confirmation: `PRACTICE-MAIL-${short(jobId)}`,
      tracking,
      practice: true,
      events: [
        { kind: 'queued', at: now.toISOString(), detail: 'Practice send: queued. Nothing left Arik.' },
        { kind: 'printed', at: plus(now, 2 * 60 * MIN), detail: 'Practice send: printed (simulated).' },
        { kind: 'mailed', at: plus(now, 1 * DAY), detail: certified ? 'Practice send: mailed certified, return receipt (simulated).' : 'Practice send: mailed first class (simulated).' },
        { kind: 'in_transit', at: plus(now, 2 * DAY), detail: 'Practice send: in transit (simulated).' },
        { kind: 'delivered', at: plus(now, 4 * DAY), detail: certified ? 'Practice send: delivered, signed for (simulated).' : 'Practice send: delivered (simulated).' },
      ],
    };
  },
};

const NO_VENDOR = 'no fax or mail vendor with a signed BAA is configured; nothing was sent';
export const unconfiguredFaxSender: FaxSender = {
  name: 'unconfigured-fax',
  allowsRealPatientData: false,
  async send() {
    throw new Error(NO_VENDOR);
  },
  async inboundNumber() {
    throw new Error(NO_VENDOR);
  },
};
export const unconfiguredMailSender: MailSender = {
  name: 'unconfigured-mail',
  allowsRealPatientData: false,
  async send() {
    throw new Error(NO_VENDOR);
  },
};

export function senders(env: Record<string, string | undefined> = process.env): { fax: FaxSender; mail: MailSender } {
  const choice = (env.SEND_EXECUTOR ?? 'demo').trim().toLowerCase();
  return choice === 'demo' || choice === '' ? { fax: demoFaxSender, mail: demoMailSender } : { fax: unconfiguredFaxSender, mail: unconfiguredMailSender };
}
