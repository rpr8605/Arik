import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabaseAdmin';

// Resolves the calling user's id from either:
// 1. an Authorization: Bearer <jwt> header (scripted flows, smoke tests), or
// 2. the browser's Supabase session cookie (the normal app path).
// Returns null when unauthenticated - callers answer 401.
export async function getUserId(req?: Request): Promise<string | null> {
  const header = req?.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const jwt = header.slice(7).trim();
    const { data, error } = await supabaseAdmin().auth.getUser(jwt);
    return !error && data.user ? data.user.id : null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          // Read-only here; token refresh happens in middleware.ts.
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
