import { NextRequest, NextResponse } from 'next/server';
import { confirmOutcome, listOutcomes, recordOutcome } from '@/lib/outcomes';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get('caseId');
  if (!caseId) return NextResponse.json({ error: 'caseId is required' }, { status: 400 });
  try {
    return NextResponse.json({ outcomes: await listOutcomes(caseId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.outcomeId && typeof body.patientConfirmed === 'boolean') {
      return NextResponse.json({ outcome: await confirmOutcome(body.outcomeId, body.patientConfirmed) });
    }
    if (!body.caseId) return NextResponse.json({ error: 'caseId is required' }, { status: 400 });
    const outcome = await recordOutcome(body.caseId, body.fields ?? {});
    return NextResponse.json({ outcome }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
