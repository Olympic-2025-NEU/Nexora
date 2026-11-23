-- SPDX-License-Identifier: AGPL-3.0-only
-- P065: variant_code sync uses DELETE; grant app_runtime DELETE on registry table.
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog"."variant_code" TO app_runtime;
    END IF;
END
$$;

COMMIT;
