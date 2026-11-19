# SPDX-License-Identifier: AGPL-3.0-only
# Core Data/File API stub image (P01). Product API surface lands in P03.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci \
  && apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY prisma ./prisma
RUN npx prisma generate
COPY services/core-data/server.js ./
COPY services/core-data/repositories.mjs ./
COPY services/core-data/auth.mjs ./
COPY services/core-data/audit.mjs ./
COPY services/core-data/files ./files
COPY services/core-data/records ./records
COPY contracts/core-records /contracts/core-records
COPY deploy/config.mjs ./config.mjs
COPY deploy/health.mjs ./health.mjs
RUN groupadd --system --gid 1001 nexora \
  && useradd --system --uid 1001 --gid nexora nexora \
  && chown -R nexora:nexora /app
USER nexora
EXPOSE 8080
CMD ["node", "server.js"]
