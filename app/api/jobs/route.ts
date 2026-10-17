// Jobs list (Phase 7 P1): every job the session user may see, with its
// status in plain words and its next step. Read-only. 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo has sample patient homes');
  return NextResponse.json(await apiDeps.loadJobs(userId));
}
