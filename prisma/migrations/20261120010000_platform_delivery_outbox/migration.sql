-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE "platform"."outbox_message" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "destination" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "lease_owner" TEXT,
    "lease_until" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_message_status_check" CHECK ("status" IN ('pending','leased','retry_due','delivered','dead_letter')),
    CONSTRAINT "outbox_message_attempt_count_check" CHECK ("attempt_count" >= 0)
);
CREATE UNIQUE INDEX "outbox_message_aggregate_type_aggregate_id_aggregate_version_event_type_destination_key"
    ON "platform"."outbox_message"("aggregate_type", "aggregate_id", "aggregate_version", "event_type", "destination");
CREATE INDEX "outbox_message_due_idx" ON "platform"."outbox_message"("next_attempt_at", "created_at")
    WHERE "status" IN ('pending','retry_due');
CREATE INDEX "outbox_message_correlation_id_idx" ON "platform"."outbox_message"("correlation_id");
GRANT SELECT, INSERT, UPDATE ON "platform"."outbox_message" TO app_runtime;
COMMIT;
