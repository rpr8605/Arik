// A reply to a sent letter (Phase 6): { documentId } for a reply the
// patient uploaded to the case, or { practice: kind } for a practice
// inbound fax (synthetic text, demo executor only). Arik reads it,
// classifies it and proposes the next step for the patient to approve.
// Real path only: 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  if (apiDeps.isDemoMode()) return forbidden('the demo uses scripted replies');
  const { id: caseId, jobId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return notFound();
  const body = (await req.json().catch(() => null)) as { documentId?: unknown; practice?: unknown } | null;
  const src = typeof body?.documentId === 'string' ? { documentId: body.documentId } : typeof body?.practice === 'string' ? { practiceKind: body.practice } : null;
  if (!src) return NextResponse.json({ error: 'documentId or practice is required' }, { status: 400 });
  const out = await apiDeps.addReply(userId, caseId, jobId, src);
  if ('error' in out) return out.status === 404 ? notFound() : NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
}
