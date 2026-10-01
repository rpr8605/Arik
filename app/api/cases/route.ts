import { NextRequest, NextResponse } from 'next/server';
import { CASE_TYPES, type CaseType } from '@/lib/cases';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): the caller is the session user, never a
// request parameter. Request-supplied userId fields are ignored.

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    return NextResponse.json({ cases: await apiDeps.listCases(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    const body = await req.json();
    if (!CASE_TYPES.includes(body.caseType)) {
      return NextResponse.json(
        { error: `a valid caseType (${CASE_TYPES.join(' | ')}) is required` },
        { status: 400 },
      );
    }
    // A case may only be filed against a managed patient the caller
    // actually manages.
    if (body.managedPatientId && !(await apiDeps.ownsManagedPatient(userId, body.managedPatientId))) {
      return notFound();
    }
    const created = await apiDeps.createCase({
      userId,
      caseType: body.caseType as CaseType,
      managedPatientId: body.managedPatientId,
      amountAtRiskUsd: body.amountAtRiskUsd,
      estimatedRecoverableUsd: body.estimatedRecoverableUsd,
      organizationsInvolved: body.organizationsInvolved,
      nextAction: body.nextAction,
      nextActionDue: body.nextActionDue,
    });
    return NextResponse.json({ case: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
