// Sign a frozen letter with the in-app finger signature (Phase 6). POST
// { name, signature }; GET returns the signed PDF, rebuilt from the frozen
// text and the stored signature and checked against its stored hash.
// Real path only: 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

type Ctx = { params: Promise<{ id: string; letterId: string }> };
const NAME = /^[\p{L}\p{M}' .-]{2,80}$/u;

async function gate(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return { res: unauthorized() };
  if (apiDeps.isDemoMode()) return { res: forbidden('the demo uses a scripted signature only') };
  const { id: caseId, letterId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return { res: notFound() };
  return { userId, caseId, letterId };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const pdf = await apiDeps.signedLetterFile(g.caseId, g.letterId);
  if (!pdf) return notFound();
  return new NextResponse(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="signed-letter.pdf"', 'cache-control': 'private, no-store' } });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const body = (await req.json().catch(() => null)) as { name?: unknown; signature?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!NAME.test(name)) return NextResponse.json({ error: 'type your full name' }, { status: 400 });
  const out = await apiDeps.signLetter(g.userId, g.caseId, g.letterId, name, body?.signature);
  if ('error' in out) return out.status === 404 ? notFound() : NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
}
