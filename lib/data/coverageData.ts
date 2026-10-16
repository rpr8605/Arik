// getCoverageRule (free_data_loaders.md Part B, step 7): the Medicare
// coverage rule in force for a procedure code or a service/drug name in a
// state, with its id, version, date and MCD link. Part B services, DME,
// labs and clinic-given drugs only; Part D pills are not in the MCD, and
// the "no data" reason says so. Pure selection is in lib/data/coverage.ts.

import { supabaseAdmin } from '../supabaseAdmin';
import { isProcedureCode, pickCoverageRules, type CoverageRuleHit } from './coverage';

export type CoverageLookup =
  | { found: true; rules: CoverageRuleHit[]; source: { label: string; url: string; retrieved: string } }
  | { found: false; reason: string };

export async function getCoverageRule(codeOrText: string, state: string | null, asOf = new Date().toISOString().slice(0, 10)): Promise<CoverageLookup> {
  const q = codeOrText.trim();
  if (!q) return { found: false, reason: 'need a procedure code or the name of a service' };
  const st = state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null;
  const code = isProcedureCode(q) ? q.toUpperCase() : null;
  let query = supabaseAdmin()
    .from('policy_documents')
    .select('doc_type, doc_id, version, display_id, title, status, is_draft, national, contractors, jurisdictions, effective_date, retirement_date, hcpcs_codes, citation_excerpt, source_url, retrieved_date')
    .eq('status', 'A')
    .eq('is_draft', false);
  query = code ? query.contains('hcpcs_codes', [code]) : query.ilike('title', `%${q.split(/\s+/)[0].replace(/[%_]/g, '')}%`);
  const { data, error } = await query.limit(200);
  if (error || !data) return { found: false, reason: 'coverage rules are not loaded yet' };
  const rules = pickCoverageRules(data, { code, text: code ? null : q, state: st, asOf });
  if (rules.length === 0) {
    return {
      found: false,
      reason: code
        ? `no Medicare coverage rule in force lists ${code}${st ? ` for ${st}` : ''}`
        : 'no Medicare coverage rule matches that name (prescription pills are covered by Part D plans, not these rules)',
    };
  }
  const retrieved = data.map((d) => d.retrieved_date).sort().at(-1) ?? asOf;
  return { found: true, rules, source: { label: `Medicare Coverage Database (CMS), retrieved ${retrieved}`, url: 'https://www.cms.gov/medicare-coverage-database/', retrieved } };
}
