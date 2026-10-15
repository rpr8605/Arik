// Environment contract (AWS readiness, 2026-10-05).
//
// One list of every variable the app reads, so a deploy can be checked
// before it serves traffic. Values are NEVER returned or logged; callers
// only learn which names are missing.
//
// NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time,
// so they must be present when the container image is built (Dockerfile
// build args), not only at runtime.

export type EnvScope = 'server' | 'public';

export interface EnvVar {
  name: string;
  scope: EnvScope;
  required: boolean;
  purpose: string;
}

export const ENV_VARS: EnvVar[] = [
  { name: 'SUPABASE_URL', scope: 'server', required: true, purpose: 'Supabase API URL for the server-side admin client' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', scope: 'server', required: true, purpose: 'Service-role key (bypasses RLS); server only' },
  { name: 'IDENTITY_ENCRYPTION_KEY', scope: 'server', required: true, purpose: 'pgcrypto passphrase for user_identity columns' },
  { name: 'OPENROUTER_API_KEY', scope: 'server', required: true, purpose: 'Model calls (to be replaced by a BAA-covered provider before patient data)' },
  { name: 'NEXT_PUBLIC_SUPABASE_URL', scope: 'public', required: true, purpose: 'Supabase URL for browser and session proxy' },
  { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', scope: 'public', required: true, purpose: 'Publishable (anon) key for browser and session proxy' },
  { name: 'MODEL_TIMEOUT_MS', scope: 'server', required: false, purpose: 'Model call timeout in ms (default 60000)' },
  { name: 'APP_VERSION', scope: 'server', required: false, purpose: 'Git SHA or release tag reported by /api/health (set automatically from the build commit when unset)' },
  { name: 'RATE_LIMIT_ANON_DAILY_MODEL_CAP', scope: 'server', required: false, purpose: 'Combined daily model-request cap for all anonymous users (default 200)' },
  { name: 'RATE_LIMIT_IP_SALT', scope: 'server', required: false, purpose: 'Key for hashing client IPs in rate-limit counters (default: derived from the service-role key)' },
];

export function missingEnv(): string[] {
  return ENV_VARS.filter((v) => v.required && !process.env[v.name]).map((v) => v.name);
}
