import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';
import { buildSecurityHeaders } from './lib/securityHeaders';

// Version reported by /api/health, fixed at build time: an explicit
// APP_VERSION (Docker build arg) wins, then the commit Vercel is building,
// then the local git commit. 'unknown' only when none is available (e.g. a
// Docker build without the build arg - .git is excluded from the context).
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
      .toString()
      .trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

const nextConfig: NextConfig = {
  // AWS readiness (2026-10-05): emit a self-contained server bundle in
  // .next/standalone so the app runs in a small container with `node server.js`
  // and no full node_modules install. See Dockerfile and infra/aws/README.md.
  output: 'standalone',
  // Document intake libs ship native/wasm payloads (@napi-rs/canvas via
  // pdf-to-img, pdfjs worker assets) - keep them external so the server
  // bundle doesn't try to repack them.
  // tesseract.js starts its OCR worker from a file path inside its own
  // package; bundled, that path breaks and the worker never starts.
  serverExternalPackages: ['pdfjs-dist', 'pdf-to-img', 'heic-convert', 'tesseract.js', 'sharp'],
  // Document uploads cap at 25MB (enforced in the route); the proxy's
  // default 10MB body buffer would truncate larger multipart bodies
  // before the route ever sees them.
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
  env: {
    APP_VERSION: appVersion(),
  },
  // Security headers on every route (M01-AC8; lib/securityHeaders.ts).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          isDev: process.env.NODE_ENV === 'development',
        }),
      },
    ];
  },
};

export default nextConfig;
