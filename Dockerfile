# Arik Health app container (AWS readiness, 2026-10-05).
#
# Multi-stage build of the Next.js standalone server. Debian slim (glibc)
# rather than Alpine because pdf-to-img pulls @napi-rs/canvas native
# binaries built for glibc.
#
# NEXT_PUBLIC_* values are baked into the browser bundle at build time,
# so pass them as build args:
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
#     --build-arg APP_VERSION=$(git rev-parse --short HEAD) \
#     -t arik-app .
# Server secrets (SUPABASE_SERVICE_ROLE_KEY, IDENTITY_ENCRYPTION_KEY,
# OPENROUTER_API_KEY, ...) are passed at RUNTIME only, never baked in.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ARG APP_VERSION=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=$APP_VERSION
RUN groupadd --system --gid 1001 arik && useradd --system --uid 1001 --gid arik arik
COPY --from=build --chown=arik:arik /app/.next/standalone ./
COPY --from=build --chown=arik:arik /app/.next/static ./.next/static
# The chat route reads the system prompt from disk at runtime.
COPY --from=build --chown=arik:arik /app/chat_system_prompt.md ./chat_system_prompt.md
USER arik
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
