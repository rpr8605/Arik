import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

// Server-only admin client (service role, bypasses RLS). Never import
// from client components; never expose the key via NEXT_PUBLIC_*.
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
