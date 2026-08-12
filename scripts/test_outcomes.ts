// Pure tests for lib/outcomes.ts shouldPromptOutcomeConfirmation — the
// outcome-confirmation prompt decision (build-plan step 9). Run:
// npx tsx scripts/test_outcomes.ts
import { shouldPromptOutcomeConfirmation } from '../lib/outcomes';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

// Terminal statuses prompt only when nothing confirmed yet
check('resolved_won + no confirmed outcome -> prompt', shouldPromptOutcomeConfirmation('resolved_won', false));
check('resolved_lost + no confirmed outcome -> prompt', shouldPromptOutcomeConfirmation('resolved_lost', false));
check('closed_by_patient + no confirmed outcome -> prompt', shouldPromptOutcomeConfirmation('closed_by_patient', false));

// A confirmed outcome silences the prompt even on terminal statuses
check('resolved_won + confirmed outcome -> no prompt', !shouldPromptOutcomeConfirmation('resolved_won', true));
check('closed_by_patient + confirmed outcome -> no prompt', !shouldPromptOutcomeConfirmation('closed_by_patient', true));

// Non-terminal statuses never prompt, confirmed or not
check('gathering_evidence -> no prompt', !shouldPromptOutcomeConfirmation('gathering_evidence', false));
check('action_ready -> no prompt', !shouldPromptOutcomeConfirmation('action_ready', false));
check('submitted -> no prompt', !shouldPromptOutcomeConfirmation('submitted', false));
check('awaiting_response -> no prompt', !shouldPromptOutcomeConfirmation('awaiting_response', false));
check('escalated -> no prompt', !shouldPromptOutcomeConfirmation('escalated', false));

console.log(failures === 0 ? '\nOUTCOME PROMPT: ALL PASS' : `\nOUTCOME PROMPT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
