// lib/ranking.ts
// What this is for: the savings-path ranking engine. Given a drug's
// already-retrieved exploit/price rows and the patient's coverage/state,
// produce a ranked list of pathways with 3-12 MONTH TRAJECTORY costs —
// not point-in-time prices. Deterministic code; no LLM call anywhere in
// this module.
// Called by: app/api/chat/route.ts (between retrieval and response).
// Calls: lib/medicareEligibility.ts (the AKS hard-block — integrated, not
// duplicated) and supabaseAdmin (DB loader only; rankPathways itself is pure).
//
// Standing rules encoded here (do not regress):
// - WINNER = lowest projected 3-12 month cost. Never "cheapest today."
// - Only verification_status='verified_current' rows rank confidently.
//   conflicted/unresolved/historical rows go to pendingVerification and
//   never carry a guessed number into a ranked answer.
// - state_has_accumulator_ban() has NO confidence awareness: a ban is
//   asserted only when verification_status='primary_source_verified'
//   (owner rule). Everything else hedges — soften, never suppress.
// - "as low as $X" (patient_price_type) is never collapsed into "$X".

import { supabaseAdmin } from './supabaseAdmin';
import { partitionCopayCardsForInsurance, COPAY_CARD_BLOCK_REASON } from './medicareEligibility';
import { partitionPricesForConsent, type PriceSourceConsent } from './pricing/enforcement';

export interface RankingPatient {
  insuranceType: string | null;
  stateCode: string | null;
  incomePctFpl?: number | null;
  householdSize?: number | null;
  drugCovered?: boolean | null;   // does the patient's plan cover this drug at all (drives branch cards)
}

export interface RankedPathway {
  kind: string;                     // exploit_type or 'price_point'
  title: string;
  monthlyCostUsd: number | null;    // floor semantics when priceSemantics='as_low_as'
  priceSemantics: 'flat' | 'as_low_as' | 'range' | null;
  projectedAnnualCostUsd: number | null;
  oneTime: boolean;
  trajectoryNotes: string[];
  verificationStatus: string;
  source: { title: string | null; url: string | null; last_verified_at: string | null } | null;
}

export interface RankingResult {
  ranked: RankedPathway[];
  // Data that might become viable once verified/resolved/reopened.
  pendingVerification: { title: string; reason: string }[];
  // Verified data that simply doesn't fit THIS patient (e.g. a
  // commercial-only card for an uninsured patient). Never conflate the
  // two buckets: pendingVerification is about OUR evidence, notApplicable
  // is about THEIR situation.
  notApplicable: { title: string; reason: string }[];
  blocked: { title: string; reason: string }[];
  stateNote: { status: string; headline: string; detail: string | null } | null;
  winner: RankedPathway | null;
  // db/022 enforcement: fresh-source prices withheld because they were
  // expired, disabled, or past the source's max_staleness_hours. The
  // response says which - an exclusion is an answer, not an omission.
  excludedPrices: { label: string; reason: string }[];
}

// Shallow eligibility matcher — DELIBERATELY minimal until the fold's full
// criteria vocabulary lands. Anything it can't evaluate becomes a note,
// never an assumption.
function eligibilityNotes(e: any, p: RankingPatient): { viable: boolean; notes: string[] } {
  const notes: string[] = [];
  const crit = e.eligibility_criteria ?? {};
  const t = p.insuranceType;
  const commercial = t === 'employer' || t === 'marketplace';
  const government = t === 'medicare_part_d' || t === 'medicaid' || t === 'medicare' || t === 'medicare_advantage';
  if (crit.requires === 'commercial_insurance' && !commercial) {
    return { viable: false, notes: [`Requires commercial insurance (your coverage: ${t ?? 'unknown'}).`] };
  }
  if (crit.drug_covered === true && p.drugCovered === false) {
    return { viable: false, notes: ["Requires your plan to cover the drug, and yours doesn't."] };
  }
  if (crit.drug_covered === false && p.drugCovered === true) {
    return { viable: false, notes: ["This pathway is for plans that don't cover the drug, and yours does."] };
  }
  if (crit.requires === 'cash_pay' || crit.insurance_required === false) {
    notes.push('No insurance required: this is a cash channel.');
  }
  if (crit.income_max_usd != null) {
    if (p.incomePctFpl == null) {
      notes.push(`Income-tested (limit $${crit.income_max_usd.toLocaleString()}/yr): your income is needed to say more. This is a "likely" path, not a confirmed one.`);
    } else {
      notes.push(`Income-tested (limit $${crit.income_max_usd.toLocaleString()}/yr): confirm against your exact dollar income. The program states the limit in dollars, not %FPL.`);
    }
  }
  if (crit.medicare_part_d_may_qualify === true && t === 'medicare_part_d') {
    notes.push('The program states Medicare Part D patients may qualify.');
  }
  if (government && crit.excludes_government_programs === true) {
    return { viable: false, notes: ['Program terms exclude government coverage.'] };
  }
  return { viable: true, notes };
}

function stateNoteFor(
  stateRow: any | null,
  banApplies: boolean,
  insuranceType: string | null,
): RankingResult['stateNote'] {
  const employer = insuranceType === 'employer';
  const erisa = employer
    ? ' Note: if your employer plan is self-funded, state bans do not reach it (federal ERISA exemption).'
    : '';
  if (!stateRow) {
    return {
      status: 'unverified',
      headline: "Your state's copay-accumulator protection status is still being verified. If your plan runs an accumulator program, manufacturer assistance may not count toward your deductible.",
      detail: null,
    };
  }
  if (stateRow.ban_type === 'regulatory_guidance') {
    return {
      status: 'regulatory_guidance',
      headline: 'Your state addresses this through regulatory guidance, not a statute: real enforcement for current marketplace plan years, but less durable than a law.',
      detail: stateRow.notes ?? null,
    };
  }
  if (stateRow.verification_status !== 'primary_source_verified') {
    return {
      status: 'unverified',
      headline: "Your state's copay-accumulator protection status is still being verified. If your plan runs an accumulator program, manufacturer assistance may not count toward your deductible.",
      detail: stateRow.notes ?? null,
    };
  }
  if (banApplies) {
    return {
      status: 'verified_protected',
      headline: 'Your state law requires this assistance to count toward your deductible for state-regulated plans.' + erisa,
      detail: stateRow.notes ?? null,
    };
  }
  return {
    status: 'verified_unprotected',
    headline: 'Your state has no accumulator protection. If your plan runs an accumulator, manufacturer assistance may not count toward your deductible, and your cost can jump when the card maxes out.' + erisa,
    detail: stateRow.notes ?? null,
  };
}

export function rankPathways(input: {
  exploits: any[];
  pricePoints: any[];
  stateRow: any | null;
  banApplies: boolean;
  patient: RankingPatient;
  conflictsByExploitId?: Record<string, any[]>;
  // db/022: source consent rules for ingested price rows. Absent for
  // legacy callers (all-legacy data) - enforcement kicks in only for
  // rows carrying a price_source_id.
  priceSources?: Record<string, PriceSourceConsent>;
  asOf?: string; // clock injection for deterministic tests
}): RankingResult {
  const { exploits, pricePoints, stateRow, banApplies, patient } = input;
  const conflictsByExploitId = input.conflictsByExploitId ?? {};

  // AKS hard-block first — integrated, not reimplemented.
  const { viable, blocked: aksBlocked } = partitionCopayCardsForInsurance(exploits, patient.insuranceType);
  const blocked = aksBlocked.map((e: any) => ({ title: e.title, reason: COPAY_CARD_BLOCK_REASON }));

  const stateNote = stateNoteFor(stateRow, banApplies, patient.insuranceType);
  const isCard = (e: any) => e.exploit_type === 'copay_card' || e.eligibility_criteria?.excludes_government_programs === true;

  const pendingVerification: RankingResult['pendingVerification'] = [];
  const notApplicable: RankingResult['notApplicable'] = [];
  const ranked: RankedPathway[] = [];

  for (const e of viable) {
    if (e.status === 'closed') {
      pendingVerification.push({ title: e.title, reason: `Currently closed/unavailable${e.closed_reason ? ` (${e.closed_reason})` : ''}.` });
      continue;
    }
    // Order matters: fit BEFORE evidence. A row that doesn't fit this
    // patient is notApplicable regardless of its verification state —
    // its conflicts are irrelevant to someone it can't serve.
    const elig = eligibilityNotes(e, patient);
    if (!elig.viable) {
      notApplicable.push({ title: e.title, reason: elig.notes[0] ?? 'Not applicable to your coverage.' });
      continue;
    }

    // Conflicted rows split by conflict class (owner grading rule
    // 2026-08-12): when every open conflict is a tier_mismatch (official
    // vs third-party), the official figure stays provisionally trusted
    // and the row RANKS with the conflict noted. Any same_official_source
    // or unclassified open conflict means no trusted value — the row goes
    // to pendingVerification and never carries a number.
    let provisionalConflictNotes: string[] = [];
    if (e.verification_status === 'conflicted') {
      const open = (conflictsByExploitId[e.id] ?? []).filter((c: any) => !c.resolved_at);
      if (open.length === 0 || open.some((c: any) => c.conflict_class !== 'tier_mismatch')) {
        pendingVerification.push({ title: e.title, reason: 'Program figures conflict between sources, pending human verification, no number is trusted yet.' });
        continue;
      }
      provisionalConflictNotes = open.map((c: any) =>
        `Official figure ($${c.value_a}) provisionally trusted; a third-party source disagrees ($${c.value_b}). Conflict noted, not treated as final.`,
      );
    } else if (e.verification_status !== 'verified_current') {
      const reason =
        e.verification_status === 'verified_historical'
          ? 'Evidence suggests these terms have changed, pending re-verification.'
          : 'Not yet verified against the program\'s current terms.';
      pendingVerification.push({ title: e.title, reason });
      continue;
    }
    const notes = [...elig.notes, ...provisionalConflictNotes];
    const monthly = e.patient_price_floor != null ? Number(e.patient_price_floor) : null;
    const oneTime = e.eligibility_criteria?.one_time === true;
    if (e.annual_max_savings != null) {
      notes.push(`Manufacturer benefit capped at $${Number(e.annual_max_savings).toLocaleString()}/year.`);
      // Deductible-reset estimate when the state doesn't protect the patient
      // and we know a fallback monthly price: how far the annual cap lasts.
      const fallback = bestMonthlyPrice(pricePoints);
      if (isCard(e) && stateNote?.status === 'verified_unprotected' && fallback != null && monthly != null && fallback > monthly) {
        const months = Math.max(1, Math.round(Number(e.annual_max_savings) / (fallback - monthly)));
        notes.push(`If your plan runs an accumulator: the card's $${Number(e.annual_max_savings).toLocaleString()} annual cap could exhaust around month ${months} at this drug's known prices. After that your full deductible applies at once (estimate, using $${fallback}/mo as the fallback price).`);
      }
    }
    if (e.reduced_if_maximizer_detected === true) {
      notes.push('Program terms reduce the maximum if your plan runs a maximizer program.');
    }
    if (isCard(e) && stateNote) notes.push(stateNote.headline);
    if (oneTime) notes.push('One-time offer: a bridge, not a long-term answer; pair it with a monthly pathway.');
    ranked.push({
      kind: e.exploit_type,
      title: e.title,
      monthlyCostUsd: monthly,
      priceSemantics: e.patient_price_type ?? null,
      projectedAnnualCostUsd: monthly != null ? (oneTime ? monthly : monthly * 12) : null,
      oneTime,
      trajectoryNotes: notes,
      verificationStatus: e.verification_status,
      source: e.sources ? { title: e.sources.title ?? null, url: e.sources.url ?? null, last_verified_at: e.sources.last_verified_at ?? null } : null,
    });
  }

  // Cash/price pathways from price_points (normalized to 30-day).
  // Two applicability rules (surfaced by the eval set, 2026-08-12):
  // - Medicare-only price types (ira_negotiated, medicare_part_d) are not
  //   pathways for non-Part-D patients — silently ranking them for a
  //   commercial patient would quote a price they can't get.
  // - A direct_to_patient price_point duplicates a direct_to_patient_program
  //   exploit row when both exist — keep the exploit (richer content).
  const hasDtpExploit = ranked.some((p) => p.kind === 'direct_to_patient_program');
  const patientHasPartD = patient.insuranceType === 'medicare_part_d';
  const applicablePrices = (pricePoints ?? []).filter((pp: any) => {
    if ((pp.price_type === 'ira_negotiated' || pp.price_type === 'medicare_part_d') && !patientHasPartD) return false;
    if (pp.price_type === 'direct_to_patient' && hasDtpExploit) return false;
    return true;
  });
  // db/022 enforcement: staleness + source consent BEFORE pathway
  // construction. Only the allowed set ranks; exclusions are reported.
  const priceConsent = partitionPricesForConsent(applicablePrices, {
    sourcesById: input.priceSources ?? {},
    now: input.asOf,
  });
  // Labels name the kind of price, never identifiers (ndc/id) - the
  // exclusion note must not reconstruct the withheld row.
  const excludedPrices = priceConsent.excludedStale.map((x) => ({
    label: `${x.row.price_type ?? 'price'}`,
    reason: x.reason,
  }));
  const pricePathways = pricePointsToPathways(priceConsent.allowed);
  ranked.push(...pricePathways);

  ranked.sort((a, b) => (a.projectedAnnualCostUsd ?? Infinity) - (b.projectedAnnualCostUsd ?? Infinity));
  // WINNER: lowest projected 3-12 month cost among confident, non-one-time
  // pathways. A one-time $0 trial is never the "winner" - it's a bridge.
  const winner = ranked.find((p) => !p.oneTime && p.projectedAnnualCostUsd != null) ?? null;
  return { ranked, pendingVerification, notApplicable, blocked, stateNote, winner, excludedPrices };
}

function bestMonthlyPrice(pricePoints: any[]): number | null {
  const monthly = pricePointsToPathways(pricePoints).map((p) => p.monthlyCostUsd).filter((n): n is number => n != null);
  return monthly.length ? Math.min(...monthly) : null;
}

function pricePointsToPathways(pricePoints: any[]): RankedPathway[] {
  const byType = new Map<string, any[]>();
  for (const pp of pricePoints ?? []) {
    const k = pp.price_type;
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k)!.push(pp);
  }
  const out: RankedPathway[] = [];
  for (const [type, rows] of byType) {
    // acquisition_benchmark rows (e.g. NADAC) are market benchmarks,
    // never patient-payable prices - they must not rank as pathways
    // regardless of source consent flags.
    if (type === 'acquisition_benchmark') continue;
    // cheapest normalized 30-day price within each type represents it
    const normalized = rows
      .map((r) => ({ r, monthly: r.supply_days ? (Number(r.price_usd) * 30) / r.supply_days : Number(r.price_usd) }))
      .filter((x) => Number.isFinite(x.monthly));
    if (normalized.length === 0) continue;
    normalized.sort((a, b) => a.monthly - b.monthly);
    const best = normalized[0];
    const tiers = rows.length > 1 ? ` Tiers: ${rows.map((r) => `$${Number(r.price_usd).toLocaleString()}/${r.supply_days ?? '?'}day`).join(', ')}.` : '';
    out.push({
      kind: 'price_point',
      title: `${type.replaceAll('_', ' ')} price`,
      monthlyCostUsd: Math.round(best.monthly * 100) / 100,
      priceSemantics: 'flat',
      projectedAnnualCostUsd: Math.round(best.monthly * 12 * 100) / 100,
      oneTime: false,
      trajectoryNotes: [`${type} channel, normalized to a 30-day price.${tiers}`],
      verificationStatus: 'verified_current',
      source: best.r.sources ? { title: best.r.sources.title ?? null, url: best.r.sources.url ?? null, last_verified_at: best.r.sources.last_verified_at ?? null } : null,
    });
  }
  return out;
}

// DB loader: fetches rows, then delegates to the pure function.
export async function rankSavingsPathsForDrug(input: {
  drugName: string;
  patient: RankingPatient;
  exploits: any[];
  pricePoints: any[];
}): Promise<RankingResult> {
  let stateRow: any | null = null;
  let banApplies = false;
  const exploitIds = input.exploits.map((e: any) => e.id);
  const conflictsByExploitId: Record<string, any[]> = {};

  // db/022: consent/staleness rules for any source-tagged price rows.
  // Legacy rows (null price_source_id) need no lookup and are unaffected.
  const priceSources: Record<string, PriceSourceConsent> = {};
  const sourceIds = [
    ...new Set(
      (input.pricePoints ?? [])
        .map((p: any) => p.price_source_id)
        .filter((id: any): id is string => typeof id === 'string'),
    ),
  ];
  if (sourceIds.length > 0) {
    const { data: sources } = await supabaseAdmin()
      .from('price_sources')
      .select('id, name, enabled, max_staleness_hours, allow_patient_display, allow_ai_processing')
      .in('id', sourceIds);
    for (const s of sources ?? []) priceSources[s.id] = s as PriceSourceConsent;
  }

  if (exploitIds.length > 0) {
    const { data: conflicts } = await supabaseAdmin()
      .from('evidence_conflicts')
      .select('*')
      .in('exploit_id', exploitIds);
    for (const c of conflicts ?? []) (conflictsByExploitId[c.exploit_id] ??= []).push(c);
  }
  if (input.patient.stateCode) {
    const { data } = await supabaseAdmin()
      .from('state_accumulator_ban_laws')
      .select('*')
      .eq('state_code', input.patient.stateCode)
      .maybeSingle();
    stateRow = data ?? null;
    if (stateRow) {
      const { data: ban } = await supabaseAdmin().rpc('state_has_accumulator_ban', {
        p_state_code: input.patient.stateCode,
        p_drug_has_generic: false, // all three demo drugs are brand-only today; pass real flag when biosimilars land
        p_drug_has_biosimilar: null,
      });
      banApplies = ban === true;
    }
  }
  return rankPathways({
    exploits: input.exploits,
    pricePoints: input.pricePoints,
    stateRow,
    banApplies,
    patient: input.patient,
    conflictsByExploitId,
    priceSources,
    asOf: new Date().toISOString(),
  });
}
