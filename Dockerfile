# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: AGPL-3.0-only
# Multi-stage Next.js 16 ERP image (P01-T02). Non-root runtime; no .env copied.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

FROM deps AS migrator
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends openssl \
  && chown -R node:node /app/node_modules
COPY prisma ./prisma
RUN npx prisma generate
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS builder
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build:worker && npm run build

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends openssl \
  && groupadd --system --gid 1001 nexora \
  && useradd --system --uid 1001 --gid nexora nexora
COPY --from=builder --chown=nexora:nexora /app/package.json ./
COPY --from=builder --chown=nexora:nexora /app/package-lock.json ./
COPY --from=builder --chown=nexora:nexora /app/node_modules ./node_modules
COPY --from=builder --chown=nexora:nexora /app/.next ./.next
COPY --from=builder --chown=nexora:nexora /app/public ./public
COPY --from=builder --chown=nexora:nexora /app/prisma ./prisma
COPY --from=builder --chown=nexora:nexora /app/worker ./worker
COPY --from=builder --chown=nexora:nexora /app/deploy/config.mjs ./deploy/config.mjs
COPY --from=builder --chown=nexora:nexora /app/deploy/health.mjs ./deploy/health.mjs
USER nexora
EXPOSE 3000
CMD ["npm", "run", "start"]
