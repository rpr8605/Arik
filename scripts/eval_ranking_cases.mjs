// Ranking-engine eval cases (JaneBench-style). I write the situations and
// inputs; the OWNER supplies expected outputs. A case with expected=null
// runs UNGRADED — the runner prints what the engine actually produced for
// the owner to grade. Nothing self-grades.
// Runner: npx tsx scripts/eval_ranking.ts

export const RANKING_EVAL_CASES = [
  {
    id: 'eliquis_commercial_ia',
    situation: 'Commercially insured patient in Iowa, Eliquis 5mg. Card is conflicted ($2,000 vs $6,400 annual max).',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'IA' },
    expected: null,
  },
  {
    id: 'eliquis_medicare_ia',
    situation: 'Medicare Part D patient in Iowa, Eliquis. Card must be AKS-blocked; IRA negotiated price and DTP and PAP are the legal paths.',
    input: { drugName: 'Eliquis', insuranceType: 'medicare_part_d', stateCode: 'IA' },
    expected: null,
  },
  {
    id: 'eliquis_commercial_ca',
    situation: 'Commercially insured in California (verified NO ban). If the card were presented, it must carry the deductible-cliff warning with an exhaustion estimate.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'CA' },
    expected: null,
  },
  {
    id: 'eliquis_commercial_tx',
    situation: 'Commercially insured in Texas — secondary_aggregated row: ban exists on paper but is not primary-verified. Must hedge, not assert protection.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'TX' },
    expected: null,
  },
  {
    id: 'eliquis_commercial_nv',
    situation: 'Commercially insured in Nevada — regulatory_guidance classification: surface the guidance/durability note, never a statute claim.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'NV' },
    expected: null,
  },
  {
    id: 'eliquis_uninsured_ca',
    situation: 'Uninsured patient in California. Commercial card not applicable; DTP $345 flat and income-tested PAP are the paths.',
    input: { drugName: 'Eliquis', insuranceType: 'uninsured', stateCode: 'CA' },
    expected: null,
  },
  {
    id: 'dupixent_commercial_ia',
    situation: 'Commercially insured in Iowa, Dupixent. MyWay card ($0 as-low-as, $13k annual max) verified; no cash price on file — engine must not invent one.',
    input: { drugName: 'Dupixent', insuranceType: 'employer', stateCode: 'IA' },
    expected: null,
  },
  {
    id: 'dupixent_medicare_nd',
    situation: 'Medicare Part D patient in North Dakota. Card blocked; MyWay PAP (Part D may qualify, exclusion_reason none) is the legal path.',
    input: { drugName: 'Dupixent', insuranceType: 'medicare_part_d', stateCode: 'ND' },
    expected: null,
  },
  {
    id: 'dupixent_uninsured_ia',
    situation: 'Uninsured patient in Iowa, Dupixent. PAP has a $100k income limit stated in dollars — engine must note income is needed, not assume eligibility.',
    input: { drugName: 'Dupixent', insuranceType: 'uninsured', stateCode: 'IA' },
    expected: null,
  },
  {
    id: 'zepbound_commercial_not_covered_ia',
    situation: 'Commercially insured in Iowa, plan does NOT cover Zepbound. The non-covered card is conflicted ($3,283 vs $6,097): must appear only as pending-verification, never with a trusted annual max.',
    input: { drugName: 'Zepbound', insuranceType: 'employer', stateCode: 'IA' },
    expected: null,
  },
  {
    id: 'zepbound_commercial_ca',
    situation: 'Commercially insured in California, plan covers Zepbound. Covered card conflicted ($150 vs $100 monthly max) — pending-verification only; CA unprotected note applies to any card discussion.',
    input: { drugName: 'Zepbound', insuranceType: 'employer', stateCode: 'CA' },
    expected: null,
  },
  {
    id: 'zepbound_medicare_ia',
    situation: 'Medicare patient in Iowa asking about Zepbound. Both cards are AKS-blocked AND conflicted — nothing rankable; blocked list must name the law.',
    input: { drugName: 'Zepbound', insuranceType: 'medicare_part_d', stateCode: 'IA' },
    expected: null,
  },
];
