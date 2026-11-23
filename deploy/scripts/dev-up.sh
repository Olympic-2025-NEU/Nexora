#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Start Nexora infrastructure for host-side Next.js (`npm run dev`) — no apps image build.
set -euo pipefail
cd "$(dirname "$0")/../.."
instance="${1:-a}"
project="${2:-nexora}"
case "$instance" in a|b|c) ;; *) >&2 printf '%s\n' 'Choose instance a, b, or c'; exit 1;; esac

node deploy/scripts/prepare.mjs "$instance"
env_file="deploy/instances/$instance.env"
[[ -f "$env_file" ]] || { >&2 printf '%s\n' "Missing $env_file — run bootstrap or copy from .env.example"; exit 1; }
node deploy/config.mjs --file "$env_file"
node deploy/scripts/render-apisix-routes.mjs "$env_file"
mkdir -p deploy/certs
touch deploy/certs/.gitkeep

printf '%s\n' "Starting infrastructure (project=$project, local-admin overlay, no --profile apps)..."
docker compose -f deploy/compose.yml -f deploy/compose.local-admin.yml --env-file "$env_file" -p "$project" up -d

port="$(awk -F= '/^POSTGRES_HOST_PORT=/{gsub(/\r/,""); print $2; exit}' "$env_file")"
port="${port:-15432}"

printf '\n%s\n' "Infra is up. Containers use the nexora- prefix (e.g. nexora-postgres)."
printf '%s\n' "For host Prisma / Next, point DATABASE_URL at loopback (replace host postgres):"
printf '%s\n' "  ...@127.0.0.1:${port}/nexora"
printf '\n%s\n' "Then from repo root:"
printf '%s\n' "  export DATABASE_URL='<APP_DATABASE_URL with postgres -> 127.0.0.1:${port}>'"
printf '%s\n' "  npm run db:migrate"
printf '%s\n' "  npm run dev"
printf '\n%s\n' "Full Docker apps stack (slow build): docker compose ... --profile apps up -d"
