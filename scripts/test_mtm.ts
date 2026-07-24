// Pure-logic test of MTM eligibility. Run: npx tsx scripts/test_mtm.ts
import {
  computeMtmEligibility,
  MTM_COST_THRESHOLD_USD,
  MTM_MIN_CHRONIC_CONDITIONS,
  MTM_MIN_PART_D_MEDICATIONS,
} from '../lib/mtm';

let failures = 0;
function expect(name: string, actual: boolean, wanted: boolean) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${actual}, want ${wanted})`);
}

console.log(`thresholds: $${MTM_COST_THRESHOLD_USD}, ${MTM_MIN_CHRONIC_CONDITIONS} conditions, ${MTM_MIN_PART_D_MEDICATIONS} meds`);

// Meets on conditions path: 3 conditions, cost above threshold, few meds
expect(
  '3 conditions + $2,000/yr -> likely eligible',
  computeMtmEligibility({ chronicConditionsCount: 3, partDMedicationCount: 2, estimatedAnnualDrugCostUsd: 2000 }).likelyEligible,
  true,
);
// Meets on med-count path: 8 meds, cost above threshold, 1 condition
expect(
  '8 meds + $1,300/yr -> likely eligible',
  computeMtmEligibility({ chronicConditionsCount: 1, partDMedicationCount: 8, estimatedAnnualDrugCostUsd: 1300 }).likelyEligible,
  true,
);
// Cost floor exactly at threshold counts
expect(
  'cost exactly $1,276 + 3 conditions -> likely eligible',
  computeMtmEligibility({ chronicConditionsCount: 3, partDMedicationCount: 0, estimatedAnnualDrugCostUsd: 1276 }).likelyEligible,
  true,
);
// Below cost threshold -> not matched even with both other criteria
expect(
  '3 conditions + 8 meds + $1,275/yr -> not matched',
  computeMtmEligibility({ chronicConditionsCount: 3, partDMedicationCount: 8, estimatedAnnualDrugCostUsd: 1275 }).likelyEligible,
  false,
);
// Neither conditions nor med count -> not matched
expect(
  '2 conditions + 7 meds + $5,000/yr -> not matched',
  computeMtmEligibility({ chronicConditionsCount: 2, partDMedicationCount: 7, estimatedAnnualDrugCostUsd: 5000 }).likelyEligible,
  false,
);

process.exit(failures === 0 ? 0 : 1);
