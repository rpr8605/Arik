// Pure tests for lib/securityHeaders.ts (M01-AC8).
// Run: npx tsx scripts/test_security_headers.ts
import { buildCsp, buildSecurityHeaders } from '../lib/securityHeaders';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}

const directive = (csp: string, name: string) =>
  csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '))?.slice(name.length + 1).split(' ') ?? [];

const prod = buildSecurityHeaders({ supabaseUrl: 'https://abcd.supabase.co' });
const get = (h: typeof prod, key: string) => h.find((x) => x.key === key)?.value;
const csp = get(prod, 'Content-Security-Policy') ?? '';

check('all six headers present', ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'].every((k) => get(prod, k)));
check('CSP default-src self', directive(csp, 'default-src').join(' ') === "'self'");
check('CSP frame-ancestors none + X-Frame-Options DENY', directive(csp, 'frame-ancestors').join(' ') === "'none'" && get(prod, 'X-Frame-Options') === 'DENY');
check('CSP object-src none, base-uri and form-action self', directive(csp, 'object-src').join(' ') === "'none'" && directive(csp, 'base-uri').join(' ') === "'self'" && directive(csp, 'form-action').join(' ') === "'self'");
check('CSP connect-src = self + Supabase origin + its websocket, nothing else', directive(csp, 'connect-src').join(' ') === "'self' https://abcd.supabase.co wss://abcd.supabase.co");
check("CSP production has no 'unsafe-eval'", !csp.includes("'unsafe-eval'"));
check("CSP development adds 'unsafe-eval' to script-src only", directive(buildCsp({ isDev: true }), 'script-src').includes("'unsafe-eval'") && !directive(buildCsp({ isDev: true }), 'connect-src').includes("'unsafe-eval'"));
check('CSP has no wildcard sources', !/(^|\s)\*(\s|;|$)/.test(csp) && !csp.includes('https:;') && !csp.includes(' https: '));
check('local Supabase (http) -> ws:// websocket', directive(buildCsp({ supabaseUrl: 'http://127.0.0.1:54321' }), 'connect-src').join(' ') === "'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
check('missing or invalid Supabase URL -> connect-src self only', directive(buildCsp({}), 'connect-src').join(' ') === "'self'" && directive(buildCsp({ supabaseUrl: 'not a url' }), 'connect-src').join(' ') === "'self'");
check('HSTS two years, subdomains, no preload', get(prod, 'Strict-Transport-Security') === 'max-age=63072000; includeSubDomains');
check('nosniff + strict referrer', get(prod, 'X-Content-Type-Options') === 'nosniff' && get(prod, 'Referrer-Policy') === 'strict-origin-when-cross-origin');
check('Permissions-Policy denies camera, microphone, geolocation', ['camera=()', 'microphone=()', 'geolocation=()'].every((p) => get(prod, 'Permissions-Policy')?.includes(p)));

console.log(failures === 0 ? '\nSECURITY HEADERS: ALL PASS' : `\nSECURITY HEADERS: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
