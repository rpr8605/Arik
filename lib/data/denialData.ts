// AI lookup tools for denial data (free_data_loaders.md Part A, step 4).
// Each returns the values with the source label, URL and data year, or
// { found: false } with a plain reason. Results go into the chat's
// retrieved context, so the grounding guard accepts their numbers and
// nothing else (lib/groundingGuard.ts). Pure shaping is in lib/data/denial.ts.

import { supabaseAdmin } from '../supabaseAdmin';
import { summarizeDenialRow, TIC_SOURCE_LABEL, type DenialSummary, type Lookup } from './denial';

export async function getInsurerDenialStats(issuer: string, state: string, market = 'individual_qhp'): Promise<Lookup<{ stats: DenialSummary }>> {
  const st = state.trim().toUpperCase();
  const q = issuer.trim();
  if (!/^[A-Z]{2}$/.test(st) || !q) return { found: false, reason: 'need an insurer and a 2-letter state' };
  let query = supabaseAdmin().from('payer_denial_stats').select('*, sources(title, url)').eq('state', st).eq('market', market);
  query = /^\d{5}$/.test(q) ? query.eq('issuer_id', q) : query.ilike('issuer_name', `%${q.replace(/[%_]/g, '')}%`);
  const { data, error } = await query.order('plan_year', { ascending: false }).limit(5);
  if (error || !data || data.length === 0) return { found: false, reason: 'no CMS denial data for that insurer and state (HealthCare.gov plans only)' };
  const latest = data.filter((r) => r.plan_year === data[0].plan_year);
  if (new Set(latest.map((r) => r.issuer_id)).size > 1) return { found: false, reason: `several insurers match: ${[...new Set(latest.map((r) => r.issuer_name))].join(', ')}` };
  const r = latest[0];
  return {
    found: true,
    stats: summarizeDenialRow(r),
    source: { label: TIC_SOURCE_LABEL(r.plan_year), url: r.sources?.url ?? 'https://www.cms.gov/marketplace/resources/data/public-use-files', dataYear: r.plan_year },
  };
}

export interface PriorAuthSummary {
  payer: string;
  program: string;
  reportingLevel: string;
  state: string | null;
  pctStandardApproved: number | null;
  pctStandardDenied: number | null;
  pctApprovedAfterAppeal: number | null;
  pctExpeditedApproved: number | null;
  pctExpeditedDenied: number | null;
  avgDecisionTime: number | null;
  medianDecisionTime: number | null;
  decisionTimeUnit: string | null;
}

export async function getPriorAuthMetrics(payer: string, program: string, state: string | null): Promise<Lookup<{ metrics: PriorAuthSummary }>> {
  if (!payer.trim()) return { found: false, reason: 'need a payer' };
  let query = supabaseAdmin().from('prior_auth_metrics').select('*').ilike('payer', `%${payer.trim().replace(/[%_]/g, '')}%`).eq('program', program);
  if (state) query = query.or(`state.eq.${state.toUpperCase()},state.is.null`);
  const { data, error } = await query.order('report_year', { ascending: false }).limit(5);
  if (error || !data || data.length === 0) return { found: false, reason: 'that payer has not posted prior authorization metrics we have on file' };
  const r = data.find((x) => x.state === (state ?? '').toUpperCase()) ?? data[0];
  return {
    found: true,
    metrics: {
      payer: r.payer,
      program: r.program,
      reportingLevel: r.reporting_level,
      state: r.state,
      pctStandardApproved: r.pct_standard_approved,
      pctStandardDenied: r.pct_standard_denied,
      pctApprovedAfterAppeal: r.pct_standard_approved_after_appeal,
      pctExpeditedApproved: r.pct_expedited_approved,
      pctExpeditedDenied: r.pct_expedited_denied,
      avgDecisionTime: r.avg_decision_time,
      medianDecisionTime: r.median_decision_time,
      decisionTimeUnit: r.decision_time_unit,
    },
    source: { label: `Prior authorization report posted by ${r.payer}, report year ${r.report_year}`, url: r.source_url, dataYear: r.report_year },
  };
}
