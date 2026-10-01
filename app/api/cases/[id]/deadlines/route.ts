import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): deadlines are case-scoped, so access is the
// same canAccessCase check as the case itself. The ownership check runs
// BEFORE body validation so error codes never leak which case ids exist.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    if (!(await apiDeps.canAccessCase(userId, id))) return notFound();
    return NextResponse.json({ deadlines: await apiDeps.listDeadlines(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    if (!(await apiDeps.canAccessCase(userId, id))) return notFound();
    const body = await req.json();
    if (!body.noticeDate) {
      return NextResponse.json({ error: 'noticeDate (ISO date) is required' }, { status: 400 });
    }
    const result = await apiDeps.computeAndStoreDeadline(id, {
      noticeDate: body.noticeDate,
      presumedReceiptDate: body.presumedReceiptDate,
      payerName: body.payerName,
      planType: body.planType,
      requiredAttachments: body.requiredAttachments,
    });
    // A no_rule result is a successful, honest answer - not an error.
    return NextResponse.json(result, { status: result.stored ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
