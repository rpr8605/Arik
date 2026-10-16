// Destination ranking, neutral by design (M24 step 9). Ranking reads only
// price, source, freshness and the patient's constraints. Partner
// identity and affiliation are dropped BEFORE ordering, so toggling them
// can't change the result (test_routing.ts proves it).

import { milesBetween } from '../ranking';
import type { RoutingDestination, RoutingQuote } from './provider';

export interface DestinationOption {
  destination: RoutingDestination;
  quote: RoutingQuote | null;
  sourceLabel: string;            // where the price came from (shown to the patient)
  // Partner facts. Present on the input, never read by the ranking.
  partnerLabel?: string | null;
  affiliated?: boolean;
}

export interface RankedDestination {
  destinationId: string;
  pharmacyName: string;
  npi: string;
  mailOrder: boolean;
  priceUsd: number | null;
  observedAt: string | null;
  sourceLabel: string;
  distanceMiles: number | null;
}

export function rankDestinations(
  options: DestinationOption[],
  patient: { location: { lat: number; lng: number } | null; mailOrderOk: boolean; asOf: string; maxAgeDays?: number },
): RankedDestination[] {
  const maxAge = (patient.maxAgeDays ?? 7) * 86_400_000;
  const now = Date.parse(patient.asOf);
  const neutral: RankedDestination[] = options
    .filter((o) => patient.mailOrderOk || !o.destination.mailOrder)
    .map((o) => {
      const fresh =
        o.quote &&
        now - Date.parse(`${o.quote.observedAt}T00:00:00Z`) <= maxAge &&
        (!o.quote.expiresAt || Date.parse(`${o.quote.expiresAt}T23:59:59Z`) >= now);
      const d = o.destination;
      const known = patient.location && d.lat != null && d.lng != null;
      return {
        destinationId: d.destinationId,
        pharmacyName: d.pharmacyName,
        npi: d.npi,
        mailOrder: d.mailOrder,
        priceUsd: fresh ? o.quote!.priceUsd : null,
        observedAt: fresh ? o.quote!.observedAt : null,
        sourceLabel: o.sourceLabel,
        distanceMiles: known ? Math.round(milesBetween(patient.location!, { lat: d.lat!, lng: d.lng! }) * 10) / 10 : null,
      };
    });
  return neutral.sort(
    (a, b) =>
      (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity) ||
      (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
      a.npi.localeCompare(b.npi),
  );
}
