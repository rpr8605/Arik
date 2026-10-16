// Medicare coverage rules (free_data_loaders.md Part B), pure: turns the
// MCD download tables (LCD, Article, NCD packages) into one record per
// current document, following the MCD data dictionary:
// - IDs: LCD "L" + lcd_id, Article "A" + article_id; a value in
//   display_id marks a DRAFT ("DL"/"DA" + display_id), kept but never
//   offered as the rule in force.
// - States: with more than one contractor, use each contractor's
//   jurisdiction; with exactly one, use the document's primary
//   jurisdiction table (dictionary, ARTICLE_X_CONTRACTOR "Important!").
// - Codes: every listed CPT/HCPCS code (range flags B/M/E/N only mark the
//   position in a range); numbers only, descriptions are never kept.
// - Text: HTML stripped, cut to a short excerpt for citations.

import { unescapeXml } from './xlsx';

type Row = Record<string, string>;

export interface PolicyDoc {
  doc_type: 'NCD' | 'LCD' | 'Article';
  doc_id: string;
  version: number;
  display_id: string;
  title: string;
  status: string;
  is_draft: boolean;
  national: boolean;
  contractors: string[];
  jurisdictions: string[];
  effective_date: string | null;
  retirement_date: string | null;
  hcpcs_codes: string[];
  icd10_codes_count: number;
  citation_excerpt: string | null;
  related_documents: string[];
  source_url: string;
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return unescapeXml(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// A few whole sentences, at most ~`max` characters.
export function excerpt(text: string, max = 500): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (end > max * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')) + ' ...';
}

export const isoDate = (s: string | null | undefined): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((s ?? '').trim());
  return m ? m[1] : null;
};

// CPT (5 digits), CPT Category II/III (4 digits + F/T), HCPCS Level II (letter + 4 digits).
export function isProcedureCode(s: string): boolean {
  return /^(\d{5}|\d{4}[FT]|[A-V]\d{4})$/i.test(s.trim());
}

export const mcdUrl = (type: PolicyDoc['doc_type'], id: string, version: number) =>
  type === 'LCD'
    ? `https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=${id}&ver=${version}`
    : type === 'Article'
      ? `https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=${id}&ver=${version}`
      : `https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=${id}&ncdver=${version}`;

export interface MacTables {
  docs: Row[];
  xContractor: Row[];
  contractors: Row[];
  contractorJurisdiction: Row[];
  primaryJurisdiction: Row[];
  states: Row[];
  hcpc: Row[];
  icd10Covered?: Row[];
  related?: Row[];   // article_related_documents (Article -> LCD)
}

const groupBy = (rows: Row[], key: (r: Row) => string) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
};

// LCDs and Articles share one shape; only the column prefixes differ.
export function buildMacDocs(kind: 'LCD' | 'Article', t: MacTables): PolicyDoc[] {
  const p = kind === 'LCD' ? 'lcd' : 'article';
  const key = (r: Row) => `${r[`${p}_id`]}|${r[`${p}_version`]}`;
  const stateAbbrev = new Map(t.states.map((s) => [s.state_id, s.state_abbrev]));
  const contractorById = new Map(t.contractors.map((c) => [`${c.contractor_id}|${c.contractor_type_id}|${c.contractor_version}`, c]));
  const jurByContractor = groupBy(t.contractorJurisdiction, (r) => `${r.contractor_id}|${r.contractor_type_id}|${r.contractor_version}`);
  const xc = groupBy(t.xContractor, key);
  const prim = groupBy(t.primaryJurisdiction, key);
  const codes = groupBy(t.hcpc, key);
  const icd = groupBy(t.icd10Covered ?? [], key);
  const rel = groupBy(t.related ?? [], key);
  return t.docs.map((d) => {
    const k = key(d);
    const id = d[`${p}_id`];
    const version = Number(d[`${p}_version`]);
    const draft = (d.display_id ?? '').trim() !== '';
    const prefix = kind === 'LCD' ? 'L' : 'A';
    const cRows = xc.get(k) ?? [];
    const contractorRows = cRows.map((c) => contractorById.get(`${c.contractor_id}|${c.contractor_type_id}|${c.contractor_version}`)).filter(Boolean) as Row[];
    const stateIds =
      cRows.length > 1
        ? cRows.flatMap((c) => (jurByContractor.get(`${c.contractor_id}|${c.contractor_type_id}|${c.contractor_version}`) ?? []).map((j) => j.state_id))
        : (prim.get(k) ?? []).map((j) => j.state_id);
    const text = kind === 'LCD' ? d.indication || d.summary_of_evidence || d.coding_guidelines : d.description;
    return {
      doc_type: kind,
      doc_id: id,
      version,
      display_id: draft ? `D${prefix}${d.display_id.trim()}` : `${prefix}${id}`,
      title: stripHtml(d.title),
      status: (d.status ?? '').trim(),
      is_draft: draft,
      national: false,
      contractors: [...new Set(contractorRows.map((c) => `${c.contractor_bus_name.trim()} (${c.contractor_number.trim()})`))].sort(),
      jurisdictions: [...new Set(stateIds.map((s) => stateAbbrev.get(s)).filter((s): s is string => !!s && /^[A-Z]{2}$/.test(s)))].sort(),
      effective_date: isoDate(kind === 'LCD' ? d.rev_eff_date || d.orig_det_eff_date : d.article_eff_date),
      retirement_date: isoDate(d.date_retired || (kind === 'LCD' ? d.ent_det_end_date : d.article_end_date)),
      hcpcs_codes: [...new Set((codes.get(k) ?? []).map((c) => c.hcpc_code_id.trim().toUpperCase()).filter(isProcedureCode))].sort(),
      icd10_codes_count: (icd.get(k) ?? []).length,
      citation_excerpt: excerpt(stripHtml(text)),
      related_documents: [...new Set((rel.get(k) ?? []).map((r) => (r.r_lcd_id ? `L${r.r_lcd_id}` : '')).filter(Boolean))],
      source_url: mcdUrl(kind, id, version),
    };
  });
}

export function buildNcdDocs(rows: Row[]): PolicyDoc[] {
  return rows.map((r) => ({
    doc_type: 'NCD' as const,
    doc_id: r.NCD_id,
    version: Number(r.NCD_vrsn_num),
    display_id: `NCD ${r.NCD_mnl_sect}`.trim(),
    title: stripHtml(r.NCD_mnl_sect_title),
    // Retired NCDs sometimes keep an empty termination date and carry
    // "RETIRED" in the title instead (e.g. NCD 20.10); either marks it.
    status: r.NCD_trmntn_dt?.trim() || /\bRETIRED\b/i.test(r.NCD_mnl_sect_title ?? '') ? 'R' : 'A',
    is_draft: false,
    national: true,
    contractors: [],
    jurisdictions: [],
    effective_date: isoDate(r.NCD_efctv_dt),
    retirement_date: isoDate(r.NCD_trmntn_dt),
    hcpcs_codes: [],
    icd10_codes_count: 0,
    citation_excerpt: excerpt(stripHtml(r.indctn_lmtn || r.itm_srvc_desc)),
    related_documents: [],
    source_url: mcdUrl('NCD', r.NCD_id, Number(r.NCD_vrsn_num)),
  }));
}

// MCD publishes on Thursdays: the next Thursday after a retrieval.
export function nextThursday(fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  const add = ((4 - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

// ---------- getCoverageRule (pure ranking of candidate documents) ----------

export interface CoverageRuleHit {
  docType: string;
  displayId: string;
  version: number;
  title: string;
  effectiveDate: string | null;
  contractors: string[];
  excerpt: string | null;
  url: string;
  matchedBy: 'code' | 'title';
}

// Only rules in force: approved, not a draft, not retired as of `asOf`,
// national or covering the state. Code matches first, LCD before Article.
export function pickCoverageRules(docs: Record<string, any>[], q: { code: string | null; text: string | null; state: string | null; asOf: string }): CoverageRuleHit[] {
  const inForce = docs.filter(
    (d) =>
      d.status === 'A' &&
      !d.is_draft &&
      (!d.retirement_date || d.retirement_date > q.asOf) &&
      (!d.effective_date || d.effective_date <= q.asOf) &&
      (d.national || (q.state != null && (d.jurisdictions ?? []).includes(q.state))),
  );
  const words = (q.text ?? '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
  const hits = inForce
    .map((d) => {
      const byCode = q.code != null && (d.hcpcs_codes ?? []).includes(q.code.toUpperCase());
      const title = String(d.title).toLowerCase();
      const byTitle = !byCode && words.length > 0 && words.every((w) => title.includes(w));
      return byCode || byTitle ? { d, matchedBy: byCode ? ('code' as const) : ('title' as const) } : null;
    })
    .filter(Boolean) as { d: Record<string, any>; matchedBy: 'code' | 'title' }[];
  const typeRank: Record<string, number> = { NCD: 0, LCD: 1, Article: 2 };
  hits.sort((a, b) => (a.matchedBy === b.matchedBy ? 0 : a.matchedBy === 'code' ? -1 : 1) || typeRank[a.d.doc_type] - typeRank[b.d.doc_type] || String(a.d.display_id).localeCompare(String(b.d.display_id)));
  return hits.slice(0, 5).map(({ d, matchedBy }) => ({
    docType: d.doc_type,
    displayId: d.display_id,
    version: d.version,
    title: d.title,
    effectiveDate: d.effective_date,
    contractors: d.contractors ?? [],
    excerpt: d.citation_excerpt,
    url: d.source_url,
    matchedBy,
  }));
}
