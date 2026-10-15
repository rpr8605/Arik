// Security headers for every response (M01-AC8, moved up from S4 with the
// rate limits, 2026-10-14). Pure: next.config.ts calls it at build time;
// scripts/test_security_headers.ts tests it. No imports, so the Next config
// loader can compile it standalone.
//
// CSP notes:
// - script-src/style-src need 'unsafe-inline': Next's App Router emits
//   inline hydration scripts and next/font emits inline styles. The strict
//   alternative is a per-request nonce set in proxy.ts, which forces every
//   page to render dynamically; revisit before the S4 gate.
// - 'unsafe-eval' is added in development only (React dev tooling).
// - connect-src: the browser talks to Supabase directly (auth, session
//   refresh); its origin and websocket are the only outside hosts allowed.
//   Every other call goes through this app's own /api routes.

export interface SecurityHeaderOptions {
  supabaseUrl?: string;
  isDev?: boolean;
}

export interface HeaderEntry {
  key: string;
  value: string;
}

function supabaseOrigins(supabaseUrl?: string): string[] {
  if (!supabaseUrl) return [];
  try {
    const u = new URL(supabaseUrl);
    const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return [u.origin, `${ws}//${u.host}`];
  } catch {
    return [];
  }
}

export function buildCsp(opts: SecurityHeaderOptions = {}): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(opts.isDev ? ["'unsafe-eval'"] : [])];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...supabaseOrigins(opts.supabaseUrl)],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

export function buildSecurityHeaders(opts: SecurityHeaderOptions = {}): HeaderEntry[] {
  return [
    { key: 'Content-Security-Policy', value: buildCsp(opts) },
    // Two years, subdomains included. No preload: preload is a commitment
    // for the whole registrable domain and the demo runs on vercel.app.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Not used today. Camera capture (GUIDED_DOCUMENT_SCANNING.md) and voice
    // will need camera=(self) / microphone=(self) when they ship.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ];
}
