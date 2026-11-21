-- SPDX-License-Identifier: AGPL-3.0-only
-- P05 follow-up: app_runtime needs write on org (PATCH) and partner tables (CRUD).
-- P02 left organization SELECT-only and partner tables ungranted.
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT SELECT, UPDATE ON "system"."organization" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "system"."partner" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "system"."partner_connection" TO app_runtime;
    END IF;
END
$$;

COMMIT;
