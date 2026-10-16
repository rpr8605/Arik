// Health check for load balancers and container orchestrators
// (AWS readiness, 2026-10-05).
//
// GET /api/health        -> process is up and required env names are set
// GET /api/health?db=1   -> also pings the database (5s timeout)
//
// Unauthenticated by design, so it reveals nothing sensitive: no values,
// no row counts, no error text from the database. Missing env vars are
// reported by NAME only so an operator can fix a bad deploy. demo_mode is
// the one setting shown as a value: a boolean, so the demo gate can be
// checked from outside. No other setting is ever echoed here. /api/* is
// already excluded from anonymous-session creation in proxy.ts.

import { NextRequest, NextResponse } from 'next/server';
import { missingEnv } from '@/lib/env';
import { isDemoMode } from '@/lib/demo/samples';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 5_000;

async function pingDatabase(): Promise<'ok' | 'error' | 'timeout'> {
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS));
  const query = (async () => {
    try {
      const { error } = await supabaseAdmin().from('drugs').select('id', { head: true, count: 'exact' }).limit(1);
      return error ? 'error' : 'ok';
    } catch {
      return 'error';
    }
  })();
  return Promise.race([query, timeout]);
}

export async function GET(req: NextRequest) {
  const missing = missingEnv();
  const body: Record<string, unknown> = {
    status: missing.length === 0 ? 'ok' : 'degraded',
    version: process.env.APP_VERSION ?? 'unknown',
    time: new Date().toISOString(),
    missingEnv: missing,
    demo_mode: isDemoMode(),
  };

  if (req.nextUrl.searchParams.get('db') === '1') {
    const db = missing.includes('SUPABASE_URL') || missing.includes('SUPABASE_SERVICE_ROLE_KEY') ? 'skipped' : await pingDatabase();
    body.database = db;
    if (db !== 'ok') body.status = 'degraded';
  }

  return NextResponse.json(body, { status: body.status === 'ok' ? 200 : 503 });
}
