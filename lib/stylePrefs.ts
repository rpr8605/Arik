// Saved style preferences (db/027, persona section 3). Server-only; every
// caller resolves the user from the session first (lib/apiAuth.ts).
//
// Reads fail SOFT: style is cosmetic, so a missing table or a hiccup means
// "no saved preference", never a broken chat turn (logged without details).
// Writes and deletes fail loud and are ledgered.

import { supabaseAdmin } from './supabaseAdmin';
import { recordConsent } from './consent';

export const STYLE_LENGTHS = ['short', 'normal', 'detailed'] as const;
export const STYLE_ORDERS = ['answer_first', 'context_first'] as const;

export interface SavedStylePrefs {
  length?: (typeof STYLE_LENGTHS)[number] | null;
  order?: (typeof STYLE_ORDERS)[number] | null;
}

export async function getStylePrefs(userId: string): Promise<SavedStylePrefs> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('user_style_prefs')
      .select('length, reply_order')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[stylePrefs] read failed; using no saved preference');
      return {};
    }
    return data ? { length: data.length ?? null, order: data.reply_order ?? null } : {};
  } catch {
    console.warn('[stylePrefs] read failed; using no saved preference');
    return {};
  }
}

// Validates a PUT body: only `length` and `order`, only allowed values, at
// least one. Pure; exercised through the route by test_auth_guards.ts.
export function parseStylePrefsBody(body: unknown): { prefs: SavedStylePrefs } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const unknownKeys = Object.keys(body as object).filter((k) => k !== 'length' && k !== 'order');
  if (unknownKeys.length) return { error: `only length and order can be saved (got: ${unknownKeys.join(', ')})` };
  const b = body as Record<string, unknown>;
  const prefs: SavedStylePrefs = {};
  if (b.length !== undefined) {
    if (!(STYLE_LENGTHS as readonly unknown[]).includes(b.length)) return { error: 'length must be short, normal or detailed' };
    prefs.length = b.length as SavedStylePrefs['length'];
  }
  if (b.order !== undefined) {
    if (!(STYLE_ORDERS as readonly unknown[]).includes(b.order)) return { error: 'order must be answer_first or context_first' };
    prefs.order = b.order as SavedStylePrefs['order'];
  }
  if (prefs.length === undefined && prefs.order === undefined) return { error: 'nothing to save' };
  return { prefs };
}

export async function saveStylePrefs(userId: string, prefs: SavedStylePrefs): Promise<SavedStylePrefs> {
  const sb = supabaseAdmin();
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (prefs.length !== undefined) row.length = prefs.length;
  if (prefs.order !== undefined) row.reply_order = prefs.order;
  const { error } = await sb.from('user_style_prefs').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  await recordConsent(sb, userId, 'style_preference', 'set', { ...prefs });
  return getStylePrefs(userId);
}

export async function deleteStylePrefs(userId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from('user_style_prefs').delete().eq('user_id', userId);
  if (error) throw error;
  await recordConsent(sb, userId, 'style_preference', 'clear', {});
}
