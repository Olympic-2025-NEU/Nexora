#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")/../.."
instance=${1:?usage: backup-restore.sh instance source-project /absolute/target-checkout target-project /absolute/backup-parent}
source_project=${2:?source project required}
target=${3:?target checkout required}
target_project=${4:?target project required}
parent=${5:?backup parent required}
[[ "$target" = /* && "$parent" = /* && "$target_project" != "$source_project" && ( -d "$target/.git" || -f "$target/.git" ) ]] || { echo 'Separate target checkout and project required' >&2; exit 2; }
[[ "$(git rev-parse HEAD)" = "$(git -C "$target" rev-parse HEAD)" ]] || { echo 'Target checkout must match source commit' >&2; exit 2; }
[[ -f "$target/deploy/instances/$instance.env" && -d "$parent" ]] || { echo 'Prepare target env and backup parent first' >&2; exit 2; }
[[ -f "$target/deploy/apisix/apisix.generated.yaml" ]] || { echo 'Render target gateway with bootstrap.sh first' >&2; exit 2; }
case "$(realpath "$parent")/" in "$PWD/"*|"$(realpath "$target")/"*) echo 'Backup parent must be outside both checkouts' >&2; exit 2;; esac

root=$(mktemp -d "$parent/backup-restore-test.XXXXXXXX")
chmod 700 "$root"
original="$root/original"
after="$root/after"
compose=(docker compose -f deploy/compose.yml --env-file "deploy/instances/$instance.env" -p "$target_project")
cleanup() {
  status=$?
  trap - EXIT
  ( cd "$target"; "${compose[@]}" --profile apps down -v --remove-orphans ) || status=1
  exit "$status"
}
trap cleanup EXIT
pg_image='postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'
pg() {
  docker run --rm --security-opt label=disable --network "${target_project}_internal" --env-file "$target/deploy/instances/$instance.env" -v "$original:/backup:ro" "$pg_image" sh -ec 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"' sh "$@"
}
echo 'CASE source backup and verification'
bash deploy/scripts/backup.sh "$instance" "$source_project" "$original"
node deploy/scripts/verify-backup.mjs "$original"
echo 'PASS source backup and verification'

cp -a "$original" "$root/damaged"
node -e 'const fs=require("fs"); const p=process.argv[1]; const f=fs.openSync(p,"r+"); const b=Buffer.alloc(1); fs.readSync(f,b,0,1,0); b[0]^=1; fs.writeSync(f,b,0,1,0); fs.closeSync(f)' "$root/damaged/app.dump"
echo 'CASE modified dump rejected'
if node deploy/scripts/verify-backup.mjs "$root/damaged"; then echo 'FAIL modified dump accepted' >&2; exit 1; fi
echo 'PASS modified dump rejected'

cp -a "$original" "$root/missing-key"
echo 'CASE missing object key rejected'
node -e 'const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p));if(!m.objects.length)process.exit(2);m.objects[0].key="missing-key";fs.writeFileSync(p,JSON.stringify(m))' "$root/missing-key/manifest.json"
if node deploy/scripts/verify-backup.mjs "$root/missing-key"; then echo 'FAIL missing key accepted' >&2; exit 1; fi
echo 'PASS missing object key rejected'

echo 'CASE source project restore rejected'
if bash deploy/scripts/restore.sh "$original" "$instance" "$source_project"; then echo 'FAIL source restore accepted' >&2; exit 1; fi
echo 'PASS source project restore rejected'

echo 'CASE isolated restore'
( cd "$target"; bash deploy/scripts/restore.sh "$original" "$instance" "$target_project"; "${compose[@]}" --profile apps up -d --build; bash deploy/scripts/smoke.sh "$instance" "$target_project" )
for label in app keycloak flowable; do
  case "$label" in app) variable=APP_DB_NAME;; keycloak) variable=KEYCLOAK_DB_NAME;; flowable) variable=FLOWABLE_DB_NAME;; esac
  pg sh -ec 'eval "db=\${'"$variable"'}"; while IFS="|" read -r name expected; do
    [ -n "$name" ] || continue
    # Keycloak creates/deletes runtime sessions on startup; they are not restored business data.
    case "'"$label"':$name" in keycloak:public.*_session) continue;; esac
    case "$name" in *[!a-zA-Z0-9_.]*|.*|*.*.*) exit 1;; esac
    schema=${name%%.*}; table=${name#*.}
    actual=$(psql -XAt -h postgres -U "$POSTGRES_USER" -d "$db" -c "SELECT count(*) FROM \"$schema\".\"$table\"")
    [ "$actual" = "$expected" ] || { echo "Row count mismatch: $name" >&2; exit 1; }
  done < "/backup/'"$label"'.counts"'
done
pg sh -ec 'psql -XAt -h postgres -U "$POSTGRES_USER" -d "$APP_DB_NAME" -c "SELECT row_to_json(a) FROM (SELECT id, bucket, object_key, sha256_hex, size_bytes::text, scan_state, quarantine_purged_at FROM platform.attachment ORDER BY id) a"' > "$root/restored-attachments.jsonl"
cmp "$original/attachments.jsonl" "$root/restored-attachments.jsonl"
for check in 'core_data UPDATE platform.audit_log SET action=action WHERE false' \
  'core_data DELETE FROM platform.audit_log WHERE false' \
  'app_runtime UPDATE platform.core_record SET id=id WHERE false' \
  'app_runtime INSERT INTO platform.attachment DEFAULT VALUES'; do
  read -r role sql <<< "$check"
  if pg sh -ec 'psql -Xq -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$APP_DB_NAME" -c "SET ROLE '"$role"'; $*"' sh "$sql" >/dev/null 2>&1; then
    echo "FAIL PG granted forbidden operation: $role $sql" >&2; exit 1
  fi
  echo "PASS PG denied: $role $sql"
done
echo 'PASS isolated restore: row counts, attachment metadata, object hashes verified by restore, PG denials, smoke'

echo 'CASE source unchanged'
bash deploy/scripts/backup.sh "$instance" "$source_project" "$after"
node deploy/scripts/verify-backup.mjs "$after"
node -e 'const fs=require("fs");const [a,b]=process.argv.slice(1).map(p=>JSON.parse(fs.readFileSync(p)));for(const key of ["counts","attachments","objects"]){const stable=m=>key==="counts"?{...m.counts,keycloak:Object.fromEntries(Object.entries(m.counts.keycloak).filter(([name])=>!/^public\.[a-z0-9_]*_session$/.test(name)))}:m[key];if(JSON.stringify(stable(a))!==JSON.stringify(stable(b)))throw Error(`Source changed: ${key}`)}' "$original/manifest.json" "$after/manifest.json"
bash deploy/scripts/smoke.sh "$instance" "$source_project"
echo 'PASS source unchanged: row counts, attachment metadata and object hashes; smoke'
echo "Test payload outside checkout: $root"
