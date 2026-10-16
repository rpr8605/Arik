// Drug data depth (docs/kimi/DRUG_DATA_TOP200.md): pure parsing and
// matching for the public sources. The loaders (scripts/load_drug_data.ts)
// only download, call these, and write. Every source's quirks are handled
// here so tests can pin them with small fixtures; nothing is guessed: a
// name or NDC that doesn't match cleanly comes back as a review item.

import { normalizeNdc } from '../pricing/adapter';

// ---------- CMS Medicare Part D Spending by Drug ----------

export interface PartDEntry {
  rank: number;
  brand: string;      // display name of the drug (base brand, or the generic)
  generic: string;    // CMS generic name of the top-spending member
  spending: number;   // summed over the group's members
  members: string[];  // CMS brand names grouped here (presentations)
}

// CMS lists one row per presentation ("Humira(Cf) Pen", "Humira Pen",
// "Dupixent Syringe", "Stelara*"). A drug is a group: brands by their first
// brand word plus the generic's ingredients; generics by ingredients alone.
// Only "Overall" rows count (one per brand/generic, all manufacturers).
export function groupKey(brand: string, generic: string): string {
  const ingredients = genericComponents(generic).join('+');
  return norm(brand) === norm(generic) ? `g:${ingredients}` : `b:${baseBrand(brand)}|${ingredients}`;
}

export function baseBrand(brand: string): string {
  return norm(brand.replace(/\(.*?\)/g, ' ')).split(' ')[0] ?? '';
}

export function topBySpending(rows: Record<string, unknown>[], year: number, n = 200): PartDEntry[] {
  const key = `Tot_Spndng_${year}`;
  const groups = new Map<string, { members: { brand: string; generic: string; spending: number }[] }>();
  for (const r of rows) {
    if (String(r.Mftr_Name ?? '').trim() !== 'Overall') continue;
    const brand = String(r.Brnd_Name ?? '').trim();
    const generic = String(r.Gnrc_Name ?? '').trim();
    const spending = Number(r[key]);
    if (!brand || !generic || !Number.isFinite(spending) || spending <= 0) continue;
    const k = groupKey(brand, generic);
    if (!groups.has(k)) groups.set(k, { members: [] });
    groups.get(k)!.members.push({ brand, generic, spending });
  }
  const list = [...groups.entries()].map(([k, g]) => {
    g.members.sort((a, b) => b.spending - a.spending || a.brand.localeCompare(b.brand));
    const top = g.members[0];
    const isGeneric = k.startsWith('g:');
    return {
      brand: isGeneric ? top.generic : displayBrand(top.brand),
      generic: top.generic,
      spending: g.members.reduce((t, m) => t + m.spending, 0),
      members: g.members.map((m) => m.brand),
    };
  });
  list.sort((a, b) => b.spending - a.spending || a.brand.localeCompare(b.brand));
  // Two different groups may share a display name (e.g. a brand and its
  // mix product): keep the full CMS name for the lower-ranked one.
  const seen = new Set<string>();
  const out: PartDEntry[] = [];
  for (const e of list.slice(0, n)) {
    let brand = e.brand;
    if (seen.has(norm(brand))) brand = e.members[0];
    seen.add(norm(brand));
    out.push({ rank: out.length + 1, brand, generic: e.generic, spending: Math.round(e.spending * 100) / 100, members: e.members });
  }
  return out;
}

// "Humira(Cf) Pen" -> "Humira"; "Trelegy Ellipta" -> "Trelegy"; keeps the
// CMS capitalization of the first word.
export function displayBrand(brand: string): string {
  const first = brand.replace(/\(.*?\)/g, ' ').trim().split(/\s+/)[0] ?? brand;
  return first.replace(/[^A-Za-z0-9-]/g, '') || brand;
}

// The newest year the file carries (Tot_Spndng_YYYY columns).
export function latestYear(row: Record<string, unknown>): number | null {
  const years = Object.keys(row)
    .map((k) => /^Tot_Spndng_(\d{4})$/.exec(k)?.[1])
    .filter(Boolean)
    .map(Number);
  return years.length ? Math.max(...years) : null;
}

export const isBrandEntry = (e: { brand: string; generic: string }) => norm(e.brand) !== norm(e.generic);

// Salt and form words that don't change which drug it is ("Atorvastatin
// Calcium" is atorvastatin). Used for grouping and matching only; names
// are stored as the source writes them.
const SALT_WORDS = new Set([
  'calcium', 'sodium', 'potassium', 'magnesium', 'hydrochloride', 'hcl', 'hydrobromide', 'besylate', 'tartrate',
  'succinate', 'maleate', 'mesylate', 'phosphate', 'sulfate', 'acetate', 'citrate', 'fumarate', 'propanediol',
  'monohydrate', 'dihydrate', 'trihydrate', 'hemihydrate', 'anhydrous', 'bromide', 'chloride', 'disodium', 'dipotassium',
  'furoate', 'propionate', 'trifenatate', 'xinafoate', 'fumarate', 'dimesylate', 'tosylate', 'malate', 'lactate',
  'er', 'xr', 'hfa', 'and', 'with', 'kit', 'pen', 'injection', 'injector', 'brm', 'myristate', 'diolamine',
]);

// Ingredients of a generic name, salt words dropped: "Fluticasone/
// Umeclidin/Vilanter" -> ['fluticasone', 'umeclidin', 'vilanter'] (CMS
// truncates long names); "Insulin Aspart" -> ['insulin aspart'].
// CMS qualifiers are dropped: the text after a comma ("Insulin Glargine,
// Hum.Rec.Anlog"), parentheses ("(Niacinamide)"), "/PF" (preservative
// free) and biologic suffixes ("Risankizumab-Rzaa"). A name made only of
// salt words ("Potassium Chloride") keeps them.
export function genericComponents(generic: string): string[] {
  return generic
    .replace(/\(.*?\)/g, ' ')
    .replace(/-[a-z]{4}\b/gi, ' ')
    .split(/\/|;| and /i)
    .map((part) => {
      const words = norm(part.split(',')[0]).split(' ').filter((w) => w.length >= 3);
      const core = words.filter((w) => !SALT_WORDS.has(w));
      return (core.length ? core : words).join(' ');
    })
    .filter((c) => c && c !== 'pf')
    .sort();
}

// ---------- Names ----------

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function drugNameFor(e: { brand: string; generic: string }): string {
  return e.brand;
}

// Match a list entry to existing drugs rows by brand, base brand, generic
// ingredients or alias. One hit -> that drug; none -> create; several ->
// ambiguous (review). "Fiasp / NovoLog (insulin)" matches Novolog because
// "novolog" is a whole word of its name.
export function matchExistingDrug(
  e: { brand: string; generic: string; members?: string[] },
  drugs: { id: string; name: string; brand_names: string[] | null; generic_name?: string | null }[],
): { id: string } | { create: true } | { ambiguous: string[] } {
  const brandEntry = isBrandEntry(e);
  const base = baseBrand(e.brand);
  const ingredients = genericComponents(e.generic).join('+');
  const hits = drugs.filter((d) => {
    const names = [d.name, ...(d.brand_names ?? [])];
    if (brandEntry) {
      return names.some((n) => norm(n) === norm(e.brand) || norm(n).split(' ').includes(base));
    }
    // Generic entry: same ingredients as the drug's name or stored generic.
    return [d.name, d.generic_name ?? ''].some((n) => n && genericComponents(n).join('+') === ingredients);
  });
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length === 0) return { create: true };
  return { ambiguous: hits.map((h) => h.name) };
}

// ---------- FDA NDC Directory (product.txt / package.txt, tab-delimited) ----------

export function parseTsv(text: string, delimiter = '\t'): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(delimiter).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(delimiter);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

export interface FdaProduct {
  PRODUCTID: string;
  PRODUCTNDC: string;
  PRODUCTTYPENAME: string;
  PROPRIETARYNAME: string;
  NONPROPRIETARYNAME: string;
  DOSAGEFORMNAME: string;
  ROUTENAME: string;
  MARKETINGCATEGORYNAME: string;
  LABELERNAME: string;
  ACTIVE_NUMERATOR_STRENGTH: string;
  ACTIVE_INGRED_UNIT: string;
  SUBSTANCENAME?: string;
  ENDMARKETINGDATE?: string;
  [k: string]: string | undefined;
}

// Active ingredients must line up: the same number of active substances
// (FDA SUBSTANCENAME, ';'-separated) as the CMS generic has components,
// every word of each component a prefix of a word in one substance (CMS
// truncates). This
// keeps combinations (Caduet, NovoLog Mix) out of single-ingredient drugs.
// Brand entries also need the proprietary name to start with the brand.
// Prescription products only.
export function substancesMatch(generic: string, substanceName: string): boolean {
  const comps = genericComponents(generic);
  const subs = substanceName.split(';').map((x) => norm(x)).filter(Boolean);
  if (comps.length === 0 || comps.length !== subs.length) return false;
  const used = new Set<number>();
  return comps.every((c) => {
    const i = subs.findIndex((sub, j) => {
      if (used.has(j)) return false;
      const words = sub.split(' ');
      return c.split(' ').every((cw) => words.some((w) => w.startsWith(cw)));
    });
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

// Kits (Humira, Trikafta, Cabenuva) carry no SUBSTANCENAME. For a BRAND
// entry, a kit matches on its nonproprietary name instead (every component
// found there); the brand name still has to match, so this stays narrow.
export function componentsIn(generic: string, text: string): boolean {
  const words = norm(text).split(' ');
  const comps = genericComponents(generic);
  return comps.length > 0 && comps.every((c) => c.split(' ').every((cw) => words.some((w) => w.startsWith(cw))));
}

// excludeBrands: base brand words of OTHER ranked brand drugs. A generic
// entry never takes their products (Levothyroxine leaves Synthroid's
// NDCs to Synthroid).
export function productsFor(
  e: { brand: string; generic: string },
  products: FdaProduct[],
  excludeBrands: Set<string> = new Set(),
): FdaProduct[] {
  const rx = products.filter((p) => /PRESCRIPTION/i.test(p.PRODUCTTYPENAME ?? ''));
  const first = (p: FdaProduct) => norm(p.PROPRIETARYNAME ?? '').split(' ')[0];
  if (!isBrandEntry(e)) {
    return rx.filter((p) => substancesMatch(e.generic, p.SUBSTANCENAME ?? '') && !excludeBrands.has(first(p)));
  }
  const base = baseBrand(e.brand);
  return rx.filter(
    (p) =>
      first(p) === base &&
      ((p.SUBSTANCENAME ?? '').trim() ? substancesMatch(e.generic, p.SUBSTANCENAME ?? '') : componentsIn(e.generic, p.NONPROPRIETARYNAME ?? '')),
  );
}

export interface NdcRow {
  ndc11: string;
  product_ndc: string;
  package_description: string;
  proprietary_name: string;
  nonproprietary_name: string;
  strength: string;
  dosage_form: string;
  route: string;
  labeler: string;
  marketing_category: string;
  marketing_end_date: string | null;
}

// FDA date fields are YYYYMMDD.
export function fdaDate(s: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((s ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function packagesFor(
  products: FdaProduct[],
  packages: Record<string, string>[],
): { rows: NdcRow[]; unparseable: string[] } {
  const byId = new Map(products.map((p) => [p.PRODUCTID, p]));
  const rows: NdcRow[] = [];
  const unparseable: string[] = [];
  for (const pk of packages) {
    const p = byId.get(pk.PRODUCTID);
    if (!p) continue;
    const ndc11 = normalizeNdc(pk.NDCPACKAGECODE);
    if (!ndc11) {
      unparseable.push(pk.NDCPACKAGECODE);
      continue;
    }
    rows.push({
      ndc11,
      product_ndc: p.PRODUCTNDC,
      package_description: pk.PACKAGEDESCRIPTION ?? '',
      proprietary_name: p.PROPRIETARYNAME,
      nonproprietary_name: p.NONPROPRIETARYNAME,
      strength: [p.ACTIVE_NUMERATOR_STRENGTH, p.ACTIVE_INGRED_UNIT].filter(Boolean).join(' '),
      dosage_form: p.DOSAGEFORMNAME,
      route: p.ROUTENAME,
      labeler: p.LABELERNAME,
      marketing_category: p.MARKETINGCATEGORYNAME,
      marketing_end_date: fdaDate(pk.ENDMARKETINGDATE) ?? fdaDate(p.ENDMARKETINGDATE),
    });
  }
  return { rows, unparseable };
}

// ---------- RxNorm (RxNav REST API) ----------

// /REST/rxcui.json?name=...&search=2 -> { idGroup: { rxnormId?: string[] } }
export function rxcuiFrom(body: unknown): { rxcui: string } | { none: true } | { ambiguous: string[] } {
  const ids = (body as any)?.idGroup?.rxnormId;
  if (!Array.isArray(ids) || ids.length === 0) return { none: true };
  const uniq = [...new Set(ids.map(String))];
  return uniq.length === 1 ? { rxcui: uniq[0] } : { ambiguous: uniq };
}

// ---------- Census ZCTA gazetteer ----------

// Census changed the delimiter: tabs through 2024, '|' from 2025.
export function parseGazetteer(text: string): { zip: string; lat: number; lng: number }[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  return parseTsv(text, firstLine.includes('|') ? '|' : '\t')
    .map((r) => ({ zip: r.GEOID, lat: Number(r.INTPTLAT), lng: Number(r.INTPTLONG) }))
    .filter((r) => /^\d{5}$/.test(r.zip) && Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180);
}

// ---------- NADAC window ----------

// "Latest plus about 12 weeks": as_of dates from (latest - 84 days).
export function nadacWindowStart(latestAsOf: string, weeks = 12): string {
  const d = new Date(`${latestAsOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}
