// Denial data (free_data_loaders.md Part A), pure: CMS Transparency in
// Coverage PUF parsing and per-issuer aggregation (D1), prior auth metric
// row validation (D2), and the lookup summaries the chat may quote. The
// numbers describe an INSURER or PLAN, never one patient's chances; the
// wording here never turns them into a personal prediction, and the
// grounding guard rejects model text that does (groundingGuard.ts rule 5).

// ---------- D1: values as the PUF writes them ----------

// The PUF legend: "*" not available, "**" suppressed (small cell sizes),
// "***" not required for the plan type, "N/A" new to the Exchange.
export type ValueFlag = 'not_available' | 'suppressed' | 'not_required' | 'not_applicable' | 'unparseable';

export function parseTicValue(raw: unknown): { value: number | null; flag: ValueFlag | null } {
  if (raw == null) return { value: null, flag: 'not_available' };
  const s = String(raw).trim();
  if (s === '') return { value: null, flag: 'not_available' };
  if (s === '*') return { value: null, flag: 'not_available' };
  if (s === '**') return { value: null, flag: 'suppressed' };
  if (s === '***') return { value: null, flag: 'not_required' };
  if (/^n\/?a$/i.test(s)) return { value: null, flag: 'not_applicable' };
  const n = Number(s.replace(/,/g, ''));
  if (Number.isInteger(n) && n >= 0) return { value: n, flag: null };
  return { value: null, flag: 'unparseable' };
}

// PUF column -> payer_denial_stats column. Issuer-level fields repeat on
// every plan row; reason fields are per plan and summed per issuer.
export const TIC_ISSUER_FIELDS: Record<string, string> = {
  Issuer_Claims_Received_In_Network: 'claims_received_in',
  Issuer_Claims_Received_Out_of_Network: 'claims_received_out',
  Issuer_Claims_Denied_In_Network: 'claims_denied_in',
  Issuer_Claims_Denied_Out_of_Network: 'claims_denied_out',
  Issuer_Claims_Resubmitted_In_Network: 'claims_resubmitted_in',
  Issuer_Claims_Resubmitted_Out_of_Network: 'claims_resubmitted_out',
  Issuer_Internal_Appeals_Filed: 'internal_appeals_filed',
  Issuer_Number_Internal_Appeals_Overturned: 'internal_appeals_overturned',
  Issuer_External_Appeals_Filed: 'external_appeals_filed',
  Issuer_Number_External_Appeals_Overturned: 'external_appeals_overturned',
};

export const TIC_REASON_FIELDS: Record<string, string> = {
  Plan_Number_Claims_Denied_Referral_Required: 'denied_prior_auth',
  Plan_Number_Claims_Denied_Due_To_Out_Of_Network: 'denied_out_of_network',
  Plan_Number_Claims_Denied_Services_Excluded: 'denied_excluded_service',
  Plan_Number_Claims_Denied_Not_Medically_Necessary_Excluding_Behavioral_Health: 'denied_not_medically_necessary',
  Plan_Number_Claims_Denied_Not_Medically_Necessary_Behavioral_Health_Only: 'denied_not_medically_necessary_bh',
  Plan_Number_Claims_Denied_Due_To_Enrolle_Benefit_Limit_Reached: 'denied_benefit_limit',
  Plan_Number_Claims_Denied_Due_To_Member_Not_Covered: 'denied_member_not_covered',
  Plan_Number_Claims_Denied_Due_To_Investigational_Experimental_Cosmetic_Proceduce: 'denied_investigational',
  Plan_Number_Claims_Denied_Due_To_Administrative_Reason: 'denied_administrative',
  Plan_Number_Claims_Denied_Other: 'denied_other',
};

export const REASON_LABELS: Record<string, string> = {
  denied_prior_auth: 'prior authorization or referral required',
  denied_out_of_network: 'out-of-network provider',
  denied_excluded_service: 'service excluded or not covered',
  denied_not_medically_necessary: 'not medically necessary',
  denied_not_medically_necessary_bh: 'not medically necessary (behavioral health)',
  denied_benefit_limit: 'benefit limit reached',
  denied_member_not_covered: 'member not covered on that date',
  denied_investigational: 'investigational, experimental or cosmetic',
  denied_administrative: 'administrative reasons',
  denied_other: 'other reasons',
};

export interface TicIssuerRow {
  market: 'individual_qhp' | 'individual_sadp' | 'shop';
  state: string;
  issuer_id: string;
  issuer_name: string;
  plan_year: number;
  file_year: number;
  plans_count: number;
  reasons_partial: boolean;
  value_flags: Record<string, ValueFlag>;
  [col: string]: unknown;
}

export function aggregateTic(
  rows: Record<string, string | null>[],
  meta: { market: TicIssuerRow['market']; planYear: number; fileYear: number },
): { issuers: TicIssuerRow[]; skipped: { reason: string; count: number }[] } {
  const groups = new Map<string, TicIssuerRow & { _reasonSeen: Record<string, boolean> }>();
  const skips = new Map<string, number>();
  const skip = (r: string) => skips.set(r, (skips.get(r) ?? 0) + 1);
  for (const r of rows) {
    const state = String(r.State ?? '').trim().toUpperCase();
    const issuerId = String(r.Issuer_ID ?? '').trim();
    const name = String(r.Issuer_Name ?? '').trim();
    if (!/^[A-Z]{2}$/.test(state)) {
      skip('bad state');
      continue;
    }
    if (!/^\d{5}$/.test(issuerId)) {
      skip('bad issuer id');
      continue;
    }
    if (!name) {
      skip('missing issuer name');
      continue;
    }
    const key = `${state}|${issuerId}`;
    let g = groups.get(key);
    if (!g) {
      g = { market: meta.market, state, issuer_id: issuerId, issuer_name: name, plan_year: meta.planYear, file_year: meta.fileYear, plans_count: 0, reasons_partial: false, value_flags: {}, _reasonSeen: {} };
      for (const [col, field] of Object.entries(TIC_ISSUER_FIELDS)) {
        const v = parseTicValue(r[col]);
        g[field] = v.value;
        if (v.flag) g.value_flags[field] = v.flag;
      }
      for (const field of Object.values(TIC_REASON_FIELDS)) g[field] = null;
      groups.set(key, g);
    }
    g.plans_count++;
    for (const [col, field] of Object.entries(TIC_REASON_FIELDS)) {
      const v = parseTicValue(r[col]);
      if (v.value != null) {
        g[field] = ((g[field] as number | null) ?? 0) + v.value;
        g._reasonSeen[field] = true;
      } else if (v.flag !== 'not_applicable' && v.flag !== 'not_required') {
        g.reasons_partial = true;
      }
    }
  }
  const issuers = [...groups.values()].map(({ _reasonSeen, ...rest }) => {
    // Reasons summed over some plans but missing on others are a floor.
    if (rest.reasons_partial && !Object.keys(_reasonSeen).length) rest.reasons_partial = false;
    return rest as TicIssuerRow;
  });
  return { issuers, skipped: [...skips.entries()].map(([reason, count]) => ({ reason, count })) };
}

// ---------- D2: prior auth template rows ----------

export const PRIOR_AUTH_COLUMNS = [
  'example', 'payer', 'program', 'reporting_level', 'reporting_unit', 'state', 'report_year',
  'pct_standard_approved', 'pct_standard_denied', 'pct_standard_approved_after_appeal',
  'pct_expedited_approved', 'pct_expedited_denied', 'avg_decision_time', 'median_decision_time',
  'decision_time_unit', 'source_url', 'retrieved_date', 'captured_by',
] as const;

export type PriorAuthRow = Record<string, string | number | null>;

export function validatePriorAuthRow(v: Record<string, string>, line: number): { row: PriorAuthRow } | { skip: 'example' } | { error: string } {
  if ((v.example ?? '').trim().toUpperCase() === 'EXAMPLE') return { skip: 'example' };
  const err = (m: string) => ({ error: `line ${line}: ${m}` });
  if (!v.payer) return err('payer is required');
  if (!['MA', 'Medicaid', 'CHIP', 'QHP'].includes(v.program)) return err('program must be MA, Medicaid, CHIP or QHP');
  if (!['contract', 'state', 'plan', 'issuer'].includes(v.reporting_level)) return err('reporting_level must be contract, state, plan or issuer');
  if (v.state && !/^[A-Z]{2}$/.test(v.state)) return err('state must be a 2-letter code');
  const year = Number(v.report_year);
  if (!Number.isInteger(year) || year < 2025 || year > 2100) return err('report_year must be a year (first reports cover 2025)');
  const out: PriorAuthRow = {
    payer: v.payer,
    program: v.program,
    reporting_level: v.reporting_level,
    reporting_unit: v.reporting_unit || null,
    state: v.state || null,
    report_year: year,
    decision_time_unit: v.decision_time_unit || null,
  };
  for (const k of ['pct_standard_approved', 'pct_standard_denied', 'pct_standard_approved_after_appeal', 'pct_expedited_approved', 'pct_expedited_denied']) {
    if (v[k] === '' || v[k] == null) {
      out[k] = null;
      continue;
    }
    const n = Number(v[k].replace(/%$/, ''));
    if (!Number.isFinite(n) || n < 0 || n > 100) return err(`${k} must be a percent from 0 to 100`);
    out[k] = n;
  }
  for (const k of ['avg_decision_time', 'median_decision_time']) {
    if (v[k] === '' || v[k] == null) {
      out[k] = null;
      continue;
    }
    const n = Number(v[k]);
    if (!Number.isFinite(n) || n < 0) return err(`${k} must be a number of ${v.decision_time_unit || 'units'}`);
    out[k] = n;
  }
  if ((out.avg_decision_time != null || out.median_decision_time != null) && !out.decision_time_unit) return err('decision_time_unit is required with a decision time (as the payer reports it)');
  if (!/^https?:\/\/\S+$/.test(v.source_url ?? '')) return err('source_url must be the page the numbers came from');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.retrieved_date ?? '') || Number.isNaN(Date.parse(v.retrieved_date))) return err('retrieved_date must be YYYY-MM-DD');
  if (!['manual', 'auto'].includes(v.captured_by)) return err('captured_by must be manual or auto');
  out.source_url = v.source_url;
  out.retrieved_date = v.retrieved_date;
  out.captured_by = v.captured_by;
  return { row: out };
}

// ---------- Lookup summaries ----------

export interface SourceRef {
  label: string;
  url: string;
  dataYear: number;
}

export type Lookup<T> = ({ found: true } & T & { source: SourceRef }) | { found: false; reason: string };

export interface DenialSummary {
  issuerName: string;
  state: string;
  market: string;
  claimsReceived: number | null;
  claimsDenied: number | null;
  denialRatePct: number | null;   // denied / received, issuer level, as reported
  topReasons: { reason: string; count: number }[];
  reasonsPartial: boolean;
  internalAppeals: { filed: number | null; overturned: number | null };
  externalAppeals: { filed: number | null; overturned: number | null };
  suppressed: string[];
}

const sumKnown = (...xs: (number | null | undefined)[]) => (xs.some((x) => x == null) ? null : xs.reduce((a: number, b) => a + (b as number), 0));

export function summarizeDenialRow(r: Record<string, any>): DenialSummary {
  const received = sumKnown(r.claims_received_in, r.claims_received_out);
  const denied = sumKnown(r.claims_denied_in, r.claims_denied_out);
  const reasons = Object.keys(REASON_LABELS)
    .filter((k) => typeof r[k] === 'number' && r[k] > 0)
    .map((k) => ({ reason: REASON_LABELS[k], count: Number(r[k]) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return {
    issuerName: r.issuer_name,
    state: r.state,
    market: r.market,
    claimsReceived: received,
    claimsDenied: denied,
    denialRatePct: received && denied != null ? Math.round((denied / received) * 1000) / 10 : null,
    topReasons: reasons,
    reasonsPartial: !!r.reasons_partial,
    internalAppeals: { filed: r.internal_appeals_filed ?? null, overturned: r.internal_appeals_overturned ?? null },
    externalAppeals: { filed: r.external_appeals_filed ?? null, overturned: r.external_appeals_overturned ?? null },
    suppressed: Object.entries(r.value_flags ?? {}).filter(([, f]) => f === 'suppressed').map(([k]) => k),
  };
}

export const TIC_SOURCE_LABEL = (planYear: number) => `CMS Transparency in Coverage public use file, HealthCare.gov plans, plan year ${planYear}`;

// What Arik says about it: the INSURER's numbers, with source and year.
// Never "your chance"; that is a person's case, and these are averages.
export function describeDenialStats(s: DenialSummary, src: SourceRef): string {
  const parts: string[] = [];
  if (s.denialRatePct != null) {
    parts.push(`${s.issuerName} denied ${s.denialRatePct}% of the claims it received for its ${s.state} HealthCare.gov plans in ${src.dataYear} (${s.claimsDenied!.toLocaleString('en-US')} of ${s.claimsReceived!.toLocaleString('en-US')}).`);
  } else {
    parts.push(`${s.issuerName}'s overall denial count for its ${s.state} HealthCare.gov plans in ${src.dataYear} isn't public (some numbers were withheld or not reported).`);
  }
  if (s.topReasons.length) parts.push(`Most common reasons it gave: ${s.topReasons.map((t) => t.reason).join(', ')}${s.reasonsPartial ? ' (some plans did not report every reason)' : ''}.`);
  const io = s.internalAppeals;
  if (io.filed != null && io.overturned != null && io.filed > 0) parts.push(`Of ${io.filed.toLocaleString('en-US')} internal appeals filed, ${io.overturned.toLocaleString('en-US')} were overturned.`);
  parts.push(`These are the insurer's totals, not a prediction for any one claim. Source: ${src.label}.`);
  return parts.join(' ');
}
