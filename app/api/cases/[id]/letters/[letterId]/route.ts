// One letter: GET as JSON, or ?format=pdf once frozen (rendered from the
// frozen text, after checking it still matches its hash). PATCH edits a
// draft ({ subject, body }) or freezes it ({ action: 'freeze' }).

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { letterHash, letterPdf } from '@/lib/letters/freeze';
import { letterDateLine } from '@/lib/letters/templates';

type Ctx = { params: Promise<{ id: string; letterId: string }> };

async function gate(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return { res: unauthorized() };
  if (apiDeps.isDemoMode()) return { res: forbidden('the demo uses sample letters only') };
  const { id: caseId, letterId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return { res: notFound() };
  return { caseId, letterId };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const letter = await apiDeps.getLetter(g.caseId, g.letterId);
  if (!letter) return notFound();
  if (req.nextUrl.searchParams.get('format') !== 'pdf') return NextResponse.json({ letter });
  if (letter.status !== 'frozen') return NextResponse.json({ error: 'freeze the letter before downloading it' }, { status: 409 });
  if (letterHash(letter) !== letter.content_sha256) return NextResponse.json({ error: 'the stored letter no longer matches its frozen copy' }, { status: 500 });
  const pdf = await letterPdf(letter, letterDateLine(letter.frozen_at!.slice(0, 10)), undefined, new Date(letter.frozen_at!));
  return new NextResponse(Buffer.from(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="letter-${letter.letter_type}-v${letter.version}.pdf"`, 'cache-control': 'private, no-store' },
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const body = (await req.json().catch(() => null)) as { action?: unknown; subject?: unknown; body?: unknown } | null;
  if (body?.action === 'freeze') {
    const letter = await apiDeps.freezeLetter(g.caseId, g.letterId);
    return letter ? NextResponse.json({ letter }) : notFound();
  }
  if (typeof body?.subject === 'string' && typeof body?.body === 'string' && body.subject.trim() && body.body.trim() && body.subject.length <= 300 && body.body.length <= 20_000) {
    const existing = await apiDeps.getLetter(g.caseId, g.letterId);
    if (!existing) return notFound();
    if (existing.status === 'frozen') return NextResponse.json({ error: 'a frozen letter cannot be edited; write a new version' }, { status: 409 });
    const letter = await apiDeps.editLetter(g.caseId, g.letterId, { subject: body.subject.trim(), body: body.body.trim() });
    return letter ? NextResponse.json({ letter }) : notFound();
  }
  return NextResponse.json({ error: "send { action: 'freeze' } or { subject, body }" }, { status: 400 });
}
