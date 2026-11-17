# SPDX-License-Identifier: AGPL-3.0-only
# DX-Lab frontend stub (P11 product UI). Profile dxlab only.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
COPY server.js ./
RUN groupadd --system --gid 1001 nexora \
  && useradd --system --uid 1001 --gid nexora nexora \
  && chown -R nexora:nexora /app
USER nexora
EXPOSE 3001
CMD ["node", "server.js"]
