// Flow 1's real prices (docs/kimi/DEMO_WALKTHROUGHS.md): "prices are the one
// thing that isn't scripted." Reads the sourced rows for one drug and runs
// the same code the chat uses (the AKS copay-card block, then the ranking
// engine) for a sample patient's situation. No model call. Server-only.

import { pickProgramPhone, type ProgramPhone } from '../programPhone';
import { supabaseAdmin } from '../supabaseAdmin';
import { rankSavingsPathsForDrug, type RankingResult } from '../ranking';
import { partitionCopayCardsForSubject, resolveChatSubject, MANAGED_UNKNOWN_COVERAGE_REASON } from '../chatSubject';
import { COPAY_CARD_BLOCK_REASON } from '../medicareEligibility';
import type { SamplePatient } from './samples';

export interface RxOptions {
  drug: string;
  found: boolean;
  ranking: RankingResult | null;
  blockedReason: string | null;
  // A phone only ever comes from a cited program page (exploits.support_phone).
  phone: ProgramPhone | null;
}

export async function loadRxOptions(drugName: string, sample: SamplePatient): Promise<RxOptions> {
  const sb = supabaseAdmin();
  const { data: drugs, error } = await sb.from('drugs').select('id, name').ilike('name', drugName);
  if (error) throw error;
  const drugIds = (drugs ?? []).map((d) => d.id as string);
  if (drugIds.length === 0) return { drug: drugName, found: false, ranking: null, blockedReason: null, phone: null };

  const [{ data: exploits }, { data: prices }] = await Promise.all([
    sb.from('exploits').select('*, sources!exploits_source_id_fkey(*)').in('drug_id', drugIds).eq('status', 'active'),
    sb.from('price_points').select('*, sources(*), pharmacies(name, lat, lng)').in('drug_id', drugIds),
  ]);

  const subject = resolveChatSubject({ userProfile: null, managedPatient: null, sample: sample.subject });
  const { viable, blocked, reason } = partitionCopayCardsForSubject(exploits ?? [], subject);
  const blockedReason =
    reason === 'government' ? COPAY_CARD_BLOCK_REASON : reason === 'managed_unknown' ? MANAGED_UNKNOWN_COVERAGE_REASON : null;

  const ranking =
    viable.length > 0 || (prices ?? []).length > 0
      ? await rankSavingsPathsForDrug({
          drugName,
          patient: {
            insuranceType: subject.insuranceType,
            stateCode: subject.state,
            incomePctFpl: subject.incomePctFpl,
            householdSize: subject.householdSize,
            drugCovered: null,
          },
          exploits: exploits ?? [],
          pricePoints: prices ?? [],
        })
      : null;
  // Make sure every blocked card is reported, even if the ranker had no
  // other row to rank.
  if (ranking) {
    for (const b of blocked) {
      if (!ranking.blocked.some((x) => x.title === b.title)) ranking.blocked.push({ title: b.title, reason: blockedReason ?? '' });
    }
  }

  const phone = pickProgramPhone(ranking, viable);
  return {
    drug: drugName,
    found: true,
    ranking: ranking ?? {
      ranked: [],
      pendingVerification: [],
      notApplicable: [],
      blocked: blocked.map((b: any) => ({ title: b.title, reason: blockedReason ?? '' })),
      stateNote: null,
      winner: null,
      bridges: [],
      excludedPrices: [],
    },
    blockedReason,
    phone,
  };
}
