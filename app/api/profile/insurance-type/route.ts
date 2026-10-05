import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Demo-scope insurance entry (pre-demo item 3): broad plan type ONLY.
// Member ID / group number are deliberately not collected anywhere — we
// can't verify them yet, and storing them implies a confidence we don't
// have. This value is what the AKS hard-block (lib/medicareEligibility.ts)
// reads, so it has real legal effect: 'medicare_part_d'/'medicaid' here
// removes manufacturer copay cards from what the patient is shown.
const PLAN_TYPE_MAP: Record<string, string> = {
  commercial: 'employer',
  medicare: 'medicare_part_d',
  medicaid: 'medicaid',
  uninsured: 'uninsured',
};

export async function PUT(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const mapped = PLAN_TYPE_MAP[body?.planType];
  if (!mapped) {
    return NextResponse.json(
      { error: 'planType must be one of: commercial | medicare | medicaid | uninsured' },
      { status: 400 },
    );
  }
  const { error } = await supabaseAdmin()
    .from('user_matching_profile')
    .upsert({ id: userId, insurance_type: mapped, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ insurance_type: mapped });
}
