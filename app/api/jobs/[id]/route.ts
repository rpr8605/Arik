// One job (Phase 7 P1): its status, what needs the patient, the timeline
// (newest first), money (confirmed and possible) and its documents.
// Read-only. A job the user may not see is the same 404 as a missing one.
// 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo has sample patient homes');
  const { id } = await params;
  if (!(await apiDeps.canAccessCase(userId, id))) return notFound();
  const job = await apiDeps.loadJob(userId, id);
  return job ? NextResponse.json(job) : notFound();
}
