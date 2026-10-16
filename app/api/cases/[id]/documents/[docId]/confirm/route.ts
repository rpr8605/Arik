// "Looks right" on a bill Arik read (Phases 2 to 4): stores the patient's
// confirmed (possibly edited) copy, runs the bill checks on it, and
// returns the findings. GET returns the reading to confirm. The real path
// only: in DEMO_MODE the scripted walkthrough does this, and real
// documents are refused upstream (403).

import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, forbidden, notFound, requireUser, unauthorized } from '@/lib/apiAuth';
import { draftFromReading, parseConfirmedBill } from '@/lib/production/confirm';

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
  const layout = g.doc.extracted_data?.layout;
  if (!layout) return NextResponse.json({ error: 'this document has no line-by-line reading' }, { status: 409 });
  return NextResponse.json({ document_id: g.docId, doc_type: layout.docType, reader: g.doc.reader ?? layout.reader, draft: draftFromReading(layout), confirmed: g.doc.confirmed_data ?? null });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(req, ctx);
  if (g.res) return g.res;
  const parsed = parseConfirmedBill(await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { findings, totalUsd } = await apiDeps.confirmAndReview(g.userId, g.caseId, g.docId, parsed.bill);
  return NextResponse.json({ findings, total_usd: totalUsd });
}
