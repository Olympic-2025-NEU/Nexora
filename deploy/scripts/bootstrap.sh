# SPDX-License-Identifier: AGPL-3.0-only
set -eu
cd "$(dirname "$0")/../.."
instance="${1:-a}"
case "$instance" in a|b|c) ;; *) >&2 printf '%s\n' 'Choose instance a, b, or c'; exit 1;; esac
project="${2:-nexora-$instance}"
node deploy/scripts/prepare.mjs "$instance"
node deploy/config.mjs --file "deploy/instances/$instance.env"
docker compose -f deploy/compose.yml --env-file "deploy/instances/$instance.env" -p "$project" --profile apps config -q
printf '%s\n' "Ready: docker compose -f deploy/compose.yml --env-file deploy/instances/$instance.env -p $project --profile apps up -d --build"
