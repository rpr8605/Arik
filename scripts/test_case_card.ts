// Plain-words case cards (lib/caseCard.ts, owner request 2026-10-15): no
// internal status name, case type, field name or jargon ever reaches the
// screen, for every status x type combination.
// Run: npx tsx scripts/test_case_card.ts

import { CASE_STATUSES, CASE_TYPES } from '../lib/cases';
import { FIELD_LABELS, caseCardText, fieldLabel } from '../lib/caseCard';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const RAW = [...CASE_STATUSES, ...CASE_TYPES, ...Object.keys(FIELD_LABELS)];
// Status names with spaces ("gathering evidence") must not appear either.
// Case types are not checked this way: "Prescription savings" IS the plain label.
const RAW_SPACED = CASE_STATUSES.map((r) => r.replaceAll('_', ' '));
const JARGON = ['case thread', 'evidence', 'status', 'pathway', 'exploit', 'session', 'escalat', 'resolved', 'pending', 'chat_', 'null', 'undefined'];

const outputs: string[] = [];
for (const status of CASE_STATUSES) {
  for (const caseType of CASE_TYPES) {
    for (const drugName of [null, 'Eliquis', 'amlodipine']) {
      for (const hasReply of [false, true]) {
        for (const pendingFields of [[], ['insurance_plan_name'], ['some_new_field']]) {
          const c = caseCardText({ caseType, status, drugName, hasReply, pendingFields });
          outputs.push(`${c.title} | ${c.happening} | ${c.tap}`);
        }
      }
    }
  }
}
const leaks = outputs.filter((o) => RAW.some((r) => o.includes(r)) || RAW_SPACED.some((r) => o.toLowerCase().includes(r)) || o.includes('_'));
check(`no raw status, type or field name in ${outputs.length} card variants`, leaks.length === 0, leaks.slice(0, 2).join(' || '));
const jargon = outputs.filter((o) => JARGON.some((j) => o.toLowerCase().includes(j)));
check('no internal jargon in any card', jargon.length === 0, jargon.slice(0, 2).join(' || '));
check('no em dashes in any card', outputs.every((o) => !o.includes('—')));
check('every card has a title, a "what is happening" line and a "what to tap" line',
  outputs.every((o) => o.split(' | ').every((part) => part.trim().length > 0)));

// The owner's examples.
const eliquis = caseCardText({ caseType: 'prescription_savings', status: 'gathering_evidence', drugName: 'Eliquis', hasReply: true, pendingFields: [] });
check('"Eliquis savings · Arik is still checking prices. Tap to pick up where you left off."',
  eliquis.title === 'Eliquis savings' && eliquis.happening === 'Arik is still checking prices.' && eliquis.tap === 'Tap to pick up where you left off.');
const needs = caseCardText({ caseType: 'prescription_savings', status: 'gathering_evidence', drugName: 'Eliquis', hasReply: true, pendingFields: ['insurance_type'] });
check('pending correction -> "Needs you" + "confirm your insurance type to continue"',
  needs.needsYou && needs.title === 'Needs you' && needs.happening.includes('confirm your insurance type to continue'));
check('drug name in title case', caseCardText({ caseType: 'prescription_savings', status: 'action_ready', drugName: 'amlodipine', hasReply: true, pendingFields: [] }).title === 'Amlodipine savings');
check('no reply yet -> says so honestly', caseCardText({ caseType: 'bill_dispute', status: 'gathering_evidence', drugName: null, hasReply: false, pendingFields: [] }).happening === "Arik hasn't answered yet.");
check('unknown status or type falls back to plain words, never the raw value',
  !JSON.stringify(caseCardText({ caseType: 'weird_type', status: 'weird_status', drugName: null, hasReply: true, pendingFields: [] })).includes('weird'));
check('unknown field -> "a detail"', fieldLabel('mystery_column') === 'a detail');

console.log(failures === 0 ? '\nCASE CARD: ALL PASS' : `\nCASE CARD: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
