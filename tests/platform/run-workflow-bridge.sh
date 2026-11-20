#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
instance="${1:-a}"
project="${2:-nexora-$instance}"
node deploy/config.mjs --file "deploy/instances/$instance.env" >/dev/null
bash deploy/scripts/deploy-flowable.sh "$instance" "$project"
container="nexora-p04-workflow-bridge-$$-$RANDOM"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$container" \
  -e POSTGRES_PASSWORD=test_admin -p 127.0.0.1::5432 \
  postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929 >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null
port="$(docker port "$container" 5432/tcp | sed -n 's/.*://p')"
test -n "$port"
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -d postgres \
  < tests/platform/bootstrap.sql >/dev/null
export NEXORA_TEST_DB=1
export DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$port/nexora_fresh"
npx prisma migrate deploy
export APP_DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_fresh"
export POSTGRES_HOST_PORT="$port"
export FLOWABLE_HOST_PORT="$(grep -m1 '^FLOWABLE_HOST_PORT=' "deploy/instances/$instance.env" | cut -d= -f2-)"
export FLOWABLE_ADMIN_USER="$(grep -m1 '^FLOWABLE_ADMIN_USER=' "deploy/instances/$instance.env" | cut -d= -f2-)"
export FLOWABLE_ADMIN_PASSWORD="$(grep -m1 '^FLOWABLE_ADMIN_PASSWORD=' "deploy/instances/$instance.env" | cut -d= -f2-)"
node --test --require tsx/cjs tests/platform/workflow-bridge.integration.test.ts
