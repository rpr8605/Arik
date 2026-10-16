// Bill review checks (lib/rules/bills/checks.ts) and their reference-file
// parsers (lib/rules/bills/refs.ts). Pure.
// - The real engine reproduces the demo walkthrough's hospital-bill
//   findings on the same extraction (LUIS_EXTRACTION).
// - On 40 synthetic bills, every planted problem is found on the right
//   lines with the right amount, and nothing unplanted is called "wrong".
// - Every finding honors the findings contract, and every dollar figure in
//   the patient's text is grounded.
// Run: npx tsx scripts/test_bill_checks.ts

import { confirm, demoBillChecks, LUIS_EXTRACTION } from '../lib/production/demo';
import { findingsProblems, findingsTotal } from '../lib/production/contracts';
import type { ConfirmedBill, Finding } from '../lib/production/types';
import { billSetting, runBillChecks, usd, type BillRefs } from '../lib/rules/bills/checks';
import { parseMueCsv, parsePfsCsv, parsePtpTxt } from '../lib/rules/bills/refs';
import { makeBill } from '../lib/synth/model';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

// TEST FIXTURE, not CMS data: one procedure-to-procedure pair in the
// published layout, used only until the real pair files are licensed and
// loaded.
const PTP_FIXTURE = parsePtpTxt('80053\t80048\t\t20000101\t*\t0\tTest fixture\n');
const REFS: BillRefs = {
  ptp: { version: 'test-fixture', pairs: PTP_FIXTURE.pairs },
  mue: { version: 'mue-test', byCode: { '85025': { limit: 4, mai: 3 }, '80053': { limit: 1, mai: 3 }, J2405: { limit: 2, mai: 1 } } },
  pfs: { version: 'pfs-test', byCode: { '99284': { facilityUsd: 118.24, nonFacilityUsd: 118.24 }, '99213': { facilityUsd: 57.45, nonFacilityUsd: 95.19 } } },
};

// Every $ figure in a finding's text is a bill charge (or units x it), the
// finding's own amount, or a reference amount from REFS.
function grounded(f: Finding, bill: ConfirmedBill): boolean {
  const allowed = new Set<string>();
  for (const l of bill.lines) if (l.chargeUsd != null) allowed.add(usd(l.chargeUsd));
  if (f.amountUsd != null) allowed.add(usd(f.amountUsd));
  for (const r of Object.values(REFS.pfs!.byCode)) for (const u of [1, 2, 3]) {
    allowed.add(usd(Math.round(r.facilityUsd * u * 100) / 100));
    allowed.add(usd(Math.round(r.nonFacilityUsd * u * 100) / 100));
  }
  return (f.plainText.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []).every((m) => allowed.has(m));
}

const ok = (fs: Finding[], bill: ConfirmedBill) => findingsProblems(fs, bill).length === 0 && fs.every((f) => grounded(f, bill));

// ---------- The demo bill ----------
(async () => {
  const luis = confirm(LUIS_EXTRACTION, '2026-10-16T00:00:00Z');
  const demo = await demoBillChecks.run(luis);
  const real = runBillChecks(luis, REFS);
  check('Luis: inpatient stay', billSetting(luis) === 'inpatient');
  for (const d of demo) {
    const r = real.find((x) => x.ruleId === d.ruleId && x.lines.join() === d.lines.join());
    check(`Luis: real engine reproduces demo finding ${d.ruleId} (lines ${d.lines.join(',')}, ${usd(d.amountUsd ?? 0)})`, !!r && r.amountUsd === d.amountUsd, r ? `${r.amountUsd} ${r.tone}` : 'missing');
  }
  check('Luis: the panel pair is asked about on an inpatient stay (the demo says wrong)', real.find((x) => x.ruleId === 'ncci_ptp')?.tone === 'ask');
  check('Luis: findings total matches the demo', findingsTotal(real) === findingsTotal(demo), `${findingsTotal(real)} vs ${findingsTotal(demo)}`);
  check('Luis: contract and grounding', ok(real, luis), findingsProblems(real, luis).join('; '));
  const noPairs = runBillChecks(luis, { ...REFS, ptp: undefined });
  check('Luis: without pair data, no pair finding (no guessing)', !noPairs.some((f) => f.ruleId === 'ncci_ptp') && noPairs.length === real.length - 1);
  check('Luis: room text in plain words', /3 days in the room, but your stay was 2 nights \(Sep 3 to Sep 5\)\. That is one extra day\./.test(real.find((f) => f.ruleId === 'room_days')!.plainText));

  // ---------- 40 synthetic bills ----------
  let found = 0;
  let planted = 0;
  let falseWrong = 0;
  let contract = true;
  const misses: string[] = [];
  for (let s = 1; s <= 40; s++) {
    const b = makeBill(s);
    const bill: ConfirmedBill = {
      confirmedAt: '2026-10-16T00:00:00Z',
      header: { patientName: b.patientName, provider: b.provider, accountNumber: b.accountNumber, statementDate: b.statementDate, serviceFrom: b.serviceFrom, serviceTo: b.serviceTo, totalChargesUsd: b.totalChargesUsd, amountDueUsd: b.amountDueUsd },
      lines: b.lines.map((l) => ({ ...l, box: null })),
    };
    const fs = runBillChecks(bill, REFS);
    if (!ok(fs, bill)) {
      contract = false;
      misses.push(`${b.id} contract: ${findingsProblems(fs, bill).join('; ')}`);
    }
    const rule = { duplicate: 'duplicate_charge', unbundled_panel: 'ncci_ptp', room_days: 'room_days', unlisted_supplies: 'ask_about' } as const;
    for (const p of b.planted) {
      planted++;
      // A planted panel pair may share its day with another full panel;
      // the included (basic) panel line is what must be found.
      const must = p.kind === 'unbundled_panel' ? [p.lines[1]] : p.lines;
      const f = fs.find((x) => x.ruleId === rule[p.kind] && must.every((i) => x.lines.includes(i)));
      const amountOk = !f ? false : p.kind === 'room_days' ? Math.abs((f.amountUsd ?? 0) - (p.amountUsd ?? 0)) < 0.02 : p.amountUsd == null || f.amountUsd === p.amountUsd;
      if (f && amountOk) found++;
      else misses.push(`${b.id} ${p.kind} ${f ? `amount ${f.amountUsd} vs ${p.amountUsd}` : 'not found'}`);
    }
    for (const f of fs.filter((x) => x.tone === 'wrong')) {
      const kind = Object.entries(rule).find(([, r]) => r === f.ruleId)?.[0];
      if (!b.planted.some((p) => p.kind === kind && p.lines.every((i) => f.lines.includes(i)))) falseWrong++;
    }
  }
  check(`synthetic: every planted problem found with the right lines and amount (${found}/${planted})`, found === planted && planted > 30, misses.slice(0, 4).join(' | '));
  check('synthetic: nothing unplanted is called wrong', falseWrong === 0, String(falseWrong));
  check('synthetic: contract and grounding on all 40', contract, misses.find((m) => m.includes('contract')) ?? '');

  // ---------- Unit limits, settings, no double counting ----------
  const mk = (provider: string, lines: [string | null, string, number, number, string?][]): ConfirmedBill => ({
    confirmedAt: '2026-10-16T00:00:00Z',
    header: { patientName: 'Sample Person', provider, accountNumber: 'X-1', statementDate: '2026-02-01', serviceFrom: '2026-01-05', serviceTo: '2026-01-05', totalChargesUsd: null, amountDueUsd: null },
    lines: lines.map(([code, date, units, chargeUsd, description]) => ({ code, date, units, chargeUsd, description: description ?? null, box: null })),
  });
  const opd = mk('Harborlight General Hospital', [['85025', '2026-01-05', 3, 300], ['85025', '2026-01-05', 2, 210]]);
  check('setting: hospital name, no room = outpatient hospital', billSetting(opd) === 'outpatient_hospital');
  const u = runBillChecks(opd, REFS).filter((f) => f.ruleId === 'mue_units');
  check('units: 5 blood counts in a day over a limit of 4 is asked about, priced per unit', u.length === 1 && u[0].tone === 'ask' && u[0].amountUsd === 102 && /at most 4 a day/.test(u[0].plainText), JSON.stringify(u[0]));
  const perLine = mk('Harborlight General Hospital', [['J2405', '2026-01-05', 3, 90], ['J2405', '2026-01-05', 2, 60]]);
  const pl = runBillChecks(perLine, REFS).filter((f) => f.ruleId === 'mue_units');
  check('units: a per-line limit counts each line on its own', pl.length === 1 && pl[0].lines.join() === '0' && /on one line/.test(pl[0].plainText));
  const dupPanel = mk('Harborlight General Hospital', [['80053', '2026-01-05', 1, 400], ['80053', '2026-01-05', 1, 400]]);
  const dp = runBillChecks(dupPanel, REFS);
  check('no double counting: a duplicate over a unit limit is one finding', dp.length === 1 && dp[0].ruleId === 'duplicate_charge' && findingsTotal(dp) === 400);
  const inpt = mk('Harborlight General Hospital', [['85025', '2026-01-05', 6, 600], ['0120', '2026-01-05', 1, 2000]]);
  check('units: Medicare unit limits are not applied to an inpatient stay', !runBillChecks(inpt, REFS).some((f) => f.ruleId === 'mue_units'));
  const nearDup = mk('Harborlight General Hospital', [['71046', '2026-01-05', 1, 640], ['71046', '2026-01-05', 1, 590]]);
  const nd = runBillChecks(nearDup, REFS);
  check('near duplicates: same code and day, different prices, asked with no amount', nd.length === 1 && nd[0].tone === 'ask' && nd[0].amountUsd === null);

  // ---------- Pairs: dates, modifiers ----------
  const pairsBill = mk('Harborlight General Hospital', [['80053', '2026-01-05', 1, 400], ['80048', '2026-01-05', 1, 300]]);
  const pairOut = (pairs: BillRefs['ptp']) => runBillChecks(pairsBill, { ptp: pairs }).filter((f) => f.ruleId === 'ncci_ptp');
  check('pairs: modifier 0 outpatient = wrong, amount is the included code', pairOut(REFS.ptp)[0]?.tone === 'wrong' && pairOut(REFS.ptp)[0]?.amountUsd === 300);
  check('pairs: modifier 1 = ask', pairOut({ version: 't', pairs: [{ ...PTP_FIXTURE.pairs[0], modifier: 1 }] })[0]?.tone === 'ask');
  check('pairs: modifier 9 ignored', pairOut({ version: 't', pairs: [{ ...PTP_FIXTURE.pairs[0], modifier: 9 }] }).length === 0);
  check('pairs: a pair deleted before the service date is ignored', pairOut({ version: 't', pairs: [{ ...PTP_FIXTURE.pairs[0], deleted: '2025-12-31' }] }).length === 0);
  check('pairs: a pair effective after the service date is ignored', pairOut({ version: 't', pairs: [{ ...PTP_FIXTURE.pairs[0], effective: '2026-04-01' }] }).length === 0);
  check('pairs: on different days, no finding', runBillChecks(mk('X Hospital', [['80053', '2026-01-05', 1, 400], ['80048', '2026-01-06', 1, 300]]), REFS).every((f) => f.ruleId !== 'ncci_ptp'));

  // ---------- Price benchmark: doctor bills only ----------
  const doc = mk('Dr. Sample Practice', [['99284', '2026-01-05', 1, 1240]]);
  const pb = runBillChecks(doc, REFS);
  check('setting: no hospital name = doctor bill', billSetting(doc) === 'practitioner');
  check('benchmark: doctor bill compared with what Medicare pays, worded as a comparison, no amount', pb.length === 1 && pb[0].tone === 'ask' && pb[0].amountUsd === null && pb[0].plainText.includes('$118.24') && /doesn't mean your bill is wrong/.test(pb[0].plainText) && !/overcharg/i.test(pb[0].plainText));
  check('benchmark: facility and office amounts shown as a range', /\$57\.45 to \$95\.19/.test(runBillChecks(mk('Dr. Sample', [['99213', '2026-01-05', 1, 500]]), REFS)[0]?.plainText ?? ''));
  check('benchmark: under 3 times the Medicare amount, nothing', runBillChecks(mk('Dr. Sample', [['99284', '2026-01-05', 1, 300]]), REFS).length === 0);
  check('benchmark: not on hospital bills (that needs the hospital fee schedule)', !runBillChecks(mk('Harborlight General Hospital', [['99284', '2026-01-05', 1, 1240]]), REFS).some((f) => f.ruleId === 'price_benchmark'));
  check('benchmark: contract and grounding', ok(pb, doc));

  // ---------- Ask about ----------
  const vague = mk('X Hospital', [[null, '2026-01-05', 1, 420, 'Misc. supplies'], ['G0463', '2026-01-05', 1, 380, 'Facility fee'], [null, '2026-01-05', 1, 75, 'Other']]);
  const av = runBillChecks(vague, REFS);
  check('ask about: supplies, facility fee and an uncoded line, each asked', av.length === 3 && av.every((f) => f.tone === 'ask' && f.ruleId === 'ask_about'));
  check('ask about: contract and grounding', ok(av, vague));

  // ---------- Parsers ----------
  const mue = parseMueCsv('"CPT copyright notice",,,\n"HCPCS/\nCPT Code",Outpatient Hospital Services MUE Values,MUE Adjudication Indicator,MUE Rationale\n85025,4,3 Date of Service Edit: Clinical,Clinical: Data\nJ2405,64,1 Line Edit,Prescribing Information\nBAD,x,9 nope,\n');
  check('MUE parser: limits and adjudication', mue.byCode['85025']?.limit === 4 && mue.byCode['85025']?.mai === 3 && mue.byCode.J2405?.mai === 1 && Object.keys(mue.byCode).length === 2);
  let refused = false;
  try {
    parsePfsCsv('x\nHCPCS,MOD,DESCRIPTION\n99284,,A');
  } catch {
    refused = true;
  }
  check('fee schedule parser refuses an unknown layout', refused);
  const ptp = parsePtpTxt('Column 1\tColumn 2\n80053\t80048\t\t20000101\t*\t0\tx\n99284\t96374\t*\t20100101\t20200101\t1\tx\n80053\t82040\t\tbad\t*\t0\tx\n');
  check('PTP parser: dates, deletion, modifier, rejects', ptp.pairs.length === 2 && ptp.pairs[0].deleted === null && ptp.pairs[1].deleted === '2020-01-01' && ptp.pairs[1].modifier === 1 && ptp.rejects === 1);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
