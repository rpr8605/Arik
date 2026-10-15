// Rate limits and the public-demo model budget (RUN_ORDER item 0,
// M01-AC7 moved up from S4, 2026-10-14).
//
// Why per-IP and a combined anonymous cap, not just per-user: proxy.ts
// gives every cookieless visitor a NEW anonymous user, so a per-user cap
// alone resets by clearing cookies. The combined anonymous cap is what
// actually bounds the demo's model bill.
//
// The limit table is here (pure, tested by scripts/test_rate_limit.ts);
// counting is one atomic all-or-nothing function in the database
// (db/026_rate_limits.sql), which also decides anonymous vs signed-in from
// auth.users - the app never asserts it.
//
// Fails closed: if the limiter cannot reach the database, the route answers
// 503 instead of serving an uncounted request.

import { createHmac } from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin';

export type LimitedRoute = 'chat' | 'documents' | 'cases_start' | 'samples';

// What a blocked request is told. 'burst' = short per-user window,
// 'daily' = per-user day, 'ip' = per-IP hour, 'demo_cap' = the combined
// anonymous day.
export type LimitKind = 'burst' | 'daily' | 'ip' | 'demo_cap';

export interface RateCheck {
  bucket: string;
  subject: string;
  window_seconds: number;
  limit_authed: number | null; // null = no limit for signed-in users
  limit_anon: number | null;   // null = no limit for anonymous users
}

export type RateDecision =
  | { allowed: true }
  | { allowed: false; unavailable: false; bucket: string; retryAfterSeconds: number }
  | { allowed: false; unavailable: true };

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

// Default combined cap: 200 model requests/day across ALL anonymous users.
// At ~3 cents a chat turn that bounds the worst-case public demo bill near
// $6/day (owner decision 2026-10-14). A chat request is 1-3 model calls
// (extraction, response, at most one grounding regeneration); a document
// upload is 1-2. The cap counts requests.
export const DEFAULT_ANON_DAILY_MODEL_CAP = 200;

// Shared by chat and documents: both spend model calls.
const DEMO_CAP_BUCKET = 'model:anon:day';

interface RouteLimits {
  burst: { windowSeconds: number; limit: number };
  daily: { anon: number; authed: number };
  ipPerHour: number | null;
  spendsModelCalls: boolean;
}

export const ROUTE_LIMITS: Record<LimitedRoute, RouteLimits> = {
  chat: { burst: { windowSeconds: MINUTE, limit: 10 }, daily: { anon: 25, authed: 150 }, ipPerHour: 60, spendsModelCalls: true },
  documents: { burst: { windowSeconds: 10 * MINUTE, limit: 5 }, daily: { anon: 5, authed: 30 }, ipPerHour: 20, spendsModelCalls: true },
  cases_start: { burst: { windowSeconds: HOUR, limit: 10 }, daily: { anon: 20, authed: 100 }, ipPerHour: null, spendsModelCalls: false },
  // Demo sample patients (DEMO_DAY stage 1): opening a copy or Reset makes
  // case rows, no model call. Roomier than cases_start so a demo with a few
  // resets never hits it; chat in a sample still counts against chat.
  samples: { burst: { windowSeconds: HOUR, limit: 30 }, daily: { anon: 60, authed: 200 }, ipPerHour: null, spendsModelCalls: false },
};

// RATE_LIMIT_ANON_DAILY_MODEL_CAP overrides the combined cap; anything that
// is not a positive integer falls back to the default (never "unlimited").
export function anonDailyModelCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RATE_LIMIT_ANON_DAILY_MODEL_CAP;
  if (raw && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (n > 0) return n;
  }
  return DEFAULT_ANON_DAILY_MODEL_CAP;
}

export function planChecks(
  route: LimitedRoute,
  userId: string,
  ipHash: string | null,
  env: Record<string, string | undefined> = process.env,
): RateCheck[] {
  const r = ROUTE_LIMITS[route];
  const checks: RateCheck[] = [
    { bucket: `${route}:user:burst`, subject: userId, window_seconds: r.burst.windowSeconds, limit_authed: r.burst.limit, limit_anon: r.burst.limit },
    { bucket: `${route}:user:day`, subject: userId, window_seconds: DAY, limit_authed: r.daily.authed, limit_anon: r.daily.anon },
  ];
  if (r.ipPerHour !== null && ipHash) {
    checks.push({ bucket: `${route}:ip:hour`, subject: ipHash, window_seconds: HOUR, limit_authed: r.ipPerHour, limit_anon: r.ipPerHour });
  }
  if (r.spendsModelCalls) {
    checks.push({ bucket: DEMO_CAP_BUCKET, subject: 'all', window_seconds: DAY, limit_authed: null, limit_anon: anonDailyModelCap(env) });
  }
  return checks;
}

export function limitKind(bucket: string): LimitKind {
  if (bucket === DEMO_CAP_BUCKET) return 'demo_cap';
  if (bucket.endsWith(':ip:hour')) return 'ip';
  if (bucket.endsWith(':user:day')) return 'daily';
  return 'burst';
}

// First hop of the forwarding chain. On Vercel x-vercel-forwarded-for is
// set by the platform; x-forwarded-for / x-real-ip cover other proxies
// (Caddy on AWS). No header (local dev, tests) means no IP check.
export function clientIp(headers: Headers): string | null {
  for (const name of ['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip']) {
    const first = headers.get(name)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

// Keyed hash so the raw IP is never stored and a leaked counter table can't
// be reversed by hashing all 4 billion IPv4 addresses. Key:
// RATE_LIMIT_IP_SALT, else derived from the service-role key (server-only
// either way). The 'arik-rate-limit-ip:' label keeps this use separate.
export function hashIp(ip: string, env: Record<string, string | undefined> = process.env): string {
  const key = env.RATE_LIMIT_IP_SALT || env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createHmac('sha256', key).update(`arik-rate-limit-ip:${ip}`).digest('hex').slice(0, 32);
}

const LIMITER_TIMEOUT_MS = 5000;

export async function consumeRateLimit(route: LimitedRoute, userId: string, req: Request): Promise<RateDecision> {
  try {
    const ip = clientIp(req.headers);
    const checks = planChecks(route, userId, ip ? hashIp(ip) : null);
    const { data, error } = await supabaseAdmin()
      .rpc('consume_rate_limits', { p_user: userId, p_checks: checks })
      .abortSignal(AbortSignal.timeout(LIMITER_TIMEOUT_MS));
    if (error || !data || typeof data.allowed !== 'boolean') {
      console.error(`[rateLimit] limiter unavailable route=${route}: ${error?.message ?? 'bad response'}`);
      return { allowed: false, unavailable: true };
    }
    if (data.allowed) return { allowed: true };
    return {
      allowed: false,
      unavailable: false,
      bucket: String(data.bucket),
      retryAfterSeconds: Math.max(1, Number(data.retry_after_seconds) || 60),
    };
  } catch (e) {
    console.error(`[rateLimit] limiter unavailable route=${route}: ${(e as Error).message}`);
    return { allowed: false, unavailable: true };
  }
}

const MESSAGES: Record<'en' | 'es', Record<LimitKind | 'unavailable', string>> = {
  en: {
    burst: "You're sending requests faster than Arik can keep up. Please wait a moment and try again.",
    daily: "You've reached today's limit for this demo. Please come back tomorrow.",
    ip: 'Too many requests from your network right now. Please try again in a little while.',
    demo_cap: 'The public demo has reached its daily limit. Please try again tomorrow, or sign in to keep going.',
    unavailable: "Arik can't take new requests for a few minutes. Please try again shortly.",
  },
  es: {
    burst: 'Está enviando solicitudes más rápido de lo que Arik puede atender. Espere un momento e intente de nuevo.',
    daily: 'Llegó al límite de hoy para esta demostración. Vuelva mañana, por favor.',
    ip: 'Hay demasiadas solicitudes desde su red en este momento. Intente de nuevo en un rato.',
    demo_cap: 'La demostración pública llegó a su límite diario. Intente mañana o inicie sesión para continuar.',
    unavailable: 'Arik no puede aceptar solicitudes nuevas por unos minutos. Intente de nuevo pronto.',
  },
};

function preferredLang(headers: Headers): 'en' | 'es' {
  return headers.get('accept-language')?.trim().toLowerCase().startsWith('es') ? 'es' : 'en';
}

// The friendly text goes in `error` because the client (Thread.tsx) shows
// json.error as-is; `code` is for scripts.
export function rateLimitResponse(decision: Exclude<RateDecision, { allowed: true }>, req: Request): Response {
  const msgs = MESSAGES[preferredLang(req.headers)];
  if (decision.unavailable) {
    return Response.json(
      { error: msgs.unavailable, code: 'rate_limiter_unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } },
    );
  }
  const kind = limitKind(decision.bucket);
  return Response.json(
    { error: msgs[kind], code: 'rate_limited', limit: kind, retry_after_seconds: decision.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
  );
}
