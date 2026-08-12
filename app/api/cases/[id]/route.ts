import { NextRequest, NextResponse } from 'next/server';
import { getCase, transitionCase, IllegalTransitionError, CASE_STATUSES, RESOLVED_STATUSES, type CaseStatus } from '@/lib/cases';
import { hasConfirmedOutcome, shouldPromptOutcomeConfirmation } from '@/lib/outcomes';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const found = await getCase(id);
    if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ case: found });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (!CASE_STATUSES.includes(body.to)) {
      return NextResponse.json(
        { error: `to must be one of: ${CASE_STATUSES.join(' | ')}` },
        { status: 400 },
      );
    }
    const updated = await transitionCase(id, body.to as CaseStatus, {
      nextAction: body.nextAction,
      nextActionDue: body.nextActionDue,
    });
    // Terminal transitions carry the outcome-confirmation signal (build
    // plan step 9): the KPI loop counts only patient-confirmed outcomes,
    // so the client must be told to ask. Only queried on terminal status.
    const outcomeConfirmationRequired = (RESOLVED_STATUSES as readonly string[]).includes(updated.status)
      ? shouldPromptOutcomeConfirmation(updated.status, await hasConfirmedOutcome(id))
      : false;
    return NextResponse.json({ case: updated, outcome_confirmation_required: outcomeConfirmationRequired });
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const status = (e as Error).message.startsWith('Case not found') ? 404 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
