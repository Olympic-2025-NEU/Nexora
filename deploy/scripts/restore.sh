#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")/../.."
backup=${1:?usage: restore.sh /absolute/backup instance destination-project}
instance=${2:?instance required}
project=${3:?destination project required}
case "$instance" in a|b|c) ;; *) exit 2;; esac
[[ "$backup" = /* && "$project" =~ ^[a-z][a-z0-9_-]*$ ]] || { echo 'Invalid backup or project' >&2; exit 2; }
backup=$(realpath "$backup")
env_file="$PWD/deploy/instances/$instance.env"
[[ -f "$env_file" && -d "$backup" ]] || { echo 'Missing target env or backup' >&2; exit 1; }
pg_image='postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'
node_image='node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee'
compose=(docker compose -f deploy/compose.yml --env-file "$env_file" -p "$project")
"${compose[@]}" --profile apps config -q
node deploy/scripts/verify-backup.mjs "$backup"
[[ "$project" != "$(node -p 'require(process.argv[1]).source.project' "$backup/manifest.json")" ]] || { echo 'Cannot restore into source project' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" = "$(node -p 'require(process.argv[1]).source.commit' "$backup/manifest.json")" ]] || { echo 'Restore checkout must match backup commit' >&2; exit 1; }
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { createHash } from "node:crypto";
  const m = JSON.parse(readFileSync(process.argv[1]));
  for (const [name, digest] of Object.entries(m.config))
    if (createHash("sha256").update(readFileSync(name)).digest("hex") !== digest)
      throw new Error(`Config differs from backup: ${name}`);
' "$backup/manifest.json"
# Compare only non-secret identifiers. Keep instance and PostgreSQL role names unchanged.
docker run --rm --security-opt label=disable --env-file "$env_file" -v "$backup:/backup:ro" "$node_image" node -e '
  const m = require("/backup/manifest.json");
  if (process.env.INSTANCE_ID !== m.source.instance ||
      Object.entries(m.databases).some(([label, name]) => process.env[{
        app:"APP_DB_NAME", keycloak:"KEYCLOAK_DB_NAME", flowable:"FLOWABLE_DB_NAME"}[label]] !== name) ||
      Object.entries(m.roles).some(([name, role]) => process.env[name] !== role))
    throw new Error("Target instance, database or PostgreSQL role differs from backup");
' >/dev/null
exec 9>"${TMPDIR:-/tmp}/nexora-restore-${project}.lock"
flock -n 9 || { echo 'Restore already running' >&2; exit 1; }
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]] || { echo 'Target project containers already exist' >&2; exit 1; }
[[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]] || { echo 'Target project volumes already exist' >&2; exit 1; }
for volume in pg_data seaweed_data seaweed_config redis_data clamav_data; do
  [[ -z "$(docker volume ls -q --filter "name=^${project}_${volume}$")" ]] || { echo 'Target volume exists' >&2; exit 1; }
done
[[ -z "$(docker network ls -q --filter "name=^${project}_(edge|internal)$")" ]] || { echo 'Target network exists' >&2; exit 1; }
network="${project}_internal"
pg() { docker run --rm --security-opt label=disable --network "$network" --env-file "$env_file" -v "$backup:/backup:ro" "$pg_image" sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"' sh "$@"; }
# No migrate, gateway, ERP, Keycloak or Flowable starts during restore.
"${compose[@]}" up -d --no-deps postgres
pg sh -ec 'n=0; until pg_isready -h postgres -U "$POSTGRES_USER" -d postgres >/dev/null; do n=$((n+1)); [ "$n" -lt 60 ]; sleep 2; done'
"${compose[@]}" run --rm --no-deps db-bootstrap
for pair in 'app APP_DB_NAME MIGRATOR_DB_USER MIGRATOR_DB_PASSWORD' 'keycloak KEYCLOAK_DB_NAME KEYCLOAK_DB_USER KEYCLOAK_DB_PASSWORD' 'flowable FLOWABLE_DB_NAME FLOWABLE_DB_USER FLOWABLE_DB_PASSWORD'; do
  read -r label db_var user_var pass_var <<< "$pair"
  pg sh -ec 'eval "db=\${'"$db_var"'}" "user=\${'"$user_var"'}" "PGPASSWORD=\${'"$pass_var"'}"; export PGPASSWORD; pg_restore --exit-on-error --no-owner -h postgres -U "$user" -d "$db" "/backup/'"$label"'.dump"' >/dev/null
  pg sh -ec 'eval "db=\${'"$db_var"'}"; while IFS="|" read -r name expected; do
    [ -n "$name" ] || continue
    case "$name" in *[!a-zA-Z0-9_.]*|.*|*.*.*) exit 1;; esac
    case "$expected" in *[!0-9]*|"") exit 1;; esac
    schema=${name%%.*}; table=${name#*.}
    actual=$(psql -XAt -h postgres -U "$POSTGRES_USER" -d "$db" -c "SELECT count(*) FROM \"$schema\".\"$table\"")
    [ "$actual" = "$expected" ] || { echo "Row count mismatch: $name" >&2; exit 1; }
  done < "/backup/'"$label"'.counts"'
done
pg sh -ec 'result=$(psql -XAt -h postgres -U "$POSTGRES_USER" -d "$APP_DB_NAME" -c "SELECT
  has_table_privilege('\''app_runtime'\'', '\''platform.audit_log'\'', '\''SELECT,INSERT'\'') AND
  NOT has_table_privilege('\''app_runtime'\'', '\''platform.audit_log'\'', '\''UPDATE'\'') AND
  NOT has_table_privilege('\''core_data'\'', '\''platform.audit_log'\'', '\''UPDATE,DELETE'\'') AND
  NOT has_table_privilege('\''app_runtime'\'', '\''platform.attachment'\'', '\''INSERT,UPDATE'\'') AND
  has_table_privilege('\''core_data'\'', '\''platform.attachment'\'', '\''SELECT,INSERT,UPDATE'\'')"); [ "$result" = t ]' || { echo 'Restored grants differ' >&2; exit 1; }
"${compose[@]}" run --rm --no-deps storage-bootstrap
"${compose[@]}" up -d --no-deps seaweedfs
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$("${compose[@]}" ps -q seaweedfs)")" = healthy ]]; then ready=1; break; fi
  sleep 2
done
[[ "$ready" = 1 ]] || { echo 'SeaweedFS not healthy' >&2; exit 1; }
docker run --rm --security-opt label=disable --network "$network" --env-file "$env_file" \
  -v "$PWD:/work:ro" -v "$backup:/backup:ro" -w /work "$node_image" \
  node deploy/scripts/verify-backup.mjs /backup --import
echo "Restore complete in isolated project $project; gateway and application routes remain closed"
