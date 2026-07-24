import { supabaseAdmin } from './supabaseAdmin';

// Caregiver mode (CAREGIVER_MODE.md): one login manages multiple patient
// profiles; payer/hospital authorization status is tracked per entity,
// because a dispute with Hospital A says nothing about authorization on
// file with Medicare.

export interface ManagedPatient {
  id: string;
  caregiver_user_id: string;
  patient_name: string;
  relationship: string | null;
  zip_code: string | null;
  created_at: string;
}

export type AuthorizationStatus = 'not_started' | 'form_generated' | 'submitted' | 'on_file';
export type AuthorizationType = 'authorized_representative' | 'hipaa_release' | 'blue_button_oauth';

export async function createManagedPatient(
  caregiverUserId: string,
  input: { patientName: string; relationship?: string; zipCode?: string },
): Promise<ManagedPatient> {
  const { data, error } = await supabaseAdmin()
    .from('managed_patients')
    .insert({
      caregiver_user_id: caregiverUserId,
      patient_name: input.patientName,
      relationship: input.relationship ?? null,
      zip_code: input.zipCode ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ManagedPatient;
}

export async function listManagedPatients(caregiverUserId: string): Promise<ManagedPatient[]> {
  const { data, error } = await supabaseAdmin()
    .from('managed_patients')
    .select()
    .eq('caregiver_user_id', caregiverUserId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ManagedPatient[];
}

export async function getAuthorizationStatus(
  managedPatientId: string,
  entityName: string,
): Promise<{ status: AuthorizationStatus; authorizationType: AuthorizationType | null }> {
  const { data, error } = await supabaseAdmin()
    .from('authorizations_on_file')
    .select('status, authorization_type')
    .eq('managed_patient_id', managedPatientId)
    .eq('entity_name', entityName)
    .maybeSingle();
  if (error) throw error;
  return {
    status: (data?.status ?? 'not_started') as AuthorizationStatus,
    authorizationType: (data?.authorization_type ?? null) as AuthorizationType | null,
  };
}

export async function setAuthorizationStatus(
  managedPatientId: string,
  entityName: string,
  authorizationType: AuthorizationType,
  status: AuthorizationStatus,
  documentId?: string,
): Promise<void> {
  const sb = supabaseAdmin();
  const { data: existing, error: readErr } = await sb
    .from('authorizations_on_file')
    .select('id')
    .eq('managed_patient_id', managedPatientId)
    .eq('entity_name', entityName)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing) {
    const { error } = await sb
      .from('authorizations_on_file')
      .update({ authorization_type: authorizationType, status, document_id: documentId ?? null })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from('authorizations_on_file').insert({
      managed_patient_id: managedPatientId,
      entity_name: entityName,
      authorization_type: authorizationType,
      status,
      document_id: documentId ?? null,
    });
    if (error) throw error;
  }
}
