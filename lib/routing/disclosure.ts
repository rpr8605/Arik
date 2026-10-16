// The /how-we-route disclosure (M24 step 10), pure so it can be tested:
// the list comes from the routing_partners rows, never hand-written.

export function publicRoutingDisclosure(rows: { partner_label: string; enabled: boolean; compensation_to_arik: string }[]) {
  const labels = rows
    .filter((r) => r.enabled && r.compensation_to_arik === 'none')
    .map((r) => r.partner_label)
    .sort((a, b) => a.localeCompare(b));
  return {
    statement:
      'Arik receives nothing for routing a prescription: no fee, no share of revenue, no referral payment, no data fee and no favors, from any pharmacy, drug maker, pharmacy benefit manager or routing partner.',
    labels,
    none: 'No routing partners are connected yet.',
    how:
      'When a pharmacy offers a lower price, Arik shows it next to the others, ranked by price, freshness and distance only. Whether a pharmacy works with a routing partner never changes the order. Arik never sends a prescription itself; it prepares a request for your doctor’s office, and you approve it first.',
  };
}
