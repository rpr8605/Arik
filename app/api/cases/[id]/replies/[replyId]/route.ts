// The patient's decision on Arik's suggested next step (Phase 6):
// { decision: 'approve' | 'dismiss' }, or { decision: 'reclassify', kind }
// when the reply says something else. Approving drafts a letter at most;
// sending it is its own approval. Real path only: 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

type Ctx = { params: Promise<{ id: string; replyId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo uses scripted replies');
  const { id: caseId, replyId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return notFound();
  const body = (await req.json().catch(() => null)) as { decision?: unknown; kind?: unknown } | null;
  if (body?.decision !== 'approve' && body?.decision !== 'dismiss' && body?.decision !== 'reclassify') return NextResponse.json({ error: "decision must be 'approve', 'dismiss' or 'reclassify'" }, { status: 400 });
  const out = await apiDeps.decideReply(userId, caseId, replyId, body.decision, typeof body.kind === 'string' ? body.kind : undefined);
  if ('error' in out) return out.status === 404 ? notFound() : NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
}
