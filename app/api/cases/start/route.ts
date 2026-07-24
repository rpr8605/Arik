import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/session';
import { createCase, type CaseType } from '@/lib/cases';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// The "what's going on?" front door: whatever the patient types becomes
// a case with a chat session attached (CRISIS_AWARE_DESIGN.md - the
// answer to the first question creates the case everything hangs off of).

// Pilot heuristic for case typing from free text, until the extraction
// tier takes over classification. The type is visible on the case and
// can be corrected - it's a filing aid, never a hidden judgment.
function guessCaseType(text: string): CaseType {
  const t = text.toLowerCase();
  if (/denial|denied|appeal|prior[- ]?auth/.test(t)) return 'denial_appeal';
  if (/charity|financial assistance/.test(t)) return 'charity_care';
  if (/bill|charge|invoice|hospital|collections|medical debt/.test(t)) return 'bill_dispute';
  return 'prescription_savings';
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  try {
    const kase = await createCase({
      userId,
      caseType: guessCaseType(message),
      nextAction: 'Talk it through in the case thread',
    });
    const { data: session, error } = await supabaseAdmin()
      .from('chat_sessions')
      .insert({ user_id: userId, case_id: kase.id })
      .select('id')
      .single();
    if (error) throw error;
    return NextResponse.json({ caseId: kase.id, sessionId: session.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
