-- 005: fix infinite RLS recursion in can_access_case (found by RLS smoke
-- test, 2026-07-24). As SECURITY INVOKER, the function queried `cases`
-- while the `cases` policy itself calls the function -> unbounded
-- recursion ("stack depth limit exceeded"). SECURITY DEFINER (owner =
-- postgres, which bypasses RLS) breaks the cycle; the function exposes
-- nothing but a boolean access predicate. This is the standard remedy
-- for RLS helper recursion. db/003 has been updated to match, so fresh
-- installs get this version directly - this file is the corrective
-- migration for databases that already applied the original 003.

create or replace function can_access_case(p_case_id uuid) returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select exists (
    select 1 from cases c
    where c.id = p_case_id
      and (c.user_id = (select auth.uid())
           or exists (select 1 from managed_patients mp
                      where mp.id = c.managed_patient_id
                        and mp.caregiver_user_id = (select auth.uid()))))
$$;
