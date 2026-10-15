import { notFound } from 'next/navigation';
import { isDemoMode } from '@/lib/demo/samples';
import { flowScript } from '@/lib/walkthrough/flows';
import { Player } from '../Player';

// Scripted demo walkthroughs (docs/kimi/DEMO_WALKTHROUGHS.md): /walk/bill,
// /walk/denial, /walk/rx?patient=maria&drug=Eliquis. DEMO_MODE only.
export default async function WalkPage({
  params,
  searchParams,
}: {
  params: Promise<{ flow: string }>;
  searchParams: Promise<{ patient?: string; drug?: string }>;
}) {
  if (!isDemoMode()) notFound();
  const { flow } = await params;
  const { patient, drug } = await searchParams;
  if (!flowScript(flow, patient, drug)) notFound();
  // key: a new patient or drug restarts the player from the beginning.
  return <Player key={`${flow}-${patient ?? ''}-${drug ?? ''}`} flow={flow} patient={patient ?? null} drug={drug ?? null} />;
}
