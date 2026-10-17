// Documents vault (Phase 7 P1): letters from Arik (draft, final, signed,
// sent, each final copy with its hash) and documents from the patient,
// across every job the session user may see. Read-only. Downloads go
// through the case-scoped letter routes. 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo has sample patient homes');
  return NextResponse.json(await apiDeps.loadDocuments(userId));
}
