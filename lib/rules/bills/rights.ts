// Patient rights checks on a confirmed bill (No Surprises and hospital
// financial assistance; owner go-ahead 2026-10-16). Pure: a confirmed bill
// and what we know about the patient's coverage in, findings out. The rule
// text is quoted in docs/research/no_surprises_charity_care_verification.md
// (eCFR, up to date as of 2026-10-15).
//
// What the bill alone cannot show (network status, whether the hospital is
// a nonprofit, whether a good faith estimate was given) is never assumed:
// every finding here is an "ask", and the words say "if".
// - 45 CFR 149.410: an out-of-network emergency facility or provider "must
//   not bill, and must not hold liable" a plan member for more than the
//   in-network cost sharing. Plans through work or the marketplace only
//   (group health plans and individual coverage); not Medicare or Medicaid.
// - 45 CFR 149.420(a)-(b): the same limit for an out-of-network provider
//   at an in-network facility; for ancillary services (emergency medicine,
//   anesthesiology, pathology, radiology, neonatology, diagnostic lab and
//   imaging) the notice-and-consent waiver never applies.
// - 45 CFR 149.620(a)(2)(ii), (b), (c)(1): an uninsured (or self-pay)
//   person billed "at least $400 more" than a provider's good faith
//   estimate can start patient-provider dispute resolution within 120
//   calendar days of receiving the first bill with those charges.
// - 26 CFR 1.501(r)-5(a): a nonprofit hospital charges someone eligible
//   under its financial assistance policy no more than the amounts
//   generally billed to insured people for emergency or other medically
//   necessary care. 1.501(r)-1(b)(3): the application period runs at least
//   to the 240th day after the first post-discharge bill. 1.501(r)-6(c)
//   (3)(i): in general no extraordinary collection action for at least 120
//   days from that first bill; (c)(8): actions pause while an application
//   is pending. Applies only to 501(c)(3) hospital organizations, which the
//   bill doesn't show, so the patient is asked.

import type { ConfirmedBill, Finding } from '../../production/types';
import type { Coverage } from '../cashVsInsurance';
import { billSetting, fmtDay, usd } from './checks';

// The eCFR date the rule text was checked against.
export const RIGHTS_VERSION = 'ecfr-2026-10-15';
// 45 CFR 149.620(a)(2)(ii): "at least $400 more".
export const GFE_DISPUTE_THRESHOLD_USD = 400;
export const GFE_DISPUTE_DAYS = 120;
export const FAP_APPLICATION_DAYS = 240;
export const FAP_NO_COLLECTIONS_DAYS = 120;

export interface BillSituation {
  coverage: Coverage;
  // The amount on a good faith estimate this provider gave the patient,
  // entered by the patient. Null or absent: none entered.
  goodFaithEstimateUsd?: number | null;
}

type Line = ConfirmedBill['lines'][number];

// Emergency department visits: revenue codes 0450-0459, CPT 99281-99285,
// HCPCS G0380-G0384 (hospital emergency department visits).
export const isEmergencyCode = (code: string | null) => !!code && (/^045\d$/.test(code) || /^9928[1-5]$/.test(code) || /^G038[0-4]$/.test(code));

// Ancillary services under 149.420(b)(1) that a code can show:
// anesthesia (00100-01999), radiology (70010-79999), pathology and lab
// (80047-89398), neonatal and pediatric critical care (99468-99480).
export function ancillaryKind(code: string | null): 'anesthesia' | 'imaging' | 'lab' | 'newborn care' | null {
  if (!code || !/^\d{5}$/.test(code)) return null;
  const n = Number(code);
  if (n >= 100 && n <= 1999) return 'anesthesia';
  if (n >= 70010 && n <= 79999) return 'imaging';
  if (n >= 80047 && n <= 89398) return 'lab';
  if (n >= 99468 && n <= 99480) return 'newborn care';
  return null;
}

const charged = (l: Line) => l.chargeUsd != null && l.chargeUsd > 0;
const indexes = (bill: ConfirmedBill, keep: (l: Line) => boolean) => bill.lines.map((l, i) => (keep(l) ? i : -1)).filter((i) => i >= 0);
const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const longDay = (iso: string) => `${fmtDay(iso)}, ${iso.slice(0, 4)}`;
const workOrMarketplace = (c: Coverage) => (c === 'commercial' ? 'With insurance through work or the marketplace' : 'If your insurance is through work or the marketplace');

// ---------- Emergency care billed out of network ----------
export function surpriseEmergency(bill: ConfirmedBill, s: BillSituation): Finding[] {
  if (s.coverage !== 'commercial' && s.coverage !== 'unknown') return [];
  const idx = indexes(bill, (l) => charged(l) && isEmergencyCode(l.code));
  if (!idx.length) return [];
  return [{
    id: `nsa_emergency-${idx[0]}`,
    lines: idx,
    tone: 'ask',
    amountUsd: null,
    plainText: `${workOrMarketplace(s.coverage)}, a hospital or doctor outside your plan's network can't bill you more for emergency care than you would pay in network. Compare what this bill asks for with what your plan's explanation of benefits says you owe.`,
    ruleId: 'nsa_emergency',
    dataVersion: RIGHTS_VERSION,
  }];
}

// ---------- Out-of-network doctor at an in-network facility ----------
// The doctor's own bill (anesthesia, imaging, lab), not the facility's.
export function surpriseAncillary(bill: ConfirmedBill, s: BillSituation): Finding[] {
  if (s.coverage !== 'commercial' && s.coverage !== 'unknown') return [];
  if (billSetting(bill) !== 'practitioner') return [];
  const idx = indexes(bill, (l) => charged(l) && ancillaryKind(l.code) !== null && !isEmergencyCode(l.code));
  if (!idx.length) return [];
  const kinds = [...new Set(idx.map((i) => ancillaryKind(bill.lines[i].code)!))];
  const list = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
  return [{
    id: `nsa_ancillary-${idx[0]}`,
    lines: idx,
    tone: 'ask',
    amountUsd: null,
    plainText: `${workOrMarketplace(s.coverage)}: if this ${list} was done at a hospital or surgery center in your network, a doctor outside your network can't bill you more than you would pay in network, even if you signed a form agreeing to it. Ask whether this doctor is in your network.`,
    ruleId: 'nsa_ancillary',
    dataVersion: RIGHTS_VERSION,
  }];
}

// ---------- Good faith estimate (uninsured or self-pay) ----------
export function goodFaithEstimate(bill: ConfirmedBill, s: BillSituation): Finding[] {
  const gfe = s.goodFaithEstimateUsd ?? null;
  const all = indexes(bill, charged);
  if (!all.length) return [];
  if (gfe != null && gfe > 0) {
    const billed = bill.header.totalChargesUsd ?? Math.round(all.reduce((t, i) => t + bill.lines[i].chargeUsd!, 0) * 100) / 100;
    const over = Math.round((billed - gfe) * 100) / 100;
    if (over < GFE_DISPUTE_THRESHOLD_USD) return [];
    return [{
      id: 'gfe_over-0',
      lines: all,
      tone: 'ask',
      amountUsd: null,
      refsUsd: [gfe, billed, over],
      plainText: `This bill's charges, ${usd(billed)}, are ${usd(over)} more than the ${usd(gfe)} good faith estimate you were given. When a bill is ${usd(GFE_DISPUTE_THRESHOLD_USD)} or more over the estimate, you can ask a federal dispute process to decide what you pay. You have to start it within ${GFE_DISPUTE_DAYS} days of getting the first bill with these charges.`,
      ruleId: 'gfe_over',
      dataVersion: RIGHTS_VERSION,
    }];
  }
  // No estimate entered. Emergency care isn't scheduled, so no estimate
  // was due for it; ask only for an uninsured patient's other care.
  if (s.coverage !== 'uninsured' || bill.lines.some((l) => isEmergencyCode(l.code))) return [];
  return [{
    id: 'gfe_ask-0',
    lines: all,
    tone: 'ask',
    amountUsd: null,
    plainText: `Without insurance, a provider has to give you a good faith estimate of the cost when you schedule care or ask for one. If you got one, enter its amount: a bill ${usd(GFE_DISPUTE_THRESHOLD_USD)} or more over the estimate can be disputed.`,
    ruleId: 'gfe_ask',
    dataVersion: RIGHTS_VERSION,
  }];
}

// ---------- Hospital financial assistance ----------
export function financialAssistance(bill: ConfirmedBill): Finding[] {
  if (billSetting(bill) === 'practitioner') return [];
  const all = indexes(bill, charged);
  if (!all.length) return [];
  const stmt = bill.header.statementDate;
  const by = stmt ? ` If this is the first bill since your care, that is ${longDay(plusDays(stmt, FAP_APPLICATION_DAYS))} or later.` : '';
  return [{
    id: 'financial_assistance-0',
    lines: all,
    tone: 'ask',
    amountUsd: null,
    plainText: `If this hospital is a nonprofit, it must have a financial assistance policy. If you qualify, it can't charge you more than it generally bills people with insurance for emergency or other medically necessary care. It must take your application until at least ${FAP_APPLICATION_DAYS} days after the first bill it sent after your care.${by} While your application is open, it has to pause collection actions like credit reporting.`,
    ruleId: 'financial_assistance',
    dataVersion: RIGHTS_VERSION,
  }];
}

export function runRightsChecks(bill: ConfirmedBill, s: BillSituation): Finding[] {
  return [...surpriseEmergency(bill, s), ...surpriseAncillary(bill, s), ...goodFaithEstimate(bill, s), ...financialAssistance(bill)];
}
