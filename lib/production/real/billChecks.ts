// The real BillChecks: the pure rules (lib/rules/bills/checks.ts) with the
// patient rights checks (lib/rules/bills/rights.ts) and the
// Medicare reference rows for just the codes on this bill (db/039). A
// dataset that isn't loaded is left out, and its check finds nothing:
// no reference, no claim.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../supabaseAdmin';
import { billSetting, runBillChecks, type BillRefs, type Setting } from '../../rules/bills/checks';
import { runRightsChecks, type BillSituation } from '../../rules/bills/rights';
import type { BillChecks, ConfirmedBill } from '../types';

export type RefsLoader = (codes: string[], setting: Setting) => Promise<BillRefs>;

// Inpatient and hospital outpatient bills read the hospital tables; the
// unit-limit check itself skips inpatient stays.
const table = (s: Setting) => (s === 'practitioner' ? 'practitioner' : 'outpatient_hospital');

export function dbRefsLoader(db: () => SupabaseClient = supabaseAdmin): RefsLoader {
  return async (codes, setting) => {
    const c = db();
    const t = table(setting);
    if (!codes.length) return {};
    const [ds, mue, ptp, pfs] = await Promise.all([
      c.from('bill_ref_datasets').select('name, version'),
      c.from('bill_ref_mue').select('code, unit_limit, adjudication').eq('setting', t).in('code', codes),
      c.from('bill_ref_ptp').select('col1, col2, modifier, effective_date, deletion_date').eq('setting', t).in('col1', codes).in('col2', codes),
      c.from('bill_ref_pfs').select('code, facility_usd, non_facility_usd').in('code', codes),
    ]);
    for (const r of [ds, mue, ptp, pfs]) if (r.error) throw new Error(`bill reference data: ${r.error.message}`);
    const version = (name: string) => (ds.data ?? []).find((d) => d.name === name)?.version as string | undefined;
    const refs: BillRefs = {};
    const mueV = version(`mue_${t}`);
    if (mueV) refs.mue = { version: mueV, byCode: Object.fromEntries((mue.data ?? []).map((r) => [r.code, { limit: r.unit_limit, mai: r.adjudication }])) };
    const ptpV = version(`ptp_${t}`);
    if (ptpV) refs.ptp = { version: ptpV, pairs: (ptp.data ?? []).map((r) => ({ col1: r.col1, col2: r.col2, modifier: r.modifier, effective: r.effective_date, deleted: r.deletion_date })) };
    const pfsV = version('pfs');
    if (pfsV) refs.pfs = { version: pfsV, byCode: Object.fromEntries((pfs.data ?? []).map((r) => [r.code, { facilityUsd: Number(r.facility_usd), nonFacilityUsd: Number(r.non_facility_usd) }])) };
    return refs;
  };
}

export function realBillChecks(loadRefs: RefsLoader = dbRefsLoader()): BillChecks {
  return {
    name: 'rules-v1',
    // Without a situation, coverage is unknown: the rights checks then say
    // "if" and never assume a plan type.
    async run(bill: ConfirmedBill, situation: BillSituation = { coverage: 'unknown' }) {
      const codes = [...new Set(bill.lines.map((l) => l.code).filter((c): c is string => !!c))];
      return [...runBillChecks(bill, await loadRefs(codes, billSetting(bill))), ...runRightsChecks(bill, situation)];
    },
  };
}
