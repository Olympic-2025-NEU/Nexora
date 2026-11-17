# SPDX-License-Identifier: AGPL-3.0-only
#!/bin/sh
set -eu

for name in POSTGRES_USER POSTGRES_PASSWORD APP_DB_NAME APP_DB_USER APP_DB_PASSWORD CORE_DB_USER CORE_DB_PASSWORD MIGRATOR_DB_USER MIGRATOR_DB_PASSWORD KEYCLOAK_DB_USER KEYCLOAK_DB_PASSWORD KEYCLOAK_DB_NAME FLOWABLE_DB_USER FLOWABLE_DB_PASSWORD FLOWABLE_DB_NAME; do
  eval 'value=${'"$name"'-}'
  [ -n "$value" ] || { printf '%s is required\n' "$name" >&2; exit 1; }
done

for name in POSTGRES_USER APP_DB_NAME APP_DB_USER CORE_DB_USER MIGRATOR_DB_USER KEYCLOAK_DB_USER KEYCLOAK_DB_NAME FLOWABLE_DB_USER FLOWABLE_DB_NAME; do
  eval 'value=${'"$name"'}'
  case "$value" in *[!a-zA-Z0-9_]*|'') printf '%s must be a PostgreSQL identifier\n' "$name" >&2; exit 1;; esac
done
[ "$APP_DB_NAME" != "$KEYCLOAK_DB_NAME" ] && [ "$APP_DB_NAME" != "$FLOWABLE_DB_NAME" ] && [ "$KEYCLOAK_DB_NAME" != "$FLOWABLE_DB_NAME" ] || { printf 'database names must be distinct\n' >&2; exit 1; }
[ "$APP_DB_USER" = app_runtime ] && [ "$CORE_DB_USER" = core_data ] && [ "$MIGRATOR_DB_USER" = migrator ] || { printf 'platform roles must be app_runtime/core_data/migrator\n' >&2; exit 1; }

export PGPASSWORD="$POSTGRES_PASSWORD"
psql -X -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d postgres <<'SQL'
\getenv app_user APP_DB_USER
\getenv app_pass APP_DB_PASSWORD
\getenv core_user CORE_DB_USER
\getenv core_pass CORE_DB_PASSWORD
\getenv migrator_user MIGRATOR_DB_USER
\getenv migrator_pass MIGRATOR_DB_PASSWORD
\getenv kc_user KEYCLOAK_DB_USER
\getenv kc_pass KEYCLOAK_DB_PASSWORD
\getenv flow_user FLOWABLE_DB_USER
\getenv flow_pass FLOWABLE_DB_PASSWORD
\getenv app_db APP_DB_NAME
\getenv kc_db KEYCLOAK_DB_NAME
\getenv flow_db FLOWABLE_DB_NAME

SELECT format('CREATE ROLE %I LOGIN', name) FROM (VALUES (:'app_user'), (:'core_user'), (:'migrator_user'), (:'kc_user'), (:'flow_user')) AS roles(name) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = name) \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', name, password) FROM (VALUES (:'app_user', :'app_pass'), (:'core_user', :'core_pass'), (:'migrator_user', :'migrator_pass'), (:'kc_user', :'kc_pass'), (:'flow_user', :'flow_pass')) AS roles(name, password) \gexec
SELECT format('CREATE DATABASE %I OWNER %I', name, owner) FROM (VALUES (:'app_db', :'migrator_user'), (:'kc_db', :'kc_user'), (:'flow_db', :'flow_user')) AS dbs(name, owner) WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = name) \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', name, owner) FROM (VALUES (:'app_db', :'migrator_user'), (:'kc_db', :'kc_user'), (:'flow_db', :'flow_user')) AS dbs(name, owner) \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', name) FROM (VALUES (:'app_db'), (:'kc_db'), (:'flow_db')) AS dbs(name) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I, %I', :'app_db', :'app_user', :'core_user', :'migrator_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'kc_db', :'kc_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'flow_db', :'flow_user') \gexec
SQL

psql -X -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$APP_DB_NAME" <<'SQL'
\getenv migrator_user MIGRATOR_DB_USER
SELECT format('REVOKE ALL ON SCHEMA public FROM PUBLIC') \gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migrator_user') \gexec
SQL
