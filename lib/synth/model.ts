// Synthetic documents (docs/kimi/PLAN_PHASES_2_4.md step 2): made-up but
// realistic itemized hospital bills, EOBs and denial letters, generated
// from a seed so the library is reproducible. Pure: this builds the
// CONTENT and the ground truth; scripts/synth_docs/generate.ts renders it.
//
// Rules: fictional people, hospitals and insurers only (every name here is
// invented and every address says "(sample)"); real code NUMBERS with our
// own plain wording (no CPT descriptors); phone and fax numbers 555-01xx.
// Planted problems carry their own answers so checks can be scored.

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

const FIRST = ['Ana', 'Marcus', 'Priya', 'Dolores', 'Kenji', 'Fatima', 'Owen', 'Lucia', 'Darnell', 'Mei', 'Rosa', 'Tomasz', 'Imani', 'Gus', 'Noor', 'Calvin'];
const LAST = ['Quillfeather', 'Brambleton', 'Okonkwo-Vale', 'Fairbairn', 'Tanaka-Reyes', 'Holloway', 'Castellanos', 'Venkataraman', 'Lindqvist', 'Abernathy', 'Moraes', 'Dubrovsky'];
const HOSPITALS = ['Willowmere Regional Hospital', 'Saint Brigid Sample Medical Center', 'Copper Ridge Community Hospital', 'Harborlight General Hospital', 'Pinecrest Valley Hospital'];
const INSURERS = ['Bluefin Health Plan', 'Meridian Oak Insurance', 'Lantern Mutual Health', 'Northwind Care Plan'];
const CITIES = ['Fairhaven, OH 43000', 'Mesa Vista, AZ 85000', 'Cold Spring, MN 55000', 'Bayport, FL 33000', 'Elm Grove, TX 75000'];

// Real code numbers, our own wording.
export const SERVICES: { code: string; text: string; price: [number, number]; kind: 'er' | 'lab' | 'img' | 'room' | 'drug' | 'proc' }[] = [
  { code: '99283', text: 'Emergency visit, moderate', price: [900, 1600], kind: 'er' },
  { code: '99284', text: 'Emergency visit, high', price: [1800, 2800], kind: 'er' },
  { code: '85025', text: 'Blood count test', price: [120, 260], kind: 'lab' },
  { code: '80053', text: 'Blood chemistry panel, full', price: [280, 520], kind: 'lab' },
  { code: '80048', text: 'Blood chemistry panel, basic', price: [220, 450], kind: 'lab' },
  { code: '84443', text: 'Thyroid hormone test', price: [140, 300], kind: 'lab' },
  { code: '36415', text: 'Blood draw', price: [25, 70], kind: 'lab' },
  { code: '71046', text: 'Chest X-ray, 2 views', price: [450, 900], kind: 'img' },
  { code: '74177', text: 'CT scan, belly and pelvis, with contrast', price: [3200, 6400], kind: 'img' },
  { code: '93005', text: 'Heart tracing (ECG)', price: [180, 420], kind: 'proc' },
  { code: '96374', text: 'IV medicine push', price: [240, 520], kind: 'proc' },
  { code: '96360', text: 'IV fluids, first hour', price: [380, 760], kind: 'proc' },
  { code: 'J2405', text: 'Anti-nausea medicine injection', price: [40, 120], kind: 'drug' },
  { code: 'J1885', text: 'Pain medicine injection', price: [35, 110], kind: 'drug' },
];
const ROOM = { code: '0120', text: 'Room and board (per day)', perDay: [2100, 3400] as [number, number] };

export type PlantKind = 'duplicate' | 'unbundled_panel' | 'room_days' | 'unlisted_supplies';
export interface Planted {
  kind: PlantKind;
  lines: number[];
  amountUsd: number | null;
}

export interface SynthLine {
  date: string;
  code: string | null;
  description: string;
  units: number;
  chargeUsd: number;
}

export interface SynthBill {
  id: string;
  docType: 'itemized_bill';
  patientName: string;
  provider: string;
  providerAddress: string;
  billingPhone: string;
  accountNumber: string;
  statementDate: string;
  serviceFrom: string;
  serviceTo: string;
  lines: SynthLine[];
  totalChargesUsd: number;
  insurancePaidUsd: number;
  amountDueUsd: number;
  planted: Planted[];
  style: { font: 'Helvetica' | 'TimesRoman' | 'Courier'; dateFormat: 'MM/DD/YY' | 'MM/DD/YYYY'; columns: 'date-code-desc-qty-amt' | 'code-date-desc-amt-qty'; labels: 0 | 1 | 2 };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export function makeBill(seed: number): SynthBill {
  const r = rng(seed);
  const admit = addDays('2026-01-05', r.int(0, 250));
  const nights = r.int(1, 4);
  const discharge = addDays(admit, nights);
  const lines: SynthLine[] = [];
  const planted: Planted[] = [];
  const price = ([a, b]: [number, number]) => round2(a + r.next() * (b - a));

  lines.push({ date: admit, code: r.pick(['99283', '99284']), description: '', units: 1, chargeUsd: 0 });
  const pool = SERVICES.filter((s) => s.kind !== 'er' && s.code !== '80048');
  const n = r.int(4, 8);
  for (let i = 0; i < n; i++) {
    const s = r.pick(pool);
    lines.push({ date: addDays(admit, r.int(0, nights - 1 >= 0 ? nights - 1 : 0)), code: s.code, description: '', units: 1, chargeUsd: 0 });
  }
  for (const l of lines) {
    const s = SERVICES.find((x) => x.code === l.code)!;
    l.description = s.text;
    l.chargeUsd = price(s.price);
  }
  // Same code twice on the same day is a planted duplicate only when we
  // plant it; otherwise keep codes unique per day.
  const seen = new Set<string>();
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = `${lines[i].date}|${lines[i].code}`;
    if (seen.has(k)) lines.splice(i, 1);
    else seen.add(k);
  }

  const perDay = price(ROOM.perDay);
  const roomDays = r.chance(0.4) ? nights + 1 : nights;
  lines.push({ date: admit, code: ROOM.code, description: ROOM.text, units: roomDays, chargeUsd: round2(perDay * roomDays) });
  if (roomDays > nights) planted.push({ kind: 'room_days', lines: [lines.length - 1], amountUsd: perDay });

  if (r.chance(0.5)) {
    const i = r.int(1, lines.length - 2);
    const dup = { ...lines[i] };
    lines.splice(i + 1, 0, dup);
    for (const p of planted) p.lines = p.lines.map((x) => (x > i ? x + 1 : x));
    planted.push({ kind: 'duplicate', lines: [i, i + 1], amountUsd: dup.chargeUsd });
  }
  if (r.chance(0.4)) {
    const full = SERVICES.find((s) => s.code === '80053')!;
    const basic = SERVICES.find((s) => s.code === '80048')!;
    const at = lines.length - 1;
    const fullLine = { date: admit, code: full.code, description: full.text, units: 1, chargeUsd: price(full.price) };
    const basicLine = { date: admit, code: basic.code, description: basic.text, units: 1, chargeUsd: price(basic.price) };
    lines.splice(at, 0, fullLine, basicLine);
    for (const p of planted) p.lines = p.lines.map((x) => (x >= at ? x + 2 : x));
    planted.push({ kind: 'unbundled_panel', lines: [at, at + 1], amountUsd: basicLine.chargeUsd });
  }
  if (r.chance(0.3)) {
    lines.splice(lines.length - 1, 0, { date: admit, code: null, description: r.pick(['Supplies', 'Misc. supplies', 'Sterile supply']), units: 1, chargeUsd: price([60, 900]) });
    const idx = lines.length - 2;
    for (const p of planted) p.lines = p.lines.map((x) => (x >= idx ? x + 1 : x));
    planted.push({ kind: 'unlisted_supplies', lines: [idx], amountUsd: null });
  }

  const total = round2(lines.reduce((t, l) => t + l.chargeUsd, 0));
  const paid = round2(total * (0.3 + r.next() * 0.4));
  return {
    id: `bill-${seed}`,
    docType: 'itemized_bill',
    patientName: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    provider: r.pick(HOSPITALS),
    providerAddress: `${r.int(10, 9800)} ${r.pick(['Harbor', 'Mill', 'Ridge', 'Lake', 'Cedar'])} ${r.pick(['Road', 'Avenue', 'Parkway'])}, ${r.pick(CITIES)} (sample)`,
    billingPhone: `(555) 555-01${String(r.int(10, 99))}`,
    accountNumber: `${r.pick(['RGH', 'WRH', 'CRC', 'HLG', 'PVH'])}-${r.int(1000000, 9999999)}`,
    statementDate: addDays(discharge, r.int(7, 30)),
    serviceFrom: admit,
    serviceTo: discharge,
    lines,
    totalChargesUsd: total,
    insurancePaidUsd: paid,
    amountDueUsd: round2(total - paid),
    planted,
    style: {
      font: r.pick(['Helvetica', 'TimesRoman', 'Courier'] as const),
      dateFormat: r.pick(['MM/DD/YY', 'MM/DD/YYYY'] as const),
      columns: r.pick(['date-code-desc-qty-amt', 'code-date-desc-amt-qty'] as const),
      labels: r.int(0, 2) as 0 | 1 | 2,
    },
  };
}

export interface SynthEob {
  id: string;
  docType: 'eob';
  memberName: string;
  insurer: string;
  claimNumber: string;
  provider: string;
  serviceDate: string;
  lines: { code: string; description: string; billedUsd: number; allowedUsd: number; planPaidUsd: number; youOweUsd: number }[];
  totalYouOweUsd: number;
}

export function makeEob(seed: number): SynthEob {
  const r = rng(seed * 7919);
  const lines = Array.from({ length: r.int(2, 6) }, () => {
    const s = r.pick(SERVICES);
    const billed = round2(s.price[0] + r.next() * (s.price[1] - s.price[0]));
    const allowed = round2(billed * (0.25 + r.next() * 0.4));
    const paid = round2(allowed * (r.chance(0.2) ? 0 : 0.6 + r.next() * 0.3));
    return { code: s.code, description: s.text, billedUsd: billed, allowedUsd: allowed, planPaidUsd: paid, youOweUsd: round2(allowed - paid) };
  });
  return {
    id: `eob-${seed}`,
    docType: 'eob',
    memberName: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    insurer: r.pick(INSURERS),
    claimNumber: `CL-${r.int(10, 99)}-${r.int(1000000, 9999999)}`,
    provider: r.pick(HOSPITALS),
    serviceDate: addDays('2026-01-05', r.int(0, 250)),
    lines,
    totalYouOweUsd: round2(lines.reduce((t, l) => t + l.youOweUsd, 0)),
  };
}

export interface SynthDenial {
  id: string;
  docType: 'denial_letter';
  memberName: string;
  insurer: string;
  letterDate: string;
  service: string;
  code: string;
  reason: string;
  appealDays: number;
}

export function makeDenial(seed: number): SynthDenial {
  const r = rng(seed * 104729);
  const s = r.pick(SERVICES.filter((x) => x.kind === 'img' || x.kind === 'proc'));
  return {
    id: `denial-${seed}`,
    docType: 'denial_letter',
    memberName: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    insurer: r.pick(INSURERS),
    letterDate: addDays('2026-01-05', r.int(0, 250)),
    service: s.text,
    code: s.code,
    reason: r.pick([
      'The records we received do not show that this service was medically necessary.',
      'This service needed approval before it was done, and we did not receive a request.',
      'This service is not covered under your plan.',
      'We did not receive the information we asked for.',
    ]),
    appealDays: r.pick([60, 180]),
  };
}

export function formatDate(isoDate: string, f: 'MM/DD/YY' | 'MM/DD/YYYY'): string {
  const [y, m, d] = isoDate.split('-');
  return f === 'MM/DD/YY' ? `${m}/${d}/${y.slice(2)}` : `${m}/${d}/${y}`;
}

export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
