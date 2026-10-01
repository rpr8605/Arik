import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): these are destructive endpoints and they
// act on the SESSION user's data only. Before this guard, anyone who
// knew or guessed a user id could wipe that user's entire record -
// the exact hole the AUTH NOTE warned about. UI_UX.md's explicit
// confirmation step is a client concern; the server-side guarantee is
// that only the owner can trigger the deletion.

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    const deleted = await apiDeps.deleteAllUserData(userId);
    return NextResponse.json({ deleted });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    const body = await req.json();
    if (!body.category) {
      return NextResponse.json({ error: 'category is required' }, { status: 400 });
    }
    return NextResponse.json(await apiDeps.clearDemographicCategory(userId, body.category));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
