-- db/027_user_style_prefs.sql
-- Persona work (docs/kimi/ARIK_PERSONA.md section 3, 2026-10-14): a style
-- preference the user STATED and chose to save with one tap ("Remember
-- this?"). Only length and reply order; language keeps its own
-- consent-ledgered path (user_matching_profile.preferred_language) and the
-- existing explanation_style 'simple' is the plain / one-step preference.
-- Never a personality label, mood or inferred trait (those are never
-- stored anywhere). Visible and deletable in the app; every save and clear
-- is ledgered (consent category 'style_preference').
-- Applies to: local dev + Supabase project. Idempotent: yes.
-- Deploy order: apply before the code that calls /api/preferences/style.
-- Chat itself fails soft without this table (style is cosmetic).

create table if not exists user_style_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  length text check (length in ('short', 'normal', 'detailed')),
  reply_order text check (reply_order in ('answer_first', 'context_first')),
  updated_at timestamptz not null default now()
);

alter table user_style_prefs enable row level security;

drop policy if exists "user_style_prefs owner select" on user_style_prefs;
create policy "user_style_prefs owner select" on user_style_prefs
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "user_style_prefs owner insert" on user_style_prefs;
create policy "user_style_prefs owner insert" on user_style_prefs
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "user_style_prefs owner update" on user_style_prefs;
create policy "user_style_prefs owner update" on user_style_prefs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_style_prefs owner delete" on user_style_prefs;
create policy "user_style_prefs owner delete" on user_style_prefs
  for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "user_style_prefs service-role all" on user_style_prefs;
create policy "user_style_prefs service-role all" on user_style_prefs
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on user_style_prefs to authenticated;
grant select, insert, update, delete on user_style_prefs to service_role;
