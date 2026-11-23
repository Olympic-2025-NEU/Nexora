-- SPDX-License-Identifier: AGPL-3.0-only
-- Disposable integration databases only. Passwords are local test fixtures.
CREATE ROLE migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'test_migrator';
CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'test_app';
CREATE ROLE core_data LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'test_core';

CREATE DATABASE nexora_upgrade OWNER migrator;
CREATE DATABASE nexora_fresh OWNER migrator;
CREATE DATABASE nexora_restore OWNER migrator;

REVOKE ALL ON DATABASE nexora_upgrade, nexora_fresh, nexora_restore FROM PUBLIC;
GRANT CONNECT ON DATABASE nexora_upgrade, nexora_fresh, nexora_restore TO migrator, app_runtime, core_data;

\connect nexora_upgrade
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
\connect nexora_fresh
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
\connect nexora_restore
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
