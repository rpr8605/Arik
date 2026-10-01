import { NextRequest, NextResponse } from 'next/server';
import { IllegalTransitionError, CASE_STATUSES, RESOLVED_STATUSES, type CaseStatus } from '@/lib/cases';
import { shouldPromptOutcomeConfirmation } from '@/lib/outcomes';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): the service-role client bypasses RLS, so
// every case access goes through canAccessCase (owner or managing
// caregiver). Inaccessible and nonexistent cases get the same 404.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    if (!(await apiDeps.canAccessCase(userId, id))) return notFound();
    const found = await apiDeps.getCase(id);
    if (!found) return notFound();
    return NextResponse.json({ case: found });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    if (!(await apiDeps.canAccessCase(userId, id))) return notFound();
    const body = await req.json();
    if (!CASE_STATUSES.includes(body.to)) {
      return NextResponse.json(
        { error: `to must be one of: ${CASE_STATUSES.join(' | ')}` },
        { status: 400 },
      );
    }
    const updated = await apiDeps.transitionCase(id, body.to as CaseStatus, {
      nextAction: body.nextAction,
      nextActionDue: body.nextActionDue,
    });
    // Terminal transitions carry the outcome-confirmation signal (build
    // plan step 9): the KPI loop counts only patient-confirmed outcomes,
    // so the client must be told to ask. Only queried on terminal status.
    const outcomeConfirmationRequired = (RESOLVED_STATUSES as readonly string[]).includes(updated.status)
      ? shouldPromptOutcomeConfirmation(updated.status, await apiDeps.hasConfirmedOutcome(id))
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
