// Bill review checks (Phase 3, docs/kimi/PLAN_PHASES_2_4.md section 4).
// Pure: a confirmed bill + reference data in, findings out. The DB loader
// is lib/production/real/billChecks.ts; reference files are parsed by
// lib/rules/bills/refs.ts.
//
// Rules for every finding (checked by lib/production/contracts.ts):
// - plain words, no rule names; every dollar figure in the text is a bill
//   charge, the finding's own amount, or a reference value named in it;
// - amountUsd never exceeds what its lines charged;
// - a Medicare reference is a comparison, never proof the bill is wrong
//   ("ask" tone), except exact duplicates and room days, which the bill
//   itself shows.
// The checks never double count: a line already flagged as an exact
// duplicate is left out of the unit-limit and pair checks.

import type { ConfirmedBill, Finding } from '../../production/types';

export type Setting = 'inpatient' | 'outpatient_hospital' | 'practitioner';

// MUE: most units of a code per day (adjudication 2 or 3) or per line (1).
export interface MueRef {
  limit: number;
  mai: 1 | 2 | 3;
}

// NCCI procedure-to-procedure pair: col2 is not paid separately when col1
// is billed the same day. modifier 0: never together; 1: a modifier can
// allow it (the bill doesn't show modifiers, so we ask); 9: not applicable.
export interface PtpRef {
  col1: string;
  col2: string;
  modifier: 0 | 1 | 9;
  effective: string;          // ISO
  deleted: string | null;     // ISO, null = still in force
}

// Medicare Physician Fee Schedule national amounts (no locality
// adjustment): total RVUs x conversion factor.
export interface PfsRef {
  facilityUsd: number;
  nonFacilityUsd: number;
}

export interface BillRefs {
  mue?: { version: string; byCode: Record<string, MueRef> };
  ptp?: { version: string; pairs: PtpRef[] };
  pfs?: { version: string; byCode: Record<string, PfsRef> };
}

export const BUILTIN_VERSION = 'builtin-v1';

// A price benchmark is shown only when the charge is at least this many
// times the Medicare amount. A product display threshold, not a rule.
export const BENCHMARK_MULTIPLE = 3;

type Line = ConfirmedBill['lines'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const what = (l: Line) => (l.description ? l.description.toLowerCase() : `the service coded ${l.code}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Room and board revenue codes (0110 to 0219: private, semi-private,
// ward, ICU, coronary care).
export const isRoomCode = (code: string | null) => !!code && /^0(1[1-9]|2[01])\d$/.test(code);
const isRevenueCode = (code: string | null) => !!code && /^0\d{3}$/.test(code);

// Where the care happened decides which Medicare tables apply. Room and
// board means an inpatient stay; a hospital name or revenue codes mean a
// hospital outpatient bill; anything else is a doctor's (practitioner) bill.
export function billSetting(bill: ConfirmedBill): Setting {
  if (bill.lines.some((l) => isRoomCode(l.code))) return 'inpatient';
  if (bill.lines.some((l) => isRevenueCode(l.code)) || /hospital|medical center|health system/i.test(bill.header.provider ?? '')) return 'outpatient_hospital';
  return 'practitioner';
}

// ---------- Exact duplicates ----------
// Same code, same date, same amount on more than one line. One finding per
// group; the amount is every copy after the first.
export function duplicates(bill: ConfirmedBill): Finding[] {
  const groups = new Map<string, number[]>();
  bill.lines.forEach((l, i) => {
    if (!l.code || !l.date || l.chargeUsd == null) return;
    const k = `${l.code}|${l.date}|${l.chargeUsd}|${l.units ?? 1}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const out: Finding[] = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const l = bill.lines[idx[0]];
    const times = idx.length === 2 ? 'twice' : `${idx.length} times`;
    out.push({
      id: `duplicate_charge-${idx[0]}`,
      lines: idx,
      tone: 'wrong',
      amountUsd: round2(l.chargeUsd! * (idx.length - 1)),
      plainText: `You were billed ${times} for the same ${what(l)} on the same day (${fmtDay(l.date!)}). That looks like a duplicate.`,
      ruleId: 'duplicate_charge',
      dataVersion: BUILTIN_VERSION,
    });
  }
  return out;
}

// Same code and date at different amounts: may be two real services, or a
// duplicate with a changed price. Asked about, no amount.
export function nearDuplicates(bill: ConfirmedBill, flagged: Set<number>): Finding[] {
  const groups = new Map<string, number[]>();
  bill.lines.forEach((l, i) => {
    if (!l.code || !l.date || flagged.has(i) || isRoomCode(l.code)) return;
    const k = `${l.code}|${l.date}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const out: Finding[] = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const amounts = new Set(idx.map((i) => bill.lines[i].chargeUsd));
    if (amounts.size < 2) continue;
    const l = bill.lines[idx[0]];
    out.push({
      id: `near_duplicate-${idx[0]}`,
      lines: idx,
      tone: 'ask',
      amountUsd: null,
      plainText: `${capital(what(l))} appears ${idx.length} times on ${fmtDay(l.date!)} at different prices. That can be right, but it's worth asking whether it was really done ${idx.length === 2 ? 'twice' : `${idx.length} times`}.`,
      ruleId: 'near_duplicate',
      dataVersion: BUILTIN_VERSION,
    });
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Room days vs the stay ----------
// A stay is counted in nights: the day you leave is not a room day. More
// room days than nights is an extra day, priced at the bill's own per-day
// rate.
export function roomDays(bill: ConfirmedBill): Finding[] {
  const { serviceFrom: from, serviceTo: to } = bill.header;
  if (!from || !to) return [];
  const nights = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  if (!(nights >= 1)) return [];
  const idx = bill.lines.map((l, i) => (isRoomCode(l.code) && (l.units ?? 0) > 0 && l.chargeUsd != null ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return [];
  const days = idx.reduce((t, i) => t + bill.lines[i].units!, 0);
  if (days <= nights) return [];
  const last = bill.lines[idx[idx.length - 1]];
  const perDay = round2(last.chargeUsd! / last.units!);
  const extra = days - nights;
  return [{
    id: `room_days-${idx[0]}`,
    lines: idx,
    tone: 'wrong',
    amountUsd: round2(perDay * extra),
    plainText: `You were charged for ${plural(days, 'day')} in the room, but your stay was ${plural(nights, 'night')} (${fmtDay(from)} to ${fmtDay(to)}). That is ${extra === 1 ? 'one extra day' : `${extra} extra days`}.`,
    ruleId: 'room_days',
    dataVersion: BUILTIN_VERSION,
  }];
}

// ---------- Lines worth asking about ----------
// No code at all, vague supplies, or a facility fee.
export function askAbout(bill: ConfirmedBill): Finding[] {
  const out: Finding[] = [];
  bill.lines.forEach((l, i) => {
    if (l.chargeUsd == null || l.chargeUsd <= 0) return;
    const desc = l.description ?? '';
    let text: string | null = null;
    if (/facility fee/i.test(desc)) {
      text = `There is a facility fee of ${usd(l.chargeUsd)}. It's fair to ask what it covers and whether you were told about it before your visit.`;
    } else if (!l.code && /suppl|misc|sundr/i.test(desc)) {
      text = `A line says "${desc}" with no code, for ${usd(l.chargeUsd)}. It's fair to ask for a list of what was included.`;
    } else if (!l.code) {
      text = `A line for ${usd(l.chargeUsd)}${desc ? ` ("${desc}")` : ''} has no billing code. It's fair to ask what it was for.`;
    }
    if (text) out.push({ id: `ask_about-${i}`, lines: [i], tone: 'ask', amountUsd: l.chargeUsd, plainText: text, ruleId: 'ask_about', dataVersion: BUILTIN_VERSION });
  });
  return out;
}

// ---------- More units than Medicare allows in a day ----------
// Medicare unit limits apply to outpatient and doctor bills, not to an
// inpatient stay. They are Medicare's limits, so the patient asks.
export function unitLimits(bill: ConfirmedBill, setting: Setting, mue: BillRefs['mue'], skip: Set<number>): Finding[] {
  if (!mue || setting === 'inpatient') return [];
  const groups = new Map<string, number[]>();
  bill.lines.forEach((l, i) => {
    if (!l.code || skip.has(i) || !mue.byCode[l.code]) return;
    const ref = mue.byCode[l.code];
    const k = ref.mai === 1 ? `line|${i}` : `${l.code}|${l.date ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const out: Finding[] = [];
  for (const idx of groups.values()) {
    const l = bill.lines[idx[0]];
    const ref = mue.byCode[l.code!];
    const units = idx.reduce((t, i) => t + (bill.lines[i].units ?? 1), 0);
    if (units <= ref.limit) continue;
    const charged = idx.reduce((t, i) => t + (bill.lines[i].chargeUsd ?? 0), 0);
    const amount = charged > 0 ? round2((charged / units) * (units - ref.limit)) : null;
    out.push({
      id: `unit_limit-${idx[0]}`,
      lines: idx,
      tone: 'ask',
      amountUsd: amount,
      plainText: `You were billed for ${units} of ${what(l)}${l.date ? ` on ${fmtDay(l.date)}` : ''}. Medicare's billing limits allow at most ${ref.limit} ${ref.mai === 1 ? 'on one line' : 'a day'} for this, so it's worth asking why there were ${units}.`,
      ruleId: 'mue_units',
      dataVersion: mue.version,
    });
  }
  return out;
}

// ---------- Two codes normally billed as one ----------
export function pairedCodes(bill: ConfirmedBill, setting: Setting, ptp: BillRefs['ptp'], skip: Set<number>): Finding[] {
  if (!ptp) return [];
  const out: Finding[] = [];
  const used = new Set<number>();
  for (const p of ptp.pairs) {
    if (p.modifier === 9) continue;
    bill.lines.forEach((l2, j) => {
      if (l2.code !== p.col2 || skip.has(j) || used.has(j) || !l2.date) return;
      if (l2.date < p.effective || (p.deleted && l2.date >= p.deleted)) return;
      const i = bill.lines.findIndex((l1, k) => k !== j && l1.code === p.col1 && l1.date === l2.date && !skip.has(k));
      if (i < 0) return;
      used.add(j);
      const l1 = bill.lines[i];
      // Inpatient stays and modifier-1 pairs can be right; the patient asks.
      const tone = p.modifier === 0 && setting !== 'inpatient' ? 'wrong' : 'ask';
      out.push({
        id: `paired_codes-${j}`,
        lines: [i, j],
        tone,
        amountUsd: l2.chargeUsd ?? null,
        plainText: `You were billed for ${what(l2)} and ${what(l1)} on the same day (${fmtDay(l2.date)}). Medicare's coding rules treat ${what(l2)} as part of ${what(l1)}, so these are ${tone === 'wrong' ? 'normally billed as one' : 'usually billed as one; it is worth asking why both were charged'}.`,
        ruleId: 'ncci_ptp',
        dataVersion: ptp.version,
      });
    });
  }
  return out;
}

// ---------- What Medicare pays a doctor for the same service ----------
// Doctor (practitioner) bills only: hospital and lab benchmarks need other
// fee schedules. A comparison, never "you were overcharged"; no amount.
export function priceBenchmarks(bill: ConfirmedBill, setting: Setting, pfs: BillRefs['pfs']): Finding[] {
  if (!pfs || setting !== 'practitioner') return [];
  const out: Finding[] = [];
  bill.lines.forEach((l, i) => {
    const ref = l.code ? pfs.byCode[l.code] : undefined;
    if (!ref || l.chargeUsd == null) return;
    const units = l.units ?? 1;
    const lo = round2(Math.min(ref.facilityUsd, ref.nonFacilityUsd) * units);
    const hi = round2(Math.max(ref.facilityUsd, ref.nonFacilityUsd) * units);
    if (!(hi > 0) || l.chargeUsd < hi * BENCHMARK_MULTIPLE) return;
    const range = lo === hi ? `about ${usd(hi)}` : `about ${usd(lo)} to ${usd(hi)}`;
    out.push({
      id: `price_benchmark-${i}`,
      lines: [i],
      tone: 'ask',
      amountUsd: null,
      plainText: `You were charged ${usd(l.chargeUsd)} for ${what(l)}. Medicare pays doctors ${range} for this nationally. That doesn't mean your bill is wrong, but it's a fair comparison to bring up.`,
      ruleId: 'price_benchmark',
      dataVersion: pfs.version,
    });
  });
  return out;
}

// ---------- The engine ----------
export function runBillChecks(bill: ConfirmedBill, refs: BillRefs = {}): Finding[] {
  const setting = billSetting(bill);
  const dup = duplicates(bill);
  // Copies after the first are already counted; keep them out of the
  // other checks so nothing is counted twice.
  const extraCopies = new Set(dup.flatMap((f) => f.lines.slice(1)));
  const room = roomDays(bill);
  const roomLines = new Set(room.flatMap((f) => f.lines));
  const pairs = pairedCodes(bill, setting, refs.ptp, extraCopies);
  const paired = new Set(pairs.map((f) => f.lines[1]));
  const skip = new Set([...extraCopies, ...roomLines, ...paired]);
  return [
    ...dup,
    ...nearDuplicates(bill, extraCopies),
    ...pairs,
    ...room,
    ...unitLimits(bill, setting, refs.mue, skip),
    ...askAbout(bill),
    ...priceBenchmarks(bill, setting, refs.pfs),
  ];
}
