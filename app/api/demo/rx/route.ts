import { NextRequest } from 'next/server';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { sampleByKey } from '@/lib/demo/samples';

// Flow 1 of the demo walkthroughs: real sourced prices for a sample
// patient's situation (lib/demo/rxOptions.ts). Read-only, no model call.
// DEMO_MODE only. GET ?drug=Eliquis&patient=maria
const DRUGS = ['Eliquis', 'Zepbound', 'Dupixent'];

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (!apiDeps.isDemoMode()) return notFound();
  const drug = req.nextUrl.searchParams.get('drug') ?? '';
  const sample = sampleByKey(req.nextUrl.searchParams.get('patient') ?? 'maria');
  if (!DRUGS.includes(drug) || !sample) return Response.json({ error: 'unknown drug or patient' }, { status: 400 });

  const limit = await apiDeps.consumeRateLimit('samples', userId, req);
  if (!limit.allowed) return rateLimitResponse(limit, req);

  return Response.json(await apiDeps.loadRxOptions(drug, sample));
}
