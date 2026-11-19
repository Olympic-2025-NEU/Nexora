#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")/../.."
instance=${1:?usage: backup.sh instance project /absolute/outside-repo/package}
project=${2:?project required}
output=${3:?output directory required}
case "$instance" in a|b|c) ;; *) exit 2;; esac
[[ "$project" =~ ^[a-z][a-z0-9_-]*$ && "$output" = /* ]] || { echo 'Invalid project or output path' >&2; exit 2; }
env_file="$PWD/deploy/instances/$instance.env"
[[ -f "$env_file" && -d "$(dirname "$output")" ]] || { echo 'Missing env or output parent' >&2; exit 1; }
parent=$(realpath "$(dirname "$output")")
case "$parent/" in "$PWD/"*) echo 'Backup must be outside checkout' >&2; exit 1;; esac
[[ ! -e "$output" && ! -L "$output" ]] || { echo 'Backup destination exists' >&2; exit 1; }
exec 9>"${TMPDIR:-/tmp}/nexora-backup-${project}.lock"
flock -n 9 || { echo 'Backup already running' >&2; exit 1; }
compose=(docker compose -f deploy/compose.yml --env-file "$env_file" -p "$project")
"${compose[@]}" --profile apps config -q
pg_image='postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'
node_image='node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee'
network="${project}_internal"
pg() { docker run --rm --network "$network" --env-file "$env_file" "$pg_image" sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"' sh "$@"; }
[[ -n "$("${compose[@]}" ps -q postgres)" && -n "$("${compose[@]}" ps -q seaweedfs)" ]] || { echo 'Postgres and SeaweedFS must be running' >&2; exit 1; }
[[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=postgres-local')" ]] || { echo 'Close externally writable PostgreSQL port before backup' >&2; exit 1; }
# Validate through container environment, never source or print env files.
pg sh -ec 'pg_isready -h postgres -U "$POSTGRES_USER" -d postgres' >/dev/null
pg sh -ec 'for db in "$APP_DB_NAME" "$KEYCLOAK_DB_NAME" "$FLOWABLE_DB_NAME"; do psql -XAt -h postgres -U "$POSTGRES_USER" -d "$db" -c "SELECT 1" >/dev/null; done'
docker run --rm --security-opt label=disable --network "$network" --env-file "$env_file" \
  -v "$PWD:/work:ro" -w /work "$node_image" node deploy/scripts/backup-objects.mjs --preflight
services=$(docker ps --filter "label=com.docker.compose.project=$project" --format '{{.Label "com.docker.compose.service"}}' | sort -u)
[[ -n "$services" ]] || exit 1
while IFS= read -r service; do
  case "$service" in postgres|seaweedfs|redis|clamav|postgres-local|keycloak-local) ;;
    gateway|erp|core-data|worker|file-scanner|file-reconciler|keycloak|flowable|db-bootstrap|db-migrate|keycloak-bootstrap|storage-bootstrap|dx-lab|ai) ;;
    *) echo "Unknown running service: $service" >&2; exit 1;;
  esac
done <<< "$services"
stopped=()
cleanup() {
  status=$?
  trap - EXIT
  if ((${#stopped[@]})); then docker start "${stopped[@]}" >/dev/null || status=1; fi
  if ((status)); then echo 'Backup incomplete; source writers restarted' >&2; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
umask 077
mkdir -m 700 "$output"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Close ingress before stopping backend writers.
for service in gateway dx-lab; do
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    docker stop "$id" >/dev/null
    stopped+=("$id")
  done < <(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")
done
while IFS= read -r service; do
  case "$service" in postgres|seaweedfs|redis|clamav|postgres-local|keycloak-local|gateway|dx-lab) continue;; esac
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    docker stop "$id" >/dev/null
    stopped+=("$id")
  done < <(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")
done <<< "$services"
# Refuse active non-backup PostgreSQL sessions; external writers cannot be quiesced by Compose.
active=$(pg sh -ec 'psql -XAt -h postgres -U "$POSTGRES_USER" -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname <> '\''postgres'\'' AND pid <> pg_backend_pid() AND state <> '\''idle'\''"')
[[ "$active" = 0 ]] || { echo 'Active database sessions remain' >&2; exit 1; }
for pair in 'app APP_DB_NAME' 'keycloak KEYCLOAK_DB_NAME' 'flowable FLOWABLE_DB_NAME'; do
  read -r label variable <<< "$pair"
  pg sh -ec 'eval "db=\${'"$variable"'}"; pg_dump -h postgres -U "$POSTGRES_USER" -d "$db" -Fc' > "$output/$label.dump"
  docker run --rm --security-opt label=disable -v "$output:/backup:ro" "$pg_image" pg_restore -l "/backup/$label.dump" >/dev/null
  pg sh -ec 'eval "db=\${'"$variable"'}"; sql=$(psql -XAt -h postgres -U "$POSTGRES_USER" -d "$db" -c "SELECT format('\''SELECT %L, count(*) FROM %I.%I;'\'', schemaname || '\''.'\'' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'') ORDER BY schemaname, tablename"); printf "%s\n" "$sql" | psql -XAt -F "|" -h postgres -U "$POSTGRES_USER" -d "$db"' > "$output/$label.counts"
done
pg sh -ec 'psql -XAt -h postgres -U "$POSTGRES_USER" -d "$APP_DB_NAME" -c "SELECT row_to_json(a) FROM (SELECT id, bucket, object_key, sha256_hex, size_bytes::text, scan_state, quarantine_purged_at FROM platform.attachment ORDER BY id) a"' > "$output/attachments.jsonl"
pg sh -ec 'exists=$(psql -XAt -h postgres -U "$POSTGRES_USER" -d "$FLOWABLE_DB_NAME" -c "SELECT to_regclass('\''public.act_re_procdef'\'') IS NOT NULL"); if [ "$exists" = t ]; then psql -XAt -h postgres -U "$POSTGRES_USER" -d "$FLOWABLE_DB_NAME" -c "SELECT row_to_json(p) FROM (SELECT key_, version_, deployment_id_, id_ FROM act_re_procdef ORDER BY key_, version_) p"; fi' > "$output/process-definitions.jsonl"
docker run --rm --network "$network" --env-file "$env_file" -e BACKUP_PROJECT="$project" -e BACKUP_STARTED="$started" \
  -e BACKUP_COMMIT="$(git rev-parse HEAD)" --security-opt label=disable \
  -v "$PWD:/work:ro" -v "$output:/backup" -w /work "$node_image" node deploy/scripts/backup-objects.mjs /backup "$instance"
echo "Backup complete: $output"
