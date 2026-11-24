#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
container="nexora-p08-trace-$$-$RANDOM"
temp_root="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  local resolved_temp resolved_parent
  resolved_temp="$(realpath "$temp_root")"
  resolved_parent="$(realpath "${TMPDIR:-/tmp}")"
  case "$resolved_temp" in
    "$resolved_parent"/*) rm -rf -- "$resolved_temp" ;;
    *) printf 'Refusing to remove unexpected temp path: %s\n' "$resolved_temp" >&2 ;;
  esac
}
trap cleanup EXIT
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test_admin -p 127.0.0.1::5432 \
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

mkdir -p "$temp_root/migrations"
cp prisma/schema.prisma "$temp_root/schema.prisma"
cp prisma/migrations/migration_lock.toml "$temp_root/migrations/"
for migration in prisma/migrations/*/; do
  case "$migration" in
    *20261123060000_traceability_baseline/|*20261124010000_passport_policy/|*20261124020000_qr_lifecycle/) ;;
    *) cp -R "$migration" "$temp_root/migrations/" ;;
  esac
done
export NEXORA_TEST_TRACE=1
export OWNER_DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$port/nexora_upgrade"
export DATABASE_URL="$OWNER_DATABASE_URL"
export APP_DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_upgrade"
export CORE_DATABASE_URL="postgresql://core_data:test_core@127.0.0.1:$port/nexora_upgrade"
node --test --require tsx/cjs contexts/traceability/application/backward.test.ts contexts/traceability/application/forward.test.ts contexts/traceability/application/passport-policy.test.ts contexts/traceability/application/qr-token.test.ts
printf 'P08-T01: upgrade existing P07 database\n'
npx prisma migrate deploy --schema "$temp_root/schema.prisma"
npx prisma migrate deploy
npx prisma migrate deploy
node --test --require tsx/cjs tests/platform/trace-schema.integration.test.ts tests/platform/trace-projector.integration.test.ts

printf 'P08-T01: migrate empty database\n'
export OWNER_DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$port/nexora_fresh"
export DATABASE_URL="$OWNER_DATABASE_URL"
export APP_DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_fresh"
export CORE_DATABASE_URL="postgresql://core_data:test_core@127.0.0.1:$port/nexora_fresh"
npx prisma migrate deploy
node --test --require tsx/cjs tests/platform/trace-schema.integration.test.ts tests/platform/trace-projector.integration.test.ts

printf 'P08-T02: restore and replay trace source\n'
MSYS_NO_PATHCONV=1 docker exec "$container" pg_dump -U postgres -Fc -d nexora_fresh -f /tmp/p08-trace.dump
MSYS_NO_PATHCONV=1 docker exec "$container" pg_restore -U postgres --no-owner -d nexora_restore /tmp/p08-trace.dump
export APP_DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_restore"
export CORE_DATABASE_URL="postgresql://core_data:test_core@127.0.0.1:$port/nexora_restore"
node --test --require tsx/cjs tests/platform/trace-restore.integration.test.ts
