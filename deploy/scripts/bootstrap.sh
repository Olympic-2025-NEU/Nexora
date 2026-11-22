# SPDX-License-Identifier: AGPL-3.0-only
set -eu
cd "$(dirname "$0")/../.."
instance="${1:-a}"
case "$instance" in a|b|c) ;; *) >&2 printf '%s\n' 'Choose instance a, b, or c'; exit 1;; esac
project="${2:-nexora}"
node deploy/scripts/prepare.mjs "$instance"
node deploy/config.mjs --file "deploy/instances/$instance.env"
node deploy/scripts/render-apisix-routes.mjs "deploy/instances/$instance.env"
mkdir -p deploy/certs
touch deploy/certs/.gitkeep
docker compose -f deploy/compose.yml --env-file "deploy/instances/$instance.env" -p "$project" --profile apps config -q
printf '%s\n' "Ready: docker compose -f deploy/compose.yml --env-file deploy/instances/$instance.env -p $project --profile apps up -d --build && bash deploy/scripts/deploy-flowable.sh $instance $project"
