// A denial letter or EOB Arik read (Phase 5). GET returns the reader's
// draft to confirm (and the stored review, if already confirmed). POST is
// "Looks right": the patient's confirmed copy is validated, stored, and
// the rules engine runs on it; the response carries the deadline, the
// flags, the appeal points and the letters that fit. The real path only:
// DEMO_MODE uses the scripted denial walkthrough.

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { parseConfirmedDenial } from '@/lib/rules/denials/confirm';
import { denialDraftFromDocument } from '@/lib/production/denialReview';

type Ctx = { params: Promise<{ id: string; docId: string }> };

async function gate(req: NextRequest, ctx: Ctx) {
  const userId = await requireUser(req);
  if (!userId) return { res: unauthorized() };
  if (apiDeps.isDemoMode()) return { res: forbidden('the demo uses sample documents only') };
  const { id: caseId, docId } = await ctx.params;
  if (!(await apiDeps.canAccessCase(userId, caseId))) return { res: notFound() };
  const doc = await apiDeps.getCaseDocument(caseId, docId);
  if (!doc) return { res: notFound() };
  return { userId, caseId, docId, doc };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const draft = denialDraftFromDocument(g.doc);
  if (!draft) return NextResponse.json({ error: 'this document has no text Arik can read as a denial' }, { status: 409 });
  return NextResponse.json({ document_id: g.docId, draft, review: await apiDeps.getDenialView(g.userId, g.caseId, g.docId) });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const parsed = parseConfirmedDenial(await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json({ review: await apiDeps.confirmDenial(g.userId, g.caseId, g.docId, parsed.denial) });
}
