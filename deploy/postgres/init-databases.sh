#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Creates Keycloak + Flowable databases/roles on first volume init.
# App DB is POSTGRES_DB (owned by POSTGRES_USER). Prisma Migrate runs later (P01-T03).
set -euo pipefail

create_role_and_db() {
  local role="$1"
  local pass="$2"
  local db="$3"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} LOGIN PASSWORD '${pass}';
      END IF;
    END
    \$\$;
EOSQL

  local exists
  exists="$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'")"
  if [ "$exists" != "1" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      -c "CREATE DATABASE ${db} OWNER ${role};"
  fi
}

create_role_and_db "$KEYCLOAK_DB_USER" "$KEYCLOAK_DB_PASSWORD" "$KEYCLOAK_DB_NAME"
create_role_and_db "$FLOWABLE_DB_USER" "$FLOWABLE_DB_PASSWORD" "$FLOWABLE_DB_NAME"
