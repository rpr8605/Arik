import { NextRequest } from 'next/server';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { SAMPLE_LABEL, SAMPLE_PATIENTS, isValidSampleSessionId, sampleByKey } from '@/lib/demo/samples';

// Sample patients (DEMO_DAY.md stage 1). Only exists with DEMO_MODE=true;
// otherwise every method is a plain 404, as if the route weren't there.
// Order: 401 → demo switch → input → rate limit → data.

// GET ?sid=<this tab's sample session id>: the picker list, plus which
// samples this tab already has open (their case ids).
export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (!apiDeps.isDemoMode()) return notFound();
  const sid = req.nextUrl.searchParams.get('sid');
  if (!isValidSampleSessionId(sid)) return Response.json({ error: 'invalid sample session' }, { status: 400 });

  const open = await apiDeps.listSampleCases(userId, sid);
  return Response.json({
    label: SAMPLE_LABEL,
    samples: SAMPLE_PATIENTS.map((s) => ({
      key: s.key,
      name: s.name,
      headline: s.headline,
      shows: s.shows,
      caseId: open.find((c) => c.sample_key === s.key)?.id ?? null,
    })),
  });
}

// POST { sid, key }: open this tab's copy of a sample (created on first open).
export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (!apiDeps.isDemoMode()) return notFound();
  const body = await req.json().catch(() => ({}));
  if (!isValidSampleSessionId(body?.sid)) return Response.json({ error: 'invalid sample session' }, { status: 400 });
  const sample = sampleByKey(body?.key);
  if (!sample) return Response.json({ error: 'unknown sample' }, { status: 400 });

  const limit = await apiDeps.consumeRateLimit('samples', userId, req);
  if (!limit.allowed) return rateLimitResponse(limit, req);

  const opened = await apiDeps.openSampleCase(userId, body.sid, sample.key);
  return Response.json(opened, { status: 200 });
}
