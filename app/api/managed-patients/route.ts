import { NextRequest, NextResponse } from 'next/server';
import { recordConsent } from '@/lib/consent';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { apiDeps, notFound, requireUser, unauthorized } from '@/lib/apiAuth';

// Auth (Step 0, 2026-10-01): the caregiver is the session user on every
// method - the old caregiverUserId parameter let anyone list or create
// managed patients under someone else's account.

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    return NextResponse.json({ managedPatients: await apiDeps.listManagedPatients(userId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  try {
    const body = await req.json();
    if (!body.patientName) {
      return NextResponse.json({ error: 'patientName is required' }, { status: 400 });
    }
    const created = await apiDeps.createManagedPatient(userId, {
      patientName: body.patientName,
      relationship: body.relationship,
      zipCode: body.zipCode,
    });
    return NextResponse.json({ managedPatient: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Extended-retention opt-in (DATA_RETENTION.md): the recurring-care flag
// that exempts a managed patient's cases from the 90-day post-resolution
// purge. Every change is consent-ledgered, opt-in AND opt-out.
export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();

  const body = await req.json();
  const managedPatientId = typeof body.managedPatientId === 'string' ? body.managedPatientId : '';
  const extendedRetention = body.extendedRetention;
  if (!managedPatientId || typeof extendedRetention !== 'boolean') {
    return NextResponse.json(
      { error: 'managedPatientId and boolean extendedRetention are required' },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  // Only the caregiver who owns this managed-patient record may flip it.
  const { data: mp } = await sb
    .from('managed_patients')
    .select('id')
    .eq('id', managedPatientId)
    .eq('caregiver_user_id', userId)
    .maybeSingle();
  if (!mp) return notFound();

  const { error } = await sb
    .from('managed_patients')
    .update({ extended_retention: extendedRetention })
    .eq('id', managedPatientId);
  if (error) throw error;

  await recordConsent(sb, userId, 'extended_retention', extendedRetention ? 'opt_in' : 'opt_out', {
    managed_patient_id: managedPatientId,
  });

  return NextResponse.json({ managedPatientId, extended_retention: extendedRetention });
}
