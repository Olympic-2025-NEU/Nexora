#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
instance=${1:-a}
case "$instance" in a|b|c) ;; *) exit 2;; esac
file="deploy/instances/$instance.env"
node deploy/config.mjs --file "$file" >/dev/null
# Only the local dev realm/clients and object-storage buckets. No production identities.
docker compose -f deploy/compose.yml --env-file "$file" -p "nexora-$instance" run --rm keycloak-bootstrap
docker compose -f deploy/compose.yml --env-file "$file" -p "nexora-$instance" run --rm storage-bootstrap
