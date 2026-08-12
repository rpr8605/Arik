// Eval fixtures — the four complaint patterns (Part A2 of the 2026-08-11
// multi-tool reconciliation ticket). Three independent research passes
// converged on these four failure shapes as the recurring real-world ways
// drug-savings promises break. Each fixture is a GENERALIZED scenario (no
// real patient details, per the passes' own framing) paired with the known-
// correct system behavior, so the Phase 5 eval harness can assert the
// pipeline handles it right instead of discovering the failure on a patient.
//
// Fixture shape:
//   id                      stable key
//   name                    short label
//   scenario                the generalized situation the patient describes
//   known_correct_behavior  assertable statements about what the system must do
//   spec_basis              where the expected behavior comes from (file refs)
//
// Run directly (`node scripts/eval_fixtures.mjs`) to shape-check the set.
// The Zepbound conflicting-terms fixture lands here too when the bundle
// seeds ship (build-plan steps 7-8) — same shape, DB-backed instead of
// scenario-backed.

export const COMPLAINT_PATTERN_FIXTURES = [
  {
    id: 'card_rejected_at_counter',
    name: 'Coupon/card rejected at pharmacy counter despite advertised acceptance',
    scenario:
      'A patient was shown a manufacturer copay card path, went to fill, ' +
      'and the pharmacy refused the card even though the program advertises ' +
      'acceptance. Patient comes back asking why Arik said it would work.',
    known_correct_behavior: [
      'System never frames card acceptance as guaranteed — program terms are presented as point-in-time with their retrieval date.',
      'Response works only from retrieved rows: it offers the next-best verified path for that drug if one exists in context, and otherwise returns the deterministic no-data response rather than improvising a reason.',
      'When the rejection is a coordination-of-benefits / other-coverage misfire, the response surfaces the matching counter_override_guidance rows as a checklist for pharmacy staff — never an invented code or override.',
      'Trust receipt (source, retrieval date, eligibility basis) is still attached to the original recommendation.',
    ],
    spec_basis: [
      'chat_system_prompt.md (trust-receipt requirement; counter-rejection checklist rule)',
      'app/api/chat/route.ts (empty-retrieval short-circuit; retrieved-context-only rule)',
      'counter_override_guidance table (db/012; NCPDP field 308-C8 values)',
      'Arik_Accumulator_Ban_and_Program_Terms_Research.md section 6 (price/acceptance not guaranteed disclosure)',
    ],
  },
  {
    id: 'quoted_price_mismatch_at_pos',
    name: 'Quoted/online price does not match price charged at point of sale',
    scenario:
      'A patient was quoted a cash or coupon price, and the pharmacy charged ' +
      'a different amount at the counter. Patient asks which number was real.',
    known_correct_behavior: [
      'Every priced answer carries effective/retrieval dates from the underlying sources rows — a price is presented as point-in-time, never as a standing guarantee.',
      'Price rows older than the 30-day freshness window do not anchor a claim (same assertion the KPI harness enforces).',
      'System states plainly that the pharmacy can change the price, per the standing disclosure checklist.',
    ],
    spec_basis: [
      'Arik_Health_Drug_Bundle_Build_Ticket.md sections 1.4/1.7 (staleness + 30-day freshness assertion)',
      'Arik_Accumulator_Ban_and_Program_Terms_Research.md section 6 (price-not-guaranteed disclosure)',
      'schema.sql sources table (effective_date / last_verified_at freshness fields)',
    ],
  },
  {
    id: 'accumulator_deductible_cliff',
    name: 'Accumulator "deductible cliff" — assistance applied but never credited toward deductible/OOP',
    scenario:
      'A patient used a $0 manufacturer card for months, the card exhausted, ' +
      'and they discover none of the assistance counted toward their ' +
      'deductible — they owe the full deductible at once.',
    known_correct_behavior: [
      'When the patient\'s plan matches an accumulator/maximizer policy row and no verified state ban protects them, a $0 manufacturer-card recommendation always carries the deductible-credit warning — surfaced, never hidden.',
      'Suppression of that warning happens only on a state-ban row whose verification supports it; an unverified or absent ban row never silently suppresses the warning.',
      'The warning is deterministic (from the ranking layer / retrieved policy rows), not dependent on the response model remembering to mention it.',
    ],
    spec_basis: [
      'Arik_Health_Drug_Bundle_Build_Ticket.md section 1.3 (warning, not just hiding the exploit)',
      '010_state_accumulator_ban_laws.sql (state_has_accumulator_ban lookup; unresolved rows stay conservative)',
      'docs/build-plans/arik-accumulator-drug-bundle-2026-08-11.md (ranking engine + warning surfacing steps)',
    ],
  },
  {
    id: 'foundation_fund_closes',
    name: 'Foundation fund closes/waitlists shortly after patient applies or enrolls',
    scenario:
      'A patient was pointed at a foundation grant, applied, and the fund ' +
      'closed or waitlisted almost immediately after. Patient asks Arik what ' +
      'happened and what now.',
    known_correct_behavior: [
      'Fund open/closed status is treated as live data: a fund known to be closed or waitlisted is never presented as an available path.',
      'Exploit rows for funds carry status and last_verified_at; stale rows stop anchoring recommendations until re-verified.',
      'Where a backup fund exists (e.g. HealthWell as alternate to PAN), it is presented as a separate cited path, not as a guarantee.',
    ],
    spec_basis: [
      'Arik_Accumulator_Ban_and_Program_Terms_Research.md section 3 (funds show closed when out of money; alert-signup framing)',
      'Arik_Health_Drug_Bundle_Build_Ticket.md section 2.1 (backup-source pattern per bundle)',
      'schema.sql exploits table (status, last_verified_at)',
    ],
  },
];

// Shape check — run directly. Keeps the fixture file self-validating until
// the Phase 5 harness consumes it.
const required = ['id', 'name', 'scenario', 'known_correct_behavior', 'spec_basis'];
let failures = 0;
for (const f of COMPLAINT_PATTERN_FIXTURES) {
  for (const key of required) {
    const v = f[key];
    const empty = Array.isArray(v) ? v.length === 0 : !v;
    if (empty) {
      console.error(`fixture ${f.id ?? '(no id)'}: missing/empty ${key}`);
      failures++;
    }
  }
}
if (failures > 0) process.exit(1);
console.log(`${COMPLAINT_PATTERN_FIXTURES.length} complaint-pattern fixtures, all well-formed:`);
for (const f of COMPLAINT_PATTERN_FIXTURES) console.log(` - ${f.id}`);
