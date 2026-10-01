import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): outcomes are case-scoped. Reads and the
// record path check canAccessCase on the case; the confirm path resolves
// the outcome's case first, then checks the same way.

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const caseId = req.nextUrl.searchParams.get('caseId');
  if (!caseId) return NextResponse.json({ error: 'caseId is required' }, { status: 400 });
  try {
    if (!(await apiDeps.canAccessCase(userId, caseId))) return notFound();
    return NextResponse.json({ outcomes: await apiDeps.listOutcomes(caseId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    const body = await req.json();
    if (body.outcomeId && typeof body.patientConfirmed === 'boolean') {
      const caseId = await apiDeps.getOutcomeCaseId(body.outcomeId);
      if (!caseId || !(await apiDeps.canAccessCase(userId, caseId))) return notFound();
      return NextResponse.json({ outcome: await apiDeps.confirmOutcome(body.outcomeId, body.patientConfirmed) });
    }
    if (!body.caseId) return NextResponse.json({ error: 'caseId is required' }, { status: 400 });
    if (!(await apiDeps.canAccessCase(userId, body.caseId))) return notFound();
    const outcome = await apiDeps.recordOutcome(body.caseId, body.fields ?? {});
    return NextResponse.json({ outcome }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
