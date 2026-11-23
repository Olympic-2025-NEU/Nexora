#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
container="nexora-p07-trading-$$-$RANDOM"
network="${container}-net"
engine="${container}-flowable"
cleanup() {
  docker rm -f "$engine" "$container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run --rm -d --name "$container" --network "$network" --network-alias postgres \
  -e POSTGRES_PASSWORD=test_admin -p 127.0.0.1::5432 \
  postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929 >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -d postgres \
  < tests/platform/bootstrap.sql >/dev/null
docker exec "$container" psql -X -U postgres -d postgres -c 'CREATE DATABASE flowable' >/dev/null
port="$(docker port "$container" 5432/tcp | cut -d: -f2)"
export NEXORA_TEST_DB=1
export OWNER_DATABASE_URL="postgresql://migrator:test_migrator@127.0.0.1:$port/nexora_fresh"
export DATABASE_URL="$OWNER_DATABASE_URL"
npx prisma migrate deploy
docker run --rm -d --name "$engine" --network "$network" -p 127.0.0.1::8080 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/flowable \
  -e SPRING_DATASOURCE_USERNAME=postgres -e SPRING_DATASOURCE_PASSWORD=test_admin \
  -e FLOWABLE_DATABASE_SCHEMA_UPDATE=true \
  -e FLOWABLE_REST_APP_ADMIN_USER_ID=fixture-approver \
  -e FLOWABLE_REST_APP_ADMIN_PASSWORD=fixture-password \
  -e FLOWABLE_REST_APP_CREATE_DEMO_DEFINITIONS=false \
  flowable/flowable-rest:8.0.0@sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d >/dev/null
export FLOWABLE_HOST_PORT="$(docker port "$engine" 8080/tcp | cut -d: -f2)"
export FLOWABLE_BASE_URL="http://127.0.0.1:$FLOWABLE_HOST_PORT/flowable-rest/service"
export FLOWABLE_ADMIN_USER=fixture-approver FLOWABLE_ADMIN_PASSWORD=fixture-password
ready=0
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 2 -u "$FLOWABLE_ADMIN_USER:$FLOWABLE_ADMIN_PASSWORD" \
    "$FLOWABLE_BASE_URL/management/engine" -o /dev/null 2>/dev/null; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
curl -fsS --max-time 60 -u "$FLOWABLE_ADMIN_USER:$FLOWABLE_ADMIN_PASSWORD" \
  -F 'deploymentName=fixture-goods-issue' \
  -F 'file=@deploy/flowable/processes/goods-issue-approval.bpmn20.xml;type=application/xml' \
  "$FLOWABLE_BASE_URL/repository/deployments" -o /dev/null
export DATABASE_URL="postgresql://app_runtime:test_app@127.0.0.1:$port/nexora_fresh"
node --test --require tsx/cjs tests/platform/trading-documents.integration.test.ts
