// Pure-logic test of the case status workflow guard. Run: npx tsx scripts/test_transitions.ts
import { assertLegalTransition, type CaseStatus } from '../lib/cases';

let failures = 0;

function expectThrow(from: CaseStatus, to: CaseStatus) {
  try {
    assertLegalTransition(from, to);
    console.error(`FAIL  ${from} -> ${to}: did not throw`);
    failures++;
  } catch (e) {
    if ((e as Error).name === 'IllegalTransitionError') {
      console.log(`PASS  ${from} -> ${to}: throws IllegalTransitionError (API maps this to 409)`);
    } else {
      console.error(`FAIL  ${from} -> ${to}: threw unexpected ${e}`);
      failures++;
    }
  }
}

function expectOk(from: CaseStatus, to: CaseStatus) {
  try {
    assertLegalTransition(from, to);
    console.log(`PASS  ${from} -> ${to}: allowed`);
  } catch {
    console.error(`FAIL  ${from} -> ${to}: should be allowed`);
    failures++;
  }
}

expectOk('gathering_evidence', 'action_ready');
expectOk('action_ready', 'submitted');
expectOk('submitted', 'awaiting_response');
expectOk('awaiting_response', 'resolved_won');
expectOk('awaiting_response', 'resolved_lost');
expectOk('awaiting_response', 'escalated');
expectOk('escalated', 'awaiting_response');
expectThrow('gathering_evidence', 'resolved_won');
expectThrow('gathering_evidence', 'submitted');
expectThrow('submitted', 'action_ready');
expectThrow('resolved_won', 'submitted');
expectThrow('resolved_lost', 'gathering_evidence');
expectThrow('closed_by_patient', 'gathering_evidence');

process.exit(failures === 0 ? 0 : 1);
