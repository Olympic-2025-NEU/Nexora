#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
instance=${1:-a}
case "$instance" in a|b|c) ;; *) exit 2;; esac
file="deploy/instances/$instance.env"
node deploy/config.mjs --file "$file" >/dev/null
network="${2:-nexora-$instance}-internal"
docker run --rm --network "$network" postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929 pg_isready -h postgres -U postgres -d postgres >/dev/null || { printf 'postgres: down\n'; exit 1; }
printf 'postgres: up\n'
docker run --rm --security-opt label=disable --network "$network" --env-file "$file" -v "$PWD/deploy/health.mjs:/health.mjs:ro" -v "$PWD/deploy/scripts/smoke.mjs:/smoke.mjs:ro" node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee node /smoke.mjs
