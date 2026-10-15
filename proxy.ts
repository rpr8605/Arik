import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Standard Supabase session-refresh proxy (formerly "middleware"): keeps
// the auth cookie fresh so server components and route handlers always
// see a valid session.
//
// Anonymous-first (2026-08-12, demo requirement): a first-time visitor
// with no session gets an anonymous Supabase session created HERE, before
// any page renders — no login wall. Anonymous sessions are real user ids,
// so every RLS policy keyed to auth.uid() works unchanged. Skipped for
// /api (bots shouldn't mint users), /login and /auth (the real-account
// path stays clean). If anonymous sign-ins are disabled on the project,
// the attempt 422s and we fall through to the pre-existing login redirect.
const NO_AUTO_ANON = [/^\/api(\/|$)/, /^\/login/, /^\/auth(\/|$)/];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !NO_AUTO_ANON.some((re) => re.test(request.nextUrl.pathname))) {
    try {
      // setAll above persists the new session cookie onto the response.
      await supabase.auth.signInAnonymously();
    } catch {
      // Provider disabled or network hiccup — fall through; the page's own
      // auth check redirects to /login exactly as before this change.
    }
  }
  return response;
}

// Static brand files and the app icons skip the proxy: an image request
// should never mint an anonymous session.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|icon.png|apple-icon.png|opengraph-image).*)'],
};
