// The one-time authorization for Arik to send letters and receive replies
// (Phase 6). GET: the text (a placeholder for counsel), its version, and
// whether the patient has signed it (?format=pdf: the signed copy). POST:
// sign it { name, signature } with the in-app finger signature. DELETE:
// take it back. Every change is in the consent ledger. Real path only:
// 403 in DEMO_MODE.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

const NAME = /^[\p{L}\p{M}' .-]{2,80}$/u;

async function gate(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return { res: unauthorized() };
  if (apiDeps.isDemoMode()) return { res: forbidden('the demo uses a scripted signature only') };
  return { userId };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  if (req.nextUrl.searchParams.get('format') === 'pdf') {
    const pdf = await apiDeps.authorizationPdfFor(g.userId);
    if (!pdf) return notFound();
    return new NextResponse(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="arik-authorization.pdf"', 'cache-control': 'private, no-store' } });
  }
  return NextResponse.json(await apiDeps.getAuthorization(g.userId));
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  const body = (await req.json().catch(() => null)) as { name?: unknown; signature?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!NAME.test(name)) return NextResponse.json({ error: 'type your full name' }, { status: 400 });
  const out = await apiDeps.signAuthorization(g.userId, name, body?.signature);
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  return NextResponse.json({ revoked: await apiDeps.revokeAuthorization(g.userId) });
}
