#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
container="nexora-p03-schema-$$-$RANDOM"
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

docker run --rm -d --name "$container" \
  -e POSTGRES_PASSWORD=test_admin \
  -p 127.0.0.1::5432 \
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
    *20261117000000_platform_baseline/|*20261118000000_system_org_membership/|*20261118010000_system_partner/)
      cp -R "$migration" "$temp_root/migrations/" ;;
  esac
done

export NEXORA_TEST_DB=1
export DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$port/nexora_upgrade"
export CORE_DATABASE_URL="postgresql://core_data:test_core@127.0.0.1:$port/nexora_upgrade"
export APP_DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_upgrade"

printf 'P03-T01: migrating existing Phase 02 database\n'
npx prisma migrate deploy --schema "$temp_root/schema.prisma"
docker exec "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -d nexora_upgrade \
  -c "INSERT INTO platform.audit_log (id, client_id, action, target_type, target_id, outcome, request_id) VALUES ('b54254a2-3bc2-4df9-9474-886ea44c9b0a', 'phase02', 'baseline', 'test', 'existing', 'success', 'phase02-fixture')" >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$container" pg_dump -U postgres -Fc -d nexora_upgrade -f /tmp/pre-p03.dump
npx prisma migrate deploy
npx prisma migrate deploy
node --test tests/platform/schema.integration.mjs

printf 'P03-T01: migrating empty database\n'
export DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$port/nexora_fresh"
export CORE_DATABASE_URL="postgresql://core_data:test_core@127.0.0.1:$port/nexora_fresh"
export APP_DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_fresh"
npx prisma migrate deploy
node --test tests/platform/schema.integration.mjs

printf 'P03-T01: restoring pre-upgrade snapshot into separate database\n'
MSYS_NO_PATHCONV=1 docker exec "$container" pg_restore -U postgres --no-owner -d nexora_restore /tmp/pre-p03.dump
restored="$(docker exec "$container" psql -X -U postgres -tAc \
  "SELECT count(*) FROM platform.audit_log WHERE request_id='phase02-fixture'" -d nexora_restore)"
test "$restored" = "1"
old_grant="$(docker exec "$container" psql -X -U postgres -tAc \
  "SELECT has_table_privilege('core_data','platform.audit_log','INSERT')" -d nexora_restore)"
test "$old_grant" = "f"
printf 'P03-T01: schema, roles, upgrade, repeat deploy, and restore PASS\n'
