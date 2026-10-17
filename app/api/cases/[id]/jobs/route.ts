// Sends on a case (Phase 6). GET: every tracked send with its timeline,
// response deadline, overdue state and replies. POST: prepare a send
// { letterId, channel: 'fax' | 'mail', recipientName, fax | address,
// returnAddress, certified } -> a job waiting for the patient's one-tap
// approval and the one-screen summary. Nothing is sent here.
// Real path only: 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { parseSendRequest } from '@/lib/production/actions';

type Ctx = { params: Promise<{ id: string }> };

async function gate(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return { res: unauthorized() };
  if (apiDeps.isDemoMode()) return { res: forbidden('the demo uses a scripted send screen') };
  const { id: caseId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return { res: notFound() };
  return { userId, caseId };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  return NextResponse.json(await apiDeps.listJobs(g.caseId));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const parsed = parseSendRequest(await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const out = await apiDeps.prepareSend(g.userId, g.caseId, parsed);
  if ('error' in out) return out.status === 404 ? notFound() : NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
}
