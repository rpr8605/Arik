// Chat session ownership (M01-AC2, audit fix 2026-10-05): the chat route
// uses the service-role client, which BYPASSES RLS, so session ownership
// is enforced here in code before any session-scoped read or write.
//
// A session is visible to its owning user, or to the caregiver of the
// managed patient the session's case belongs to (the same rule as
// lib/cases.ts canAccessCase, mirroring db/005 can_access_case). A
// stranger gets the same null as a missing session, so the route answers
// one indistinguishable 404.

import { supabaseAdmin } from './supabaseAdmin';
import { canAccessCase } from './cases';

export interface ChatSessionRef {
  id: string;
  user_id: string | null;
  case_id: string | null;
}

export async function getOwnedChatSession(
  userId: string,
  sessionId: string,
): Promise<ChatSessionRef | null> {
  const { data: session, error } = await supabaseAdmin()
    .from('chat_sessions')
    .select('id, user_id, case_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;
  if (session.user_id === userId) return session as ChatSessionRef;
  if (session.case_id && (await canAccessCase(userId, session.case_id))) {
    return session as ChatSessionRef;
  }
  return null;
}

// The chat route's one up-front profile read (language, insurance type,
// explanation style). Behind the apiDeps seam so the auth boundary is
// testable without a database. select('*') keeps this working regardless
// of which profile migrations have landed.
export async function getChatProfile(userId: string): Promise<any | null> {
  const { data, error } = await supabaseAdmin()
    .from('user_matching_profile')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Review fix C1 (2026-10-14): the managed patient a case belongs to, if
// any, so the chat turn uses THEIR situation, not the caregiver's. Null
// for the patient's own cases. Ownership is already checked by
// getOwnedChatSession before this runs.
export async function getCaseManagedPatient(
  caseId: string,
): Promise<{ id: string; zip_code: string | null } | null> {
  const { data: kase, error } = await supabaseAdmin()
    .from('cases')
    .select('managed_patient_id')
    .eq('id', caseId)
    .maybeSingle();
  if (error) throw error;
  if (!kase?.managed_patient_id) return null;
  const { data: mp, error: mpError } = await supabaseAdmin()
    .from('managed_patients')
    .select('id, zip_code')
    .eq('id', kase.managed_patient_id)
    .maybeSingle();
  if (mpError) throw mpError;
  return mp ? { id: mp.id, zip_code: mp.zip_code ?? null } : null;
}

// Persona intro (2026-10-14): has this user had Arik reply to them in any
// OTHER conversation? Decides the full intro vs "Hi, it's Arik again".
// Fails soft to false (the full intro is harmless).
export async function userHasEarlierConversation(userId: string, currentSessionId: string): Promise<boolean> {
  try {
    const { data: sessions, error } = await supabaseAdmin()
      .from('chat_sessions')
      .select('id')
      .eq('user_id', userId)
      .neq('id', currentSessionId)
      .limit(50);
    if (error || !sessions?.length) return false;
    const { data: msgs, error: msgError } = await supabaseAdmin()
      .from('chat_messages')
      .select('id')
      .in('session_id', sessions.map((s) => s.id))
      .eq('role', 'assistant')
      .limit(1);
    return !msgError && (msgs ?? []).length > 0;
  } catch {
    return false;
  }
}
