// Ranking-engine eval cases (JaneBench-style). Situations/inputs written by
// the agent; expected outputs supplied by the OWNER (2026-08-12 grading,
// "Finish-The-Demo" ticket). Nothing self-grades.
// Runner: npx tsx scripts/eval_ranking.ts

export const RANKING_EVAL_CASES = [
  {
    id: 'eliquis_commercial_ia',
    situation: 'Commercially insured patient in Iowa, Eliquis 5mg. Card is tier-mismatch conflicted ($2,000 official vs $6,400 third-party): ranks with provisional official value.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'IA' },
    expected: {
      winnerTitle: 'Eliquis Co-pay Card (BMS/Pfizer) - $10 per fill',
      rankedIncludes: ['Eliquis Co-pay Card'],
      stateNoteStatus: 'verified_protected',
    },
  },
  {
    id: 'eliquis_medicare_ia',
    situation: 'Medicare Part D patient in Iowa, Eliquis. Card must be AKS-blocked; IRA negotiated price and DTP and PAP are the legal paths.',
    input: { drugName: 'Eliquis', insuranceType: 'medicare_part_d', stateCode: 'IA' },
    expected: {
      winnerTitle: 'ira negotiated price',
      blockedIncludes: ['Eliquis Co-pay Card'],
      stateNoteStatus: 'verified_protected',
    },
  },
  {
    id: 'eliquis_commercial_ca',
    situation: 'Commercially insured in California (verified NO ban). Card wins WITH the deductible-cliff warning attached — a warning, not a block.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'CA' },
    expected: {
      winnerTitle: 'Eliquis Co-pay Card (BMS/Pfizer) - $10 per fill',
      rankedIncludes: ['Eliquis Co-pay Card'],
      stateNoteStatus: 'verified_unprotected',
    },
  },
  {
    id: 'eliquis_commercial_tx',
    situation: 'Commercially insured in Texas — secondary_aggregated row: card wins WITH the honest state-status hedge, never asserted protection.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'TX' },
    expected: {
      winnerTitle: 'Eliquis Co-pay Card (BMS/Pfizer) - $10 per fill',
      stateNoteStatus: 'unverified',
    },
  },
  {
    id: 'eliquis_commercial_nv',
    situation: 'Commercially insured in Nevada — regulatory_guidance: card wins WITH the durability caveat, never a statute claim.',
    input: { drugName: 'Eliquis', insuranceType: 'employer', stateCode: 'NV' },
    expected: {
      winnerTitle: 'Eliquis Co-pay Card (BMS/Pfizer) - $10 per fill',
      stateNoteStatus: 'regulatory_guidance',
    },
  },
  {
    id: 'eliquis_uninsured_ca',
    situation: 'Uninsured patient in California. Commercial card is notApplicable (wrong fit, not conflicted); cheapest DTP tier wins.',
    input: { drugName: 'Eliquis', insuranceType: 'uninsured', stateCode: 'CA' },
    expected: {
      winnerTitle: 'Eliquis Direct-to-Patient Program (Eliquis 360 Support)',
      rankedExcludes: ['Eliquis Co-pay Card'],
      notApplicableIncludes: ['Eliquis Co-pay Card'],
      stateNoteStatus: 'verified_unprotected',
    },
  },
  {
    id: 'dupixent_commercial_ia',
    situation: 'Commercially insured in Iowa, Dupixent. MyWay card (verified: as low as $0/fill, $13,000/yr max) wins; no cash price on file — engine must not invent one.',
    input: { drugName: 'Dupixent', insuranceType: 'employer', stateCode: 'IA' },
    expected: {
      winnerTitle: 'Dupixent MyWay Copay Card',
      rankedIncludes: ['Dupixent MyWay Copay Card'],
      stateNoteStatus: 'verified_protected',
    },
  },
  {
    id: 'dupixent_medicare_nd',
    situation: 'Medicare Part D patient in North Dakota. Card blocked; MyWay PAP (Part D may qualify, exclusion_reason none) is the legal path.',
    input: { drugName: 'Dupixent', insuranceType: 'medicare_part_d', stateCode: 'ND' },
    expected: {
      winnerTitle: 'Dupixent MyWay Patient Assistance Program',
      blockedIncludes: ['Dupixent MyWay Copay Card'],
      stateNoteStatus: 'verified_protected',
    },
  },
  {
    id: 'dupixent_uninsured_ia',
    situation: 'Uninsured patient in Iowa, Dupixent. PAP wins with the income-needed note ($100k limit is in dollars, not %FPL); card is notApplicable.',
    input: { drugName: 'Dupixent', insuranceType: 'uninsured', stateCode: 'IA' },
    expected: {
      winnerTitle: 'Dupixent MyWay Patient Assistance Program',
      notApplicableIncludes: ['Dupixent MyWay Copay Card'],
      stateNoteStatus: 'verified_protected',
    },
  },
  {
    id: 'zepbound_commercial_not_covered_ia',
    situation: 'Commercially insured in Iowa, plan does NOT cover Zepbound. The applicable branch (not-covered) is same-source conflicted: NO confident winner, pendingVerification only, both figures shown, null trusted value. Correct behavior, not a bug.',
    input: { drugName: 'Zepbound', insuranceType: 'employer', stateCode: 'IA', drugCovered: false },
    expected: {
      winnerTitle: null,
      rankedExcludes: ['Zepbound Savings Card'],
      pendingIncludes: ['drug not covered'],
      notApplicableIncludes: ['drug covered'],
      stateNoteStatus: 'verified_protected',
    },
  },
  {
    id: 'zepbound_commercial_ca',
    situation: 'Commercially insured in California, plan covers Zepbound. Covered-branch card wins at the provisionally-trusted official $150 monthly max (tier-mismatch conflict vs $100 third-party is noted, not a blocker). CA cliff caveat applies.',
    input: { drugName: 'Zepbound', insuranceType: 'employer', stateCode: 'CA', drugCovered: true },
    expected: {
      winnerTitle: 'Zepbound Savings Card (commercial, drug covered)',
      rankedIncludes: ['drug covered'],
      notApplicableIncludes: ['drug not covered'],
      stateNoteStatus: 'verified_unprotected',
    },
  },
  {
    id: 'zepbound_medicare_ia',
    situation: 'Medicare patient in Iowa asking about Zepbound. Both cards are AKS-blocked regardless of branch; no Zepbound PAP row exists, so there is no winner — the honest empty result.',
    input: { drugName: 'Zepbound', insuranceType: 'medicare_part_d', stateCode: 'IA' },
    expected: {
      winnerTitle: null,
      rankedExcludes: ['Zepbound Savings Card'],
      blockedIncludes: ['drug not covered', 'drug covered'],
      stateNoteStatus: 'verified_protected',
    },
  },
];
