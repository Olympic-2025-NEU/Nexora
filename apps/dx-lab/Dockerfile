# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: AGPL-3.0-only
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/dx-lab ./apps/dx-lab
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build:dxlab

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /workspace
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nexora && useradd --system --uid 1001 --gid nexora nexora
COPY --from=builder --chown=nexora:nexora /workspace/apps/dx-lab/.next/standalone ./
COPY --from=builder --chown=nexora:nexora /workspace/apps/dx-lab/.next/static ./apps/dx-lab/.next/static
USER nexora
EXPOSE 3001
CMD ["node", "apps/dx-lab/server.js"]
