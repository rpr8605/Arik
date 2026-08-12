// lib/medicareEligibility.ts
// What this is for: the Medicare/Medicaid copay-card HARD BLOCK. Federal
// law — the Anti-Kickback Statute, 42 U.S.C. § 1320a-7b, per the OIG
// Special Advisory Bulletin on manufacturer coupons (2005) — prohibits
// offering remuneration (including copay assistance) to induce purchases
// billed to federal health care programs. A manufacturer copay card shown
// to a Medicare/Medicaid patient isn't a bad recommendation, it's a legal
// exposure. So this is a hard filter, NOT a ranking weight: a copay card
// must not appear as a viable option for these patients under any
// circumstance, and the patient must be told why (never silently omitted).
// Called by: app/api/chat/route.ts (between retrieval and response).
// Calls: nothing — pure functions over already-retrieved rows.
//
// Signal note: there is no medicare_legality column yet (the structured
// enum lands with the evidence fold, db/014+). Today's row-level signal is
// exploit_type === 'copay_card' plus eligibility_criteria's free-form
// excludes_government_programs flag — both are checked, so a card missing
// the jsonb flag is still blocked.

export const GOVERNMENT_INSURANCE_TYPES = [
  'medicare_part_d',
  'medicare',
  'medicare_advantage',
  'medicaid',
  'tricare',
  'champva',
] as const;

// The one sentence the patient must see. Plain language, names the law.
export const COPAY_CARD_BLOCK_REASON =
  'Federal law (the Anti-Kickback Statute) prohibits people enrolled in Medicare, ' +
  'Medicaid, or other government health programs from using manufacturer copay cards.';

export function isGovernmentInsurance(insuranceType: string | null | undefined): boolean {
  if (!insuranceType) return false; // unknown coverage blocks nothing — we only hard-block on KNOWN government insurance
  return (GOVERNMENT_INSURANCE_TYPES as readonly string[]).includes(insuranceType);
}

interface ExploitLike {
  exploit_type?: string | null;
  eligibility_criteria?: Record<string, unknown> | null;
}

export function isManufacturerCopayPath(exploit: ExploitLike): boolean {
  if (exploit.exploit_type === 'copay_card') return true;
  return exploit.eligibility_criteria?.excludes_government_programs === true;
}

// Partition already-retrieved exploit rows into what this patient may see
// and what federal law blocks. Unknown/null insurance type blocks nothing:
// the block fires only on affirmatively-known government coverage.
export function partitionCopayCardsForInsurance<T extends ExploitLike>(
  exploits: T[],
  insuranceType: string | null | undefined,
): { viable: T[]; blocked: T[] } {
  if (!isGovernmentInsurance(insuranceType)) return { viable: exploits, blocked: [] };
  const viable: T[] = [];
  const blocked: T[] = [];
  for (const e of exploits) (isManufacturerCopayPath(e) ? blocked : viable).push(e);
  return { viable, blocked };
}
