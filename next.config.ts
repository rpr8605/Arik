import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
