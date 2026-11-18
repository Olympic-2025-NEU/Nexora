-- SPDX-License-Identifier: AGPL-3.0-only
-- P03-T01: core-data must append its own audit entries without mutation rights.
-- The P01 baseline is already deployed and must remain immutable.
BEGIN;

ALTER TABLE "platform"."audit_log"
    ADD CONSTRAINT "audit_log_correlation_id_check"
    CHECK ("correlation_id" IS NULL OR length("correlation_id") <= 128);

GRANT SELECT, INSERT ON "platform"."audit_log" TO core_data;
REVOKE UPDATE, DELETE, TRUNCATE ON "platform"."audit_log" FROM app_runtime, core_data;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "platform"."attachment", "platform"."core_record" FROM app_runtime;

COMMIT;
