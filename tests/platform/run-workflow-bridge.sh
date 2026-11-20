#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
cd "$(dirname "$0")/../.."
instance="${1:-${FLOWABLE_INSTANCE:-a}}"
project="${2:-${FLOWABLE_PROJECT:-nexora-$instance}}"
node deploy/config.mjs --file "deploy/instances/$instance.env" >/dev/null
bash deploy/scripts/deploy-flowable.sh "$instance" "$project"
docker compose -f deploy/compose.yml --env-file "deploy/instances/$instance.env" -p "$project" run --build --rm db-migrate
FLOWABLE_INSTANCE="$instance" FLOWABLE_PROJECT="$project" node --env-file="deploy/instances/$instance.env" --test --require tsx/cjs tests/platform/workflow-bridge.integration.test.ts
