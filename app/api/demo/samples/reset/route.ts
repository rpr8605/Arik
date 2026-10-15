import { NextRequest } from 'next/server';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { isValidSampleSessionId } from '@/lib/demo/samples';

// Reset (DEMO_DAY.md stage 1): deletes this tab's sample cases and every
// child row right away (reset_sample_session in db/028). Only the session
// user's own samples for the given tab id can be touched. DEMO_MODE only.
export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (!apiDeps.isDemoMode()) return notFound();
  const body = await req.json().catch(() => ({}));
  if (!isValidSampleSessionId(body?.sid)) return Response.json({ error: 'invalid sample session' }, { status: 400 });

  const limit = await apiDeps.consumeRateLimit('samples', userId, req);
  if (!limit.allowed) return rateLimitResponse(limit, req);

  const deleted = await apiDeps.resetSampleSession(userId, body.sid);
  return Response.json({ deleted });
}
