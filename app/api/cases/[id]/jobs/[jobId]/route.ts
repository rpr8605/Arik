// One send (Phase 6). POST { action: 'approve' } is the patient's one tap:
// the registry gate runs (authorization, frozen and signed letter), the
// approval is ledgered, the executor runs (demo: a practice send, nothing
// leaves Arik), and the delivery events and response deadline are stored.
// POST { action: 'cancel' } cancels a send still waiting for approval.
// Real path only: 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo uses a scripted send screen');
  const { id: caseId, jobId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return notFound();
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== 'approve' && body?.action !== 'cancel') return NextResponse.json({ error: "send { action: 'approve' } or { action: 'cancel' }" }, { status: 400 });
  const out = body.action === 'approve' ? await apiDeps.approveSend(userId, caseId, jobId) : await apiDeps.cancelSend(caseId, jobId);
  if ('error' in out) return out.status === 404 ? notFound() : NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
}
