import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // AWS readiness (2026-10-05): emit a self-contained server bundle in
  // .next/standalone so the app runs in a small container with `node server.js`
  // and no full node_modules install. See Dockerfile and infra/aws/README.md.
  output: 'standalone',
  // Document intake libs ship native/wasm payloads (@napi-rs/canvas via
  // pdf-to-img, pdfjs worker assets) - keep them external so the server
  // bundle doesn't try to repack them.
  serverExternalPackages: ['pdfjs-dist', 'pdf-to-img', 'heic-convert'],
  // Document uploads cap at 25MB (enforced in the route); the proxy's
  // default 10MB body buffer would truncate larger multipart bodies
  // before the route ever sees them.
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
};

export default nextConfig;
