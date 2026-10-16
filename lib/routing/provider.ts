// Prescription routing (M24 Part B, docs/kimi/rx_routing_build.md): the
// neutral interface every routing partner implements. Mock only in this
// repo; a real partner's adapter lives in the private adapters repo and
// must pass the same contract suite (lib/routing/contract.ts).
//
// Hard rules encoded here:
// - No money for routing. Nothing in this interface carries a fee,
//   referral, commission or affiliate field, and the routing_partners
//   table only accepts compensation_to_arik = 'none' (db/034).
// - Data minimization: a routing intent carries an opaque reference, never
//   the patient's name, date of birth, insurance or address. The
//   prescriber's office receives the patient details from Arik's own
//   request document (Part A), not from the partner.
// - Results are validated at the boundary: a malformed record is a
//   rejection with a reason, never coerced.

import { normalizeNdc, requireIsoDate, requirePositiveUsd } from '../pricing/adapter';

export interface RoutingLocation {
  zip: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface RoutingDestination {
  destinationId: string;      // the partner's id for the pharmacy
  pharmacyName: string;
  npi: string;                // 10 digits
  ncpdp: string | null;       // 7 digits when given
  address: string;
  zip: string;                // 5 digits
  phone: string | null;
  fax: string | null;
  mailOrder: boolean;
  lat: number | null;
  lng: number | null;
}

export interface RoutingQuote {
  destinationId: string;
  ndc: string;                // 11 digits
  quantity: number;
  priceUsd: number;           // cash price for that quantity
  observedAt: string;         // YYYY-MM-DD
  expiresAt: string | null;
}

export const INTENT_STATUSES = ['created', 'sent_to_prescriber', 'received', 'filled', 'cancelled', 'failed'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export interface RoutingIntent {
  intentId: string;           // the partner's id
  reference: string;          // Arik's opaque reference (never patient data)
  destinationId: string;
  status: IntentStatus;
  updatedAt: string;          // ISO timestamp
}

export interface RxRoutingProvider {
  readonly partnerLabel: string;   // public label, never a company name in this repo
  listDestinations(ndc: string, location: RoutingLocation): Promise<RoutingDestination[]>;
  quote(ndc: string, quantity: number, destination: RoutingDestination): Promise<RoutingQuote | null>;
  createRoutingIntent(reference: string, destination: RoutingDestination): Promise<RoutingIntent>;
  getStatus(intentId: string): Promise<RoutingIntent>;
}

export type RoutingFailureKind = 'unauthorized' | 'rate_limited' | 'unavailable' | 'timeout' | 'malformed' | 'not_found' | 'circuit_open';

export class RoutingProviderError extends Error {
  constructor(
    readonly partnerLabel: string,
    readonly kind: RoutingFailureKind,
  ) {
    super(`routing partner ${partnerLabel}: ${kind}`);
    this.name = 'RoutingProviderError';
  }
}

// ---------- Boundary validation (pure) ----------

type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function validateDestination(raw: any): Check<RoutingDestination> {
  const destinationId = str(raw?.destinationId);
  if (!destinationId) return { ok: false, reason: 'missing destinationId' };
  const pharmacyName = str(raw?.pharmacyName);
  if (!pharmacyName) return { ok: false, reason: 'missing pharmacyName' };
  const npi = str(raw?.npi);
  if (!npi || !/^\d{10}$/.test(npi)) return { ok: false, reason: 'bad npi' };
  const ncpdp = raw?.ncpdp == null ? null : str(raw.ncpdp);
  if (ncpdp !== null && !/^\d{7}$/.test(ncpdp)) return { ok: false, reason: 'bad ncpdp' };
  const address = str(raw?.address);
  if (!address) return { ok: false, reason: 'missing address' };
  const zip = str(raw?.zip);
  if (!zip || !/^\d{5}$/.test(zip)) return { ok: false, reason: 'bad zip' };
  const num = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
  const lat = num(raw?.lat);
  const lng = num(raw?.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { ok: false, reason: 'bad coordinates' };
  if (typeof raw?.mailOrder !== 'boolean') return { ok: false, reason: 'missing mailOrder' };
  return {
    ok: true,
    value: { destinationId, pharmacyName, npi, ncpdp, address, zip, phone: str(raw?.phone), fax: str(raw?.fax), mailOrder: raw.mailOrder, lat, lng },
  };
}

export function validateQuote(raw: any): Check<RoutingQuote> {
  const destinationId = str(raw?.destinationId);
  if (!destinationId) return { ok: false, reason: 'missing destinationId' };
  const ndc = normalizeNdc(raw?.ndc);
  if (!ndc) return { ok: false, reason: 'bad ndc' };
  const quantity = Number(raw?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: 'bad quantity' };
  const priceUsd = requirePositiveUsd(raw?.priceUsd);
  if (priceUsd == null) return { ok: false, reason: 'bad price' };
  const observedAt = requireIsoDate(raw?.observedAt);
  if (!observedAt) return { ok: false, reason: 'bad observedAt' };
  const expiresAt = raw?.expiresAt == null ? null : requireIsoDate(raw.expiresAt);
  if (raw?.expiresAt != null && !expiresAt) return { ok: false, reason: 'bad expiresAt' };
  return { ok: true, value: { destinationId, ndc, quantity, priceUsd, observedAt, expiresAt } };
}

export function validateIntent(raw: any): Check<RoutingIntent> {
  const intentId = str(raw?.intentId);
  if (!intentId) return { ok: false, reason: 'missing intentId' };
  const reference = str(raw?.reference);
  if (!reference) return { ok: false, reason: 'missing reference' };
  const destinationId = str(raw?.destinationId);
  if (!destinationId) return { ok: false, reason: 'missing destinationId' };
  if (!(INTENT_STATUSES as readonly string[]).includes(raw?.status)) return { ok: false, reason: 'unknown status' };
  const updatedAt = str(raw?.updatedAt);
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) return { ok: false, reason: 'bad updatedAt' };
  return { ok: true, value: { intentId, reference, destinationId, status: raw.status, updatedAt } };
}

// An opaque reference for a routing intent: random, unrelated to the case
// id or the patient, so a partner can't link it to anything of ours.
export function newRoutingReference(random: () => string = () => crypto.randomUUID()): string {
  return `arik-${random().replace(/-/g, '').slice(0, 20)}`;
}
