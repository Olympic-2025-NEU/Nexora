-- SPDX-License-Identifier: AGPL-3.0-only
-- Prisma Migrate baseline; schema-v1 platform tables (P01-T03).
BEGIN;
CREATE SCHEMA IF NOT EXISTS "platform";

CREATE TABLE "platform"."audit_log" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_sub" TEXT,
    "client_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "correlation_id" TEXT,
    "before_summary" JSONB NOT NULL DEFAULT '{}',
    "after_summary" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_log_actor_check" CHECK ("actor_sub" IS NOT NULL OR "client_id" IS NOT NULL),
    CONSTRAINT "audit_log_action_check" CHECK (length(trim("action")) BETWEEN 1 AND 100),
    CONSTRAINT "audit_log_target_type_check" CHECK (length(trim("target_type")) BETWEEN 1 AND 80),
    CONSTRAINT "audit_log_target_id_check" CHECK (length(trim("target_id")) BETWEEN 1 AND 128),
    CONSTRAINT "audit_log_request_id_check" CHECK (length("request_id") BETWEEN 1 AND 128),
    CONSTRAINT "audit_log_outcome_check" CHECK ("outcome" IN ('success', 'deny', 'failure'))
);

CREATE TABLE "platform"."attachment" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256_hex" CHAR(64) NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "scan_state" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "created_by_sub" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(6),
    "scan_engine_version" TEXT,
    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attachment_version_check" CHECK ("version" > 0),
    CONSTRAINT "attachment_owner_type_check" CHECK ("owner_type" IN ('document', 'batch', 'trace_event', 'core_record')),
    CONSTRAINT "attachment_bucket_check" CHECK ("bucket" IN ('quarantine', 'private', 'public')),
    CONSTRAINT "attachment_sha256_check" CHECK ("sha256_hex" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "attachment_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "attachment_scan_state_check" CHECK ("scan_state" IN ('pending', 'clean', 'infected', 'error')),
    CONSTRAINT "attachment_visibility_check" CHECK ("visibility" IN ('private', 'partner', 'public'))
);

CREATE TABLE "platform"."core_record" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "policy_version" TEXT NOT NULL,
    "checksum_hex" CHAR(64) NOT NULL,
    "built_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "core_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "core_record_version_check" CHECK ("version" > 0),
    CONSTRAINT "core_record_kind_check" CHECK ("kind" IN ('evidence_metadata', 'trace_projection', 'ot_reading', 'archive_manifest')),
    CONSTRAINT "core_record_source_type_check" CHECK (length(trim("source_type")) BETWEEN 1 AND 80),
    CONSTRAINT "core_record_source_id_check" CHECK (length(trim("source_id")) BETWEEN 1 AND 256),
    CONSTRAINT "core_record_visibility_check" CHECK ("visibility" IN ('private', 'partner', 'public')),
    CONSTRAINT "core_record_checksum_check" CHECK ("checksum_hex" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "audit_log_target_type_target_id_created_at_idx" ON "platform"."audit_log"("target_type", "target_id", "created_at" DESC);
CREATE INDEX "audit_log_request_id_idx" ON "platform"."audit_log"("request_id");
CREATE INDEX "audit_log_created_at_idx" ON "platform"."audit_log"("created_at" DESC);
CREATE INDEX "attachment_owner_type_owner_id_idx" ON "platform"."attachment"("owner_type", "owner_id");
CREATE INDEX "attachment_scan_state_created_at_idx" ON "platform"."attachment"("scan_state", "created_at");
CREATE UNIQUE INDEX "attachment_bucket_object_key_key" ON "platform"."attachment"("bucket", "object_key");
CREATE INDEX "core_record_kind_built_at_idx" ON "platform"."core_record"("kind", "built_at" DESC);
CREATE UNIQUE INDEX "core_record_kind_source_type_source_id_key" ON "platform"."core_record"("kind", "source_type", "source_id");

GRANT USAGE ON SCHEMA "platform" TO app_runtime, core_data;
GRANT SELECT ON "platform"."audit_log" TO app_runtime;
GRANT INSERT ON "platform"."audit_log" TO app_runtime;
GRANT SELECT ON "platform"."attachment", "platform"."core_record" TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON "platform"."attachment", "platform"."core_record" TO core_data;
COMMIT;
