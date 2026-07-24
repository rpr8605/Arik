import { NextRequest, NextResponse } from 'next/server';
import { readIdentityMasked, saveIdentity, IDENTITY_FIELDS } from '@/lib/identityCrypto';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.
// This route NEVER returns decrypted identity values - only which fields
// are on file. Decryption happens only inside form generation
// (decryptIdentityForForm), not over an API response.

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  try {
    return NextResponse.json({ identity: await readIdentityMasked(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    const unknown = Object.keys(body.fields ?? {}).filter(
      (f) => !IDENTITY_FIELDS.includes(f as (typeof IDENTITY_FIELDS)[number]),
    );
    if (unknown.length > 0) {
      return NextResponse.json({ error: `unknown identity fields: ${unknown.join(', ')}` }, { status: 400 });
    }
    await saveIdentity(body.userId, body.fields ?? {});
    return NextResponse.json({ identity: await readIdentityMasked(body.userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
