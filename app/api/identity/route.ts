import { NextRequest, NextResponse } from 'next/server';
import { IDENTITY_FIELDS } from '@/lib/identityCrypto';
import { apiDeps, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): identity reads/writes are for the SESSION
// user only - the old userId parameter let anyone read masked status or
// overwrite anyone else's encrypted identity fields, and is gone.
// This route NEVER returns decrypted identity values - only which fields
// are on file. Decryption happens only inside form generation
// (decryptIdentityForForm), not over an API response.

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    return NextResponse.json({ identity: await apiDeps.readIdentityMasked(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    const body = await req.json();
    const unknown = Object.keys(body.fields ?? {}).filter(
      (f) => !IDENTITY_FIELDS.includes(f as (typeof IDENTITY_FIELDS)[number]),
    );
    if (unknown.length > 0) {
      return NextResponse.json({ error: `unknown identity fields: ${unknown.join(', ')}` }, { status: 400 });
    }
    await apiDeps.saveIdentity(userId, body.fields ?? {});
    return NextResponse.json({ identity: await apiDeps.readIdentityMasked(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
