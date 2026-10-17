// Patient home (Phase 7 P1): Needs you, Saved so far (confirmed only),
// active jobs and coming up, for the session user's own and managed
// patients' cases. Read-only. Real path only: 403 in DEMO_MODE (the demo
// has its sample patient homes).

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo has sample patient homes');
  return NextResponse.json(await apiDeps.loadHome(userId));
}
