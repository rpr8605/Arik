// Demo walkthroughs (docs/kimi/DEMO_WALKTHROUGHS.md): scripts, letters and
// sample documents, pure. The click-throughs (typing never calls a model,
// send makes no network call) are in the Playwright QA run.
// Run: npx tsx scripts/test_walkthroughs.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BILL_FLOW, DENIAL_DEADLINE, DENIAL_FLOW, flowScript, rxFlow } from '../lib/walkthrough/flows';
import { findingsTotal, renderTotal, validateScript, type Script, type Step } from '../lib/walkthrough/script';
import { LETTERS, LETTER_FOOTER, fillLetter } from '../lib/walkthrough/letters';
import { SAMPLE_DOCS, availableSampleDocs } from '../lib/demo/sampleDocs';
import { rankPathways } from '../lib/ranking';
import { bestOngoing } from '../app/walk/RxCards';
import type { RxOptions } from '../lib/demo/rxOptions';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const scripts: Script[] = [BILL_FLOW, DENIAL_FLOW, rxFlow('maria'), rxFlow('james', 'Eliquis'), rxFlow('dana', 'Zepbound')];
for (const s of scripts) {
  const problems = validateScript(s);
  check(`${s.id}/${s.patient}: script is well formed (jumps, boxes, findings)`, problems.length === 0, problems.join('; '));
}

// Every path through a flow reaches an end screen with the demo note.
function pathsEnd(s: Script): boolean {
  const seen = new Set<string>();
  const walk = (seq: string): boolean => {
    if (seen.has(seq)) return true;
    seen.add(seq);
    const steps = s.sequences[seq];
    const last = steps[steps.length - 1];
    if (last.kind === 'end') return true;
    const nexts = steps.flatMap((st: Step) => (st.kind === 'chips' ? st.options.map((o) => o.go) : st.kind === 'pick' || st.kind === 'summary' ? [st.go] : []));
    return nexts.length > 0 && nexts.every(walk);
  };
  return walk(s.start);
}
for (const s of scripts) check(`${s.id}/${s.patient}: every choice leads to the end screen`, pathsEnd(s));

// The bill total equals the sum of the findings, and the text says so.
const findings = BILL_FLOW.sequences.findings;
const total = findingsTotal(findings);
check('bill: findings total is the sum of the four findings ($186 + $412 + $2,950 + $1,240)', total === 186 + 412 + 2950 + 1240, String(total));
const totalStep = findings.find((s) => s.kind === 'total') as Extract<Step, { kind: 'total' }>;
check('bill: the total line shows that same sum', renderTotal(totalStep.text, findings) === "That's $4,788 in charges worth questioning.", renderTotal(totalStep.text, findings));
check('bill: every highlight box has a numbered finding (1 to 4)', [1, 2, 3, 4].every((n) => findings.some((s) => s.kind === 'finding' && s.n === n)));
check('bill: findings are plain words, no rule numbers or regulation names', findings.every((s) => s.kind !== 'finding' || !/CFR|NCCI|MUE|§|section \d/i.test(s.text)));

// The hospital bill's dollar lines add up.
const hospital = readFileSync(join(__dirname, '..', 'public', 'demo', 'docs', 'luis-hospital-bill.svg'), 'utf8');
const lineAmounts = [2480, 186, 186, 398, 412, 640, 8850, 310];
check('hospital bill: line charges add up to the $13,462 total', lineAmounts.reduce((a, b) => a + b, 0) === 13462 && hospital.includes('$13,462.00'));
check('hospital bill: the duplicate test appears twice', (hospital.match(/>85025</g) ?? []).length === 2);
check('hospital bill: 3 room days at $2,950 = $8,850', 3 * 2950 === 8850 && hospital.includes('$8,850.00'));

// Denial deadline comes from the letter: 180 days after October 6, 2026.
const d = new Date(Date.UTC(2026, 9, 6));
d.setUTCDate(d.getUTCDate() + 180);
check('denial: April 4, 2027 is 180 days after the October 6, 2026 letter', DENIAL_DEADLINE === 'April 4, 2027' && d.toISOString().slice(0, 10) === '2027-04-04', d.toISOString());
const letterSvg = readFileSync(join(__dirname, '..', 'public', 'demo', 'docs', 'tasha-denial-letter.svg'), 'utf8');
check('denial: the letter itself states the 180-day window and the date', letterSvg.includes('within 180 days of the date of this letter') && letterSvg.includes('October 6, 2026'));

// Letters: footer, fictional recipients, 555-01xx fax, no legal-advice words.
const REAL = ['Aetna', 'Cigna', 'UnitedHealth', 'Humana', 'Anthem', 'Blue Cross', 'Kaiser', 'Optum', 'CVS', 'Express Scripts', 'Walgreens', 'HCA', 'Mayo'];
for (const l of Object.values(LETTERS)) {
  const text = JSON.stringify(l);
  check(`letter ${l.id}: fax is a fictional 555-01xx number`, /\(\d{3}\) 555-01\d\d/.test(l.to.fax));
  check(`letter ${l.id}: no real company names`, !REAL.some((n) => text.includes(n)));
  check(`letter ${l.id}: no em dashes, no legal-advice wording`, !text.includes('—') && !/(attorney|lawsuit|sue you|legal advice|we will sue)/i.test(text.replace(LETTER_FOOTER, '')));
  check(`letter ${l.id}: phone field fills in`, fillLetter(l.from, '(555) 555-0100').includes('(555) 555-0100') && !fillLetter(l.from, '').includes('{phone}'));
}
check('letter footer text is exact', LETTER_FOOTER === 'Prepared by the patient with help from Arik Health, which uses AI to assist. Not legal advice.');

// Sample documents exist on disk and every one leads into a flow.
for (const doc of availableSampleDocs()) {
  let ok = false;
  try {
    ok = readFileSync(join(__dirname, '..', 'public', doc.image!), 'utf8').includes('SAMPLE');
  } catch {
    ok = false;
  }
  check(`document ${doc.id}: file exists with a SAMPLE mark`, ok);
  const flow = doc.flow!.split('?')[0].replace('/walk/', '');
  check(`document ${doc.id}: leads into a real flow (${flow})`, flowScript(flow) !== null);
}
check('all six sample documents are available', availableSampleDocs().length === SAMPLE_DOCS.length);
check('unknown flow -> null (page 404s)', flowScript('nope') === null);
check('rx flow with a preset drug skips the question', rxFlow('james', 'Eliquis').start === 'drug_Eliquis' && rxFlow('maria').start === 'intro');
check('no step in any flow has em dashes', scripts.every((s) => !JSON.stringify(s).includes('—')));

// "Best path" tag: the prescription card tags the row that is identical to
// bestOngoing(). After the API's JSON round-trip the engine's winner is a
// separate object, so bestOngoing must hand back the row inside ranked.
const src = { title: 'S', url: null, last_verified_at: null };
const rk = rankPathways({
  exploits: [
    { exploit_type: 'free_trial', title: 'Trial', status: 'active', verification_status: 'verified_current', patient_price_type: 'flat', patient_price_floor: 0, eligibility_criteria: { one_time: true }, sources: src },
    { exploit_type: 'direct_to_patient_program', title: 'DTP', status: 'active', verification_status: 'verified_current', patient_price_type: 'flat', patient_price_floor: 345, eligibility_criteria: { insurance_required: false }, sources: src },
  ],
  pricePoints: [],
  stateRow: null,
  banApplies: false,
  patient: { insuranceType: 'uninsured', stateCode: 'TX' },
});
const wire = JSON.parse(JSON.stringify({ drug: 'X', found: true, ranking: rk, blockedReason: null, phone: null })) as RxOptions;
const best = bestOngoing(wire);
check('rx card: "Best path" row is the DTP and is the same object as in ranked (survives JSON)', best?.title === 'DTP' && wire.ranking!.ranked.includes(best!));
check('rx card: the trial is a bridge, never the best path', !wire.ranking!.ranked.some((p) => p.title === 'Trial') && wire.ranking!.bridges[0]?.title === 'Trial');

console.log(failures === 0 ? '\nWALKTHROUGHS: ALL PASS' : `\nWALKTHROUGHS: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
