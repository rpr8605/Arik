import { NextRequest, NextResponse } from 'next/server';
import { clearDemographicCategory, deleteAllUserData } from '@/lib/privacy';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.
// These are destructive endpoints; the auth guard and an explicit
// confirmation step (UI_UX.md) must land before any public deploy.

export async function DELETE(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  try {
    const deleted = await deleteAllUserData(userId);
    return NextResponse.json({ deleted });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.userId || !body.category) {
      return NextResponse.json({ error: 'userId and category are required' }, { status: 400 });
    }
    return NextResponse.json(await clearDemographicCategory(body.userId, body.category));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
