import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { publicRoutingDisclosure } from '@/lib/routing/disclosure';

// Public disclosure (M24 step 10): every enabled routing partner by its
// public label, generated from the routing_partners table, never written
// by hand, plus the standing statement that Arik is paid nothing for
// routing. Rendered per request so it always matches the table.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'How Arik routes prescriptions' };

export default async function HowWeRoutePage() {
  let partners: { partner_label: string; enabled: boolean; compensation_to_arik: string }[] = [];
  try {
    const { data } = await supabaseAdmin().from('routing_partners').select('partner_label, enabled, compensation_to_arik');
    partners = data ?? [];
  } catch {
    partners = [];
  }
  const d = publicRoutingDisclosure(partners);
  return (
    <main>
      <h1>How Arik routes prescriptions</h1>
      <p className="lede">{d.statement}</p>
      <h2>Routing partners</h2>
      {d.labels.length > 0 ? (
        <ul>
          {d.labels.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        <p>{d.none}</p>
      )}
      <p>{d.how}</p>
      <div className="actions">
        <Link href="/" className="pill-link">
          Back to home
        </Link>
      </div>
    </main>
  );
}
