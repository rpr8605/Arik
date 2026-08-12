// Pure tests for lib/medicareEligibility.ts — the AKS copay-card hard
// block. Run: npx tsx scripts/test_medicare.ts
import {
  isGovernmentInsurance,
  isManufacturerCopayPath,
  partitionCopayCardsForInsurance,
  COPAY_CARD_BLOCK_REASON,
} from '../lib/medicareEligibility';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

const card = { exploit_type: 'copay_card', eligibility_criteria: { excludes_government_programs: true }, title: 'Card A' };
const cardNoFlag = { exploit_type: 'copay_card', eligibility_criteria: null, title: 'Card B' };
const pap = { exploit_type: 'pap', eligibility_criteria: { medicare_allowed: true }, title: 'PAP' };
const cap = { exploit_type: 'statutory_cap', eligibility_criteria: { requires: 'medicare_part_d' }, title: 'Cap' };
const flaggedNonCard = { exploit_type: 'discount_network', eligibility_criteria: { excludes_government_programs: true }, title: 'Flagged' };

// Government insurance detection
check('medicare_part_d is government insurance', isGovernmentInsurance('medicare_part_d'));
check('medicaid is government insurance', isGovernmentInsurance('medicaid'));
check('medicare_advantage is government insurance', isGovernmentInsurance('medicare_advantage'));
check('employer is not government insurance', !isGovernmentInsurance('employer'));
check('marketplace is not government insurance', !isGovernmentInsurance('marketplace'));
check('uninsured is not government insurance', !isGovernmentInsurance('uninsured'));
check('null/unknown blocks nothing', !isGovernmentInsurance(null) && !isGovernmentInsurance(undefined));

// Card detection: by type even without the jsonb flag, and by flag even on non-card types
check('copay_card type is a manufacturer copay path', isManufacturerCopayPath(card));
check('copay_card without jsonb flag still blocked', isManufacturerCopayPath(cardNoFlag));
check('excludes_government_programs flag alone marks the path', isManufacturerCopayPath(flaggedNonCard));
check('pap is not a copay path', !isManufacturerCopayPath(pap));

// The hard rule itself: Medicare/Medicaid patients never see a card as viable
const mcr = partitionCopayCardsForInsurance([card, cardNoFlag, pap, cap, flaggedNonCard], 'medicare_part_d');
check('medicare: all cards + flagged rows blocked', mcr.blocked.length === 3);
check('medicare: PAP and statutory cap stay viable', mcr.viable.length === 2 && mcr.viable.includes(pap) && mcr.viable.includes(cap));

const mcd = partitionCopayCardsForInsurance([card, pap], 'medicaid');
check('medicaid: card blocked, pap viable', mcd.blocked.length === 1 && mcd.viable.length === 1);

const emp = partitionCopayCardsForInsurance([card, pap], 'employer');
check('commercial: nothing blocked', emp.blocked.length === 0 && emp.viable.length === 2);

const unknown = partitionCopayCardsForInsurance([card, pap], null);
check('unknown coverage: nothing blocked (block fires only on KNOWN government coverage)', unknown.blocked.length === 0);

check('block reason names the law', /Anti-Kickback Statute/.test(COPAY_CARD_BLOCK_REASON) && /Medicare/.test(COPAY_CARD_BLOCK_REASON));

console.log(failures === 0 ? '\nMEDICARE HARD-BLOCK: ALL PASS' : `\nMEDICARE HARD-BLOCK: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
