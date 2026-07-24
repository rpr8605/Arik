import { NextRequest, NextResponse } from 'next/server';
import { createManagedPatient, listManagedPatients } from '@/lib/caregivers';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.

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
