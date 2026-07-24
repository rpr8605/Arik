import { NextRequest, NextResponse } from 'next/server';
import { createCase, listCases, CASE_TYPES, type CaseType } from '@/lib/cases';

// AUTH NOTE: Phase 1 wires Supabase auth; until then userId comes from
// the request. Do not deploy publicly before the auth guard lands.

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  try {
    return NextResponse.json({ cases: await listCases(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.userId || !CASE_TYPES.includes(body.caseType)) {
      return NextResponse.json(
        { error: `userId and a valid caseType (${CASE_TYPES.join(' | ')}) are required` },
        { status: 400 },
      );
    }
    const created = await createCase({
      userId: body.userId,
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
