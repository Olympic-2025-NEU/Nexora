#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
pg="nexora-p03-scan-pg-$$-$RANDOM"
s3="nexora-p03-scan-s3-$$-$RANDOM"
clam="nexora-p03-scan-clam-$$-$RANDOM"
volume="nexora-p03-scan-volume-$$-$RANDOM"
cleanup() {
  docker rm -f "$clam" "$s3" "$pg" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null
MSYS_NO_PATHCONV=1 docker create --name "$s3" -p 127.0.0.1::8333 \
  --mount "type=volume,source=$volume,target=/data" \
  chrislusf/seaweedfs:4.53@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0 \
  mini -dir=/data -ip.bind=0.0.0.0 -s3.config=/tmp/test-s3.json \
  -bucket=nexora-t04-quarantine,nexora-t04-private,nexora-t04-public >/dev/null
MSYS_NO_PATHCONV=1 docker cp tests/platform/files-s3-config.json "$s3:/tmp/test-s3.json"
docker start "$s3" >/dev/null
docker run --rm -d --name "$pg" -e POSTGRES_PASSWORD=test_admin -p 127.0.0.1::5432 \
  postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929 >/dev/null
docker run --rm -d --name "$clam" -p 127.0.0.1::3310 \
  clamav/clamav:1.4@sha256:4cc4350d3fded380caf1799e76c0d1c93f3fa40af99c0cb2862ec0c9b117718a >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$pg" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$pg" pg_isready -U postgres >/dev/null

pg_port="$(docker port "$pg" 5432/tcp | sed -n 's/.*://p')"
s3_port="$(docker port "$s3" 8333/tcp | sed -n 's/.*://p')"
clam_port="$(docker port "$clam" 3310/tcp | sed -n 's/.*://p')"
test -n "$pg_port" && test -n "$s3_port" && test -n "$clam_port"
docker exec -i "$pg" psql -X -U postgres -v ON_ERROR_STOP=1 -d postgres \
  < tests/platform/bootstrap.sql >/dev/null

export NEXORA_TEST_SCAN=1
export DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$pg_port/nexora_fresh"
export CORE_DATABASE_URL="postgresql://core_data:test_core@127.0.0.1:$pg_port/nexora_fresh"
export S3_ENDPOINT="http://127.0.0.1:$s3_port"
export S3_ACCESS_KEY="core-t04-test-access"
export S3_SECRET_KEY="core-t04-test-secret"
export S3_SCANNER_ACCESS_KEY="scanner-t05-test-access"
export S3_SCANNER_SECRET_KEY="scanner-t05-test-secret"
export S3_BUCKET_QUARANTINE="nexora-t04-quarantine"
export S3_BUCKET_PRIVATE="nexora-t04-private"
export S3_BUCKET_PUBLIC="nexora-t04-public"
export S3_REGION="us-east-1"
export CLAMAV_HOST="127.0.0.1"
export CLAMAV_PORT="$clam_port"
npx prisma migrate deploy
node --test tests/platform/scan.integration.test.mjs
