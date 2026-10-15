// Conversational entity extraction, merge half (CONVERSATIONAL_ENTITY_
// EXTRACTION.md): every non-null fact the extraction tier pulls from a
// turn is written back to the durable record immediately, so it persists
// and is checkable on every later turn - this is what makes "never ask
// twice" true instead of aspirational.
//
// The don't-silently-overwrite rule: if a stored non-null value
// contradicts a new extraction, the new value is parked in
// pending_fact_corrections for a one-tap patient confirm (Thread UI,
// /api/corrections). The old value keeps being used until confirmed - a
// pending correction never blocks case work.
//
// Facts extracted before a case exists are staged in pending_case_facts
// (keyed to the user) and migrated into the case when one is created.

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveLocation } from './resolveLocation';

export interface ExtractedFacts {
  drug_name: string | null;
  dose: string | null;
  employer_name: string | null;
  institution_name: string | null;
  insurance_plan_name: string | null;
  prescriber_name: string | null;
  state_or_location: string | null;
}

export interface PendingCorrection {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string;
}

// Extraction output is model-generated from attacker/patient-controlled
// text; clamp defensively before it touches a durable column.
function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v.slice(0, 200) : null;
}

function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

// One pending correction per (target, field): re-mentioning the same new
// value is a no-op; a THIRD value updates the pending row's new_value
// (old_value stays the original, so confirm always replaces what the
// patient last saw as current).
async function upsertCorrection(
  sb: SupabaseClient,
  opts: {
    userId: string;
    caseId: string | null;
    targetTable: string;
    targetId: string;
    field: string;
    oldValue: string | null;
    newValue: string;
  },
): Promise<PendingCorrection> {
  const { data: existing } = await sb
    .from('pending_fact_corrections')
    .select('id, old_value, new_value')
    .eq('user_id', opts.userId)
    .eq('target_table', opts.targetTable)
    .eq('target_id', opts.targetId)
    .eq('field', opts.field)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (!sameValue(existing.new_value, opts.newValue)) {
      await sb
        .from('pending_fact_corrections')
        .update({ new_value: opts.newValue })
        .eq('id', existing.id);
      return { id: existing.id, field: opts.field, old_value: existing.old_value, new_value: opts.newValue };
    }
    return { id: existing.id, field: opts.field, old_value: existing.old_value, new_value: existing.new_value };
  }

  const { data, error } = await sb
    .from('pending_fact_corrections')
    .insert({
      user_id: opts.userId,
      case_id: opts.caseId,
      target_table: opts.targetTable,
      target_id: opts.targetId,
      field: opts.field,
      old_value: opts.oldValue,
      new_value: opts.newValue,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, field: opts.field, old_value: opts.oldValue, new_value: opts.newValue };
}

// The single decision point for every extracted fact:
//   no stored value      -> write directly via apply()
//   same value           -> no-op (idempotent re-extraction)
//   contradicting value  -> park as a pending correction, apply nothing
async function setOrCorrect(
  sb: SupabaseClient,
  target: { userId: string; caseId: string | null; targetTable: string; targetId: string; field: string },
  currentValue: string | null | undefined,
  rawNewValue: string | null,
  apply: () => Promise<void>,
): Promise<PendingCorrection | null> {
  const newValue = clean(rawNewValue);
  if (!newValue) return null;
  if (currentValue == null || currentValue === '') {
    await apply();
    return null;
  }
  if (sameValue(currentValue, newValue)) return null;
  return upsertCorrection(sb, { ...target, oldValue: currentValue, newValue });
}

async function stageFact(
  sb: SupabaseClient,
  userId: string,
  factType: string,
  factValue: string,
): Promise<void> {
  const { data } = await sb
    .from('pending_case_facts')
    .select('id')
    .eq('user_id', userId)
    .eq('fact_type', factType)
    .eq('fact_value', factValue)
    .limit(1);
  if ((data ?? []).length > 0) return; // identical fact already staged
  const { error } = await sb
    .from('pending_case_facts')
    .insert({ user_id: userId, fact_type: factType, fact_value: factValue });
  if (error) throw error;
}

// Exactly-one match or nothing: 0 matches and ambiguous multi-matches both
// return null rather than guessing which drug the patient meant.
async function resolveDrugId(sb: SupabaseClient, drugName: string): Promise<string | null> {
  const raw = drugName.trim();
  const variants = [
    ...new Set([raw, raw.toLowerCase(), raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()]),
  ];
  const orClauses = [
    `name.ilike.%${raw}%`,
    ...variants.map((v) => `brand_names.cs.{${v}}`),
  ];
  const { data } = await sb.from('drugs').select('id').or(orClauses.join(','));
  return (data ?? []).length === 1 ? data![0].id : null;
}

// opts.managedPatientId (review fix C1, 2026-10-14): set when the case
// belongs to a managed patient. Their facts must never land in the
// caregiver's own profile, and there is no managed-patient profile table
// yet, so profile-bound facts (employer, plan, location) are not stored
// for a managed case; case-scoped and medication facts still are, with
// medication rows tied to the managed patient.
export async function mergeExtractedFacts(
  sb: SupabaseClient,
  userId: string,
  caseId: string | null,
  facts: ExtractedFacts,
  opts: { managedPatientId?: string | null } = {},
): Promise<PendingCorrection[]> {
  const corrections: PendingCorrection[] = [];
  const push = (c: PendingCorrection | null) => {
    if (c && !corrections.some((x) => x.id === c.id)) corrections.push(c);
  };
  const managedPatientId = opts.managedPatientId ?? null;

  // --- Profile-bound fields (exist with or without a case) ---
  if (!managedPatientId) {
    const { data: profile } = await sb
      .from('user_matching_profile')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    // Direct profile writes are batched into one update/upsert at the end.
    const profileWrites: Record<string, string> = {};
    const profileTarget = (field: string) => ({
      userId,
      caseId,
      targetTable: 'user_matching_profile',
      targetId: userId,
      field,
    });
    const queueProfile = (field: string, value: string) => async () => {
      profileWrites[field] = value;
    };

    push(
      await setOrCorrect(sb, profileTarget('employer_name'), profile?.employer_name, facts.employer_name, queueProfile('employer_name', clean(facts.employer_name) ?? '')),
    );
    push(
      await setOrCorrect(sb, profileTarget('insurance_plan_name'), profile?.insurance_plan_name, facts.insurance_plan_name, queueProfile('insurance_plan_name', clean(facts.insurance_plan_name) ?? '')),
    );

    // Location: raw text is always stored verbatim; zip/state are derived
    // deterministically and never trigger a clarifying question.
    const rawLocation = clean(facts.state_or_location);
    if (rawLocation) {
      push(
        await setOrCorrect(sb, profileTarget('state_or_location_raw'), profile?.state_or_location_raw, rawLocation, queueProfile('state_or_location_raw', rawLocation)),
      );
      const resolved = resolveLocation(rawLocation);
      if (resolved.zip) {
        push(await setOrCorrect(sb, profileTarget('zip_code'), profile?.zip_code, resolved.zip, queueProfile('zip_code', resolved.zip)));
      }
      if (resolved.state) {
        push(await setOrCorrect(sb, profileTarget('state'), profile?.state, resolved.state, queueProfile('state', resolved.state)));
      }
    }

    if (Object.keys(profileWrites).length > 0) {
      if (profile) {
        const { error } = await sb
          .from('user_matching_profile')
          .update({ ...profileWrites, updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) throw error;
      } else {
        const { error } = await sb
          .from('user_matching_profile')
          .upsert({ id: userId, ...profileWrites });
        if (error) throw error;
      }
    }
  }

  // --- Institution: case-scoped, staged when no case exists yet ---
  const institution = clean(facts.institution_name);
  if (institution) {
    if (caseId) {
      const { data: kase } = await sb
        .from('cases')
        .select('institution_name')
        .eq('id', caseId)
        .maybeSingle();
      if (kase) {
        push(
          await setOrCorrect(
            sb,
            { userId, caseId, targetTable: 'cases', targetId: caseId, field: 'institution_name' },
            kase.institution_name,
            institution,
            async () => {
              const { error } = await sb
                .from('cases')
                .update({ institution_name: institution, updated_at: new Date().toISOString() })
                .eq('id', caseId);
              if (error) throw error;
            },
          ),
        );
      }
    } else {
      await stageFact(sb, userId, 'institution_name', institution);
    }
  }

  // --- Prescriber: medication-scoped (needed for PAP applications) ---
  const prescriber = clean(facts.prescriber_name);
  if (prescriber) {
    const drugId = facts.drug_name ? await resolveDrugId(sb, facts.drug_name) : null;
    if (drugId) {
      // The medication row belongs to whoever the case is about: the
      // managed patient, or the user themselves (managed_patient_id null).
      const medQuery = sb
        .from('user_medications')
        .select('id, prescriber_name')
        .eq('user_id', userId)
        .eq('drug_id', drugId);
      const { data: med } = await (managedPatientId
        ? medQuery.eq('managed_patient_id', managedPatientId)
        : medQuery.is('managed_patient_id', null))
        .limit(1)
        .maybeSingle();
      if (med) {
        push(
          await setOrCorrect(
            sb,
            { userId, caseId, targetTable: 'user_medications', targetId: med.id, field: 'prescriber_name' },
            med.prescriber_name,
            prescriber,
            async () => {
              const { error } = await sb
                .from('user_medications')
                .update({ prescriber_name: prescriber })
                .eq('id', med.id);
              if (error) throw error;
            },
          ),
        );
      } else {
        // First durable mention of this med: create the row so the drug,
        // dose, and prescriber are all never-ask-twice facts from here on.
        const { error } = await sb.from('user_medications').insert({
          user_id: userId,
          managed_patient_id: managedPatientId,
          drug_id: drugId,
          dose: clean(facts.dose),
          prescriber_name: prescriber,
        });
        if (error) throw error;
      }
    } else {
      // No unambiguous drug to hang it on - stage rather than drop.
      await stageFact(sb, userId, 'prescriber_name', prescriber);
    }
  }

  return corrections;
}

// Called by the case-creation flow: anything staged pre-case moves onto
// the new case. Conflicts go through the same correction path (never a
// silent overwrite). Staged rows of migrated types are deleted afterwards.
export async function migrateStagedFactsIntoCase(
  sb: SupabaseClient,
  userId: string,
  caseId: string,
): Promise<PendingCorrection[]> {
  const corrections: PendingCorrection[] = [];
  const { data: staged } = await sb
    .from('pending_case_facts')
    .select('id, fact_value')
    .eq('user_id', userId)
    .eq('fact_type', 'institution_name')
    .order('created_at', { ascending: false });

  if ((staged ?? []).length > 0) {
    const latest = staged![0].fact_value;
    const { data: kase } = await sb
      .from('cases')
      .select('institution_name')
      .eq('id', caseId)
      .maybeSingle();
    if (kase) {
      const c = await setOrCorrect(
        sb,
        { userId, caseId, targetTable: 'cases', targetId: caseId, field: 'institution_name' },
        kase.institution_name,
        latest,
        async () => {
          const { error } = await sb
            .from('cases')
            .update({ institution_name: latest, updated_at: new Date().toISOString() })
            .eq('id', caseId);
          if (error) throw error;
        },
      );
      if (c) corrections.push(c);
    }
    const { error } = await sb
      .from('pending_case_facts')
      .delete()
      .eq('user_id', userId)
      .eq('fact_type', 'institution_name');
    if (error) throw error;
  }

  return corrections;
}

// Single-row read for the corrections route (apiDeps seam, audit fix
// 2026-10-05). Returns the full row: the route needs user_id for the
// ownership check and target_table/target_id/field/new_value to apply a
// confirm. Null when no such id - the route folds that into its 404.
export async function getPendingCorrection(
  sb: SupabaseClient,
  id: string,
): Promise<any | null> {
  const { data, error } = await sb
    .from('pending_fact_corrections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
