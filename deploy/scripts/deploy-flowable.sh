#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")/../.."
instance="${1:-a}"
case "$instance" in a|b|c) ;; *) exit 2;; esac
project="${2:-nexora}"
force="${3:-}"
source_file="${4:-deploy/flowable/processes/goods-issue-approval.bpmn20.xml}"
if [[ -n "$force" && "$force" != --force ]]; then
  printf 'Usage: deploy-flowable.sh instance project [--force [bpmn-file]]\n' >&2
  exit 2
fi
[[ -f "$source_file" ]] || { printf 'BPMN file missing\n' >&2; exit 2; }
node deploy/config.mjs --file "deploy/instances/$instance.env" >/dev/null
set -a
source "deploy/instances/$instance.env"
set +a
base="http://127.0.0.1:$FLOWABLE_HOST_PORT/flowable-rest/service"
compose=(docker compose -f deploy/compose.yml --env-file "deploy/instances/$instance.env" -p "$project")
ready=0
for attempt in {1..90}; do
  if curl -fsS --max-time 3 -u "$FLOWABLE_ADMIN_USER:$FLOWABLE_ADMIN_PASSWORD" "$base/management/engine" -o /dev/null 2>/dev/null; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || { printf 'Flowable authenticated engine unavailable\n' >&2; exit 1; }
default_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -u admin:test "$base/management/engine")"
[[ "$default_status" == 401 ]] || { printf 'Default admin/test must be rejected\n' >&2; exit 1; }
definitions() {
  curl -fsS --max-time 15 -u "$FLOWABLE_ADMIN_USER:$FLOWABLE_ADMIN_PASSWORD" --get \
    --data-urlencode 'key=goods-issue-approval' --data-urlencode 'latest=true' \
    "$base/repository/process-definitions"
}
version() {
  node -e 'const body=JSON.parse(require("node:fs").readFileSync(0,"utf8")); const rows=body.data.filter(row=>row.key==="goods-issue-approval"); if(rows.length>1) process.exit(2); process.stdout.write(String(rows[0]?.version ?? 0))'
}
before="$(definitions | version)"
if [[ "$before" == 0 || "$force" == --force ]]; then
  curl -fsS --max-time 60 -u "$FLOWABLE_ADMIN_USER:$FLOWABLE_ADMIN_PASSWORD" \
    -F 'deploymentName=nexora-goods-issue-approval' -F "file=@$source_file;type=application/xml" \
    "$base/repository/deployments" -o /dev/null
fi
after="$(definitions | version)"
[[ "$after" -ge 1 ]] && { [[ "$force" != --force ]] || [[ "$after" -eq $((before + 1)) ]]; } || { printf 'Flowable definition version mismatch\n' >&2; exit 1; }
tables="$("${compose[@]}" exec -T -e "PGPASSWORD=$FLOWABLE_DB_PASSWORD" postgres \
  psql -X -tA -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$FLOWABLE_DB_USER" -d "$FLOWABLE_DB_NAME" \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'act\\_%' ESCAPE '\\'")"
[[ "$tables" -gt 0 ]] || { printf 'No ACT_* tables in Flowable PostgreSQL database\n' >&2; exit 1; }
printf 'Flowable goods-issue-approval version %s (ACT_* tables: %s)\n' "$after" "$tables"
