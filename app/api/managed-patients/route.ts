import { NextRequest, NextResponse } from 'next/server';
import { createManagedPatient, listManagedPatients } from '@/lib/caregivers';
import { getUserId } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { recordConsent } from '@/lib/consent';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.
// (PATCH below already uses the session guard; GET/POST keep the legacy
// pattern until their UIs land.)

export async function GET(req: NextRequest) {
  const caregiverUserId = req.nextUrl.searchParams.get('caregiverUserId');
  if (!caregiverUserId) {
    return NextResponse.json({ error: 'caregiverUserId is required' }, { status: 400 });
  }
  try {
    return NextResponse.json({ managedPatients: await listManagedPatients(caregiverUserId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.caregiverUserId || !body.patientName) {
      return NextResponse.json({ error: 'caregiverUserId and patientName are required' }, { status: 400 });
    }
    const created = await createManagedPatient(body.caregiverUserId, {
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
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
  if (!mp) return NextResponse.json({ error: 'not found' }, { status: 404 });

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
