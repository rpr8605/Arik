-- db/011_reduced_if_maximizer_detected.sql
-- Part A1 of the 2026-08-11 multi-tool state-law reconciliation ticket.
-- Finding (three independent research passes converged): the IRA Part D OOP
-- cap does NOT mechanically reset commercial copay card maximums. What
-- actually happens: manufacturers reduce a commercial card's annual maximum
-- when they detect the patient is enrolled in a maximizer program. All three
-- passes cited real examples of this clause in manufacturer program terms,
-- so it is tracked per-program, not as a one-off note.
-- NULL semantics: null = not yet checked for this program. It does NOT mean
-- "no such clause" — false does.
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

alter table exploits
  add column if not exists reduced_if_maximizer_detected boolean;
