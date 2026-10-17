// "Looks right" on a denial: the patient's confirmed copy, validated at the
// boundary. Pure. This is the ONLY way to make a ConfirmedDenial, so no
// check in lib/rules/denials/checks.ts can run on unconfirmed or malformed
// data (spec Appendix B4, B2). Invalid input is refused, never coerced.

import { DENIAL_CATEGORIES, PLAN_FUNDINGS, type ConfirmedDenial } from './types';
import { isCarc, isRarc } from './codes';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (v == null || v === '' ? null : typeof v === 'string' && v.trim().length <= max ? v.trim() : undefined);
const date = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : v == null ? false : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T) => (v == null || v === '' ? dflt : list.includes(v as T) ? (v as T) : undefined);
const codes = (v: unknown, ok: (s: string) => boolean) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 20) return undefined;
  const out = v.map((x) => (typeof x === 'string' ? x.trim().toUpperCase().replace(/^(CO|PR|OA|PI|CR)-?/, '') : ''));
  return out.every(ok) ? [...new Set(out.map((x) => (/^\d+$/.test(x) ? String(Number(x)) : x)))] : undefined;
};

export function parseConfirmedDenial(body: unknown, now = new Date()): { denial: ConfirmedDenial } | { error: string } {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return { error: 'a denial is required' };
  const pa = b.priorAuth as Record<string, unknown> | null | undefined;
  let priorAuth: ConfirmedDenial['priorAuth'] | undefined = null;
  if (pa != null) {
    const p = { reference: str(pa.reference, 60), serviceCode: str(pa.serviceCode, 7), validFrom: date(pa.validFrom), validTo: date(pa.validTo) };
    priorAuth = p.reference === undefined || p.serviceCode === undefined || !p.validFrom || !p.validTo || p.validTo < p.validFrom ? undefined : (p as ConfirmedDenial['priorAuth']);
  }
  const d = {
    payerName: str(b.payerName, 200),
    providerName: str(b.providerName, 200),
    planFunding: oneOf(b.planFunding, PLAN_FUNDINGS, 'unknown'),
    medicaidDelivery: oneOf(b.medicaidDelivery, ['managed_care', 'state', 'unknown'] as const, 'unknown'),
    category: oneOf(b.category, DENIAL_CATEGORIES, 'other'),
    carcCodes: codes(b.carcCodes, isCarc),
    rarcCodes: codes(b.rarcCodes, isRarc),
    serviceOrDrug: str(b.serviceOrDrug, 200),
    serviceCode: b.serviceCode == null || b.serviceCode === '' ? null : typeof b.serviceCode === 'string' && /^[A-Za-z0-9]{4,5}$/.test(b.serviceCode.trim()) ? b.serviceCode.trim().toUpperCase() : undefined,
    isDrug: bool(b.isDrug),
    noticeDate: date(b.noticeDate),
    dateOfService: date(b.dateOfService),
    requestDate: date(b.requestDate),
    appealLevel: oneOf(b.appealLevel, ['initial', 'internal_appeal'] as const, 'initial'),
    timing: oneOf(b.timing, ['pre_service', 'post_service', 'payment'] as const, 'post_service'),
    isPriorAuthDecision: bool(b.isPriorAuthDecision),
    isUrgent: bool(b.isUrgent),
    statedReason: str(b.statedReason, 1000),
    claimNumber: b.claimNumber == null || b.claimNumber === '' ? null : typeof b.claimNumber === 'string' && /^[A-Za-z0-9-]{3,40}$/.test(b.claimNumber.trim()) ? b.claimNumber.trim() : undefined,
    letterDeadlineDays: b.letterDeadlineDays == null || b.letterDeadlineDays === '' ? null : Number.isInteger(b.letterDeadlineDays) && (b.letterDeadlineDays as number) > 0 && (b.letterDeadlineDays as number) <= 365 ? (b.letterDeadlineDays as number) : undefined,
    priorAuth,
  };
  const bad = Object.entries(d).find(([, v]) => v === undefined);
  if (bad) return { error: `${bad[0]} is not valid` };
  if (!d.noticeDate) return { error: 'noticeDate (the date on the letter) is required' };
  if (d.requestDate && d.requestDate > d.noticeDate) return { error: 'requestDate is after the date on the letter' };
  if (d.noticeDate > now.toISOString().slice(0, 10)) return { error: 'noticeDate is in the future' };
  return { denial: { confirmedAt: now.toISOString(), ...(d as Omit<ConfirmedDenial, 'confirmedAt'>) } };
}
