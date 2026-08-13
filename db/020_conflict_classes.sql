-- db/020_conflict_classes.sql
-- Owner grading rule (2026-08-12): not all conflicts are equal. A
-- tier_mismatch (official source vs third-party) leaves the official
-- figure PROVISIONALLY TRUSTED — the row can rank, conflict noted. A
-- same_official_source conflict (two official variants disagreeing) means
-- no trusted value — the row stays pendingVerification, never ranked.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

alter table evidence_conflicts add column if not exists conflict_class text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'evidence_conflicts_class_values') then
    alter table evidence_conflicts add constraint evidence_conflicts_class_values
      check (conflict_class in ('same_official_source','tier_mismatch','unclassified'));
  end if;
end $$;
-- Strict default for anything unlabeled: unclassified behaves like
-- same_official_source (no trusted value) until a human classes it.
update evidence_conflicts set conflict_class = 'unclassified' where conflict_class is null;

-- Classify the three seeded conflicts per the owner's grading.
update evidence_conflicts set conflict_class = 'same_official_source'
where field_name = 'annual_max_savings' and value_a = '3283' and value_b = '6097';
update evidence_conflicts set conflict_class = 'tier_mismatch'
where (field_name = 'monthly_max_savings' and value_a = '150' and value_b = '100')
   or (field_name = 'annual_max_savings' and value_a = '2000' and value_b = '6400');
