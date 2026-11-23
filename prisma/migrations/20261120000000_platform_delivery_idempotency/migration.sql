-- SPDX-License-Identifier: AGPL-3.0-only
BEGIN;
CREATE TABLE "platform"."idempotency_record" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_or_client" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route_key" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "state" TEXT NOT NULL,
    "response_status" SMALLINT,
    "response_body" JSONB,
    "resource_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_record_state_check" CHECK ("state" IN ('processing', 'completed', 'failed')),
    CONSTRAINT "idempotency_record_payload_sha256_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "idempotency_record_actor_or_client_method_route_key_idempotency_key_key"
    ON "platform"."idempotency_record"("actor_or_client", "method", "route_key", "idempotency_key");
CREATE INDEX "idempotency_record_expires_at_idx" ON "platform"."idempotency_record"("expires_at");
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."idempotency_record" TO app_runtime;
COMMIT;
