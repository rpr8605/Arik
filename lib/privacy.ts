import { supabaseAdmin } from './supabaseAdmin';

// Privacy and deletion controls (SECURITY.md): a user can erase
// everything, and demographic eligibility categories are independently
// deletable without touching the rest of the profile
// (DEMOGRAPHIC_ELIGIBILITY.md).

// Deletes every row tied to this user across every user-scoped table,
// children before parents to satisfy FKs. Also removes caregiver-side
// data for patients this user manages (their authorizations, cases,
// documents, and the managed-patient profiles themselves).
export async function deleteAllUserData(userId: string): Promise<Record<string, number>> {
  const sb = supabaseAdmin();
  const deleted: Record<string, number> = {};

  async function del(table: string, filter: (q: any) => any) {
    const { data, error } = await filter(sb.from(table).delete()).select('id');
    if (error) throw new Error(`${table}: ${error.message}`);
    deleted[table] = (deleted[table] ?? 0) + (data?.length ?? 0);
  }

  const { data: sessions } = await sb.from('chat_sessions').select('id').eq('user_id', userId);
  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length > 0) {
    await del('chat_messages', (q) => q.in('session_id', sessionIds));
  }

  const { data: userCases } = await sb.from('cases').select('id').eq('user_id', userId);
  const caseIds = (userCases ?? []).map((c) => c.id);
  if (caseIds.length > 0) {
    for (const child of ['case_referrals', 'deadlines', 'escalations', 'case_outcomes']) {
      await del(child, (q) => q.in('case_id', caseIds));
    }
  }

  const { data: managed } = await sb
    .from('managed_patients')
    .select('id')
    .eq('caregiver_user_id', userId);
  const managedIds = (managed ?? []).map((m) => m.id);
  if (managedIds.length > 0) {
    await del('authorizations_on_file', (q) => q.in('managed_patient_id', managedIds));
    await del('shared_reviews', (q) => q.in('managed_patient_id', managedIds));
    const { data: managedCases } = await sb
      .from('cases')
      .select('id')
      .in('managed_patient_id', managedIds);
    const managedCaseIds = (managedCases ?? []).map((c) => c.id);
    if (managedCaseIds.length > 0) {
      for (const child of ['case_referrals', 'deadlines', 'escalations', 'case_outcomes']) {
        await del(child, (q) => q.in('case_id', managedCaseIds));
      }
      await del('cases', (q) => q.in('id', managedCaseIds));
    }
    await del('managed_patients', (q) => q.in('id', managedIds));
  }

  for (const table of [
    'uploaded_documents',
    'bill_audit_findings',
    'denial_appeals',
    'output_documents',
    'mtm_eligibility_checks',
    'user_medications',
  ]) {
    await del(table, (q) => q.eq('user_id', userId));
  }
  await del('shared_reviews', (q) => q.eq('owner_user_id', userId));
  if (caseIds.length > 0) {
    await del('cases', (q) => q.in('id', caseIds));
  }
  await del('chat_sessions', (q) => q.eq('user_id', userId));
  await del('user_identity', (q) => q.eq('id', userId));
  await del('user_matching_profile', (q) => q.eq('id', userId));

  return deleted;
}

// Clears one category out of demographic_eligibility_flags without
// touching anything else on the profile (DEMOGRAPHIC_ELIGIBILITY.md).
export async function clearDemographicCategory(
  userId: string,
  category: string,
): Promise<{ cleared: boolean }> {
  const sb = supabaseAdmin();
  const { data: profile, error } = await sb
    .from('user_matching_profile')
    .select('demographic_eligibility_flags')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const flags = (profile?.demographic_eligibility_flags ?? {}) as Record<string, unknown>;
  if (!(category in flags)) return { cleared: false };
  delete flags[category];
  const { error: updateErr } = await sb
    .from('user_matching_profile')
    .update({
      demographic_eligibility_flags: flags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (updateErr) throw updateErr;
  return { cleared: true };
}
