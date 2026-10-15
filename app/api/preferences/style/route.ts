// Saved style preferences (persona section 3, db/027): what the person
// asked for and chose to keep, e.g. "keep it short". Only length and reply
// order; language has its own ledgered path (/api/preferences). The user is
// always the session user (lib/apiAuth.ts); every save and clear is
// written to the consent ledger (lib/stylePrefs.ts).
import { NextRequest, NextResponse } from 'next/server';
import { apiDeps, requireUser, unauthorized } from '@/lib/apiAuth';
import { parseStylePrefsBody } from '@/lib/stylePrefs';

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  return NextResponse.json(await apiDeps.getStylePrefs(userId));
}

export async function PUT(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const parsed = parseStylePrefsBody(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    return NextResponse.json(await apiDeps.saveStylePrefs(userId, parsed.prefs));
  } catch {
    return NextResponse.json({ error: 'could not save that preference right now' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    await apiDeps.deleteStylePrefs(userId);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: 'could not delete that preference right now' }, { status: 500 });
  }
}
