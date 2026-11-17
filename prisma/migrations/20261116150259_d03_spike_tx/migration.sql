-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "trading";

-- CreateTable
CREATE TABLE "platform"."spike_audit_log" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."spike_outbox_message" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."spike_stock_balance" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "quantity" DECIMAL(20,3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "spike_stock_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."spike_stock_movement" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "delta" DECIMAL(20,3) NOT NULL,
    "source_document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading"."spike_document" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "quantity" DECIMAL(20,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "spike_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spike_stock_balance_warehouse_id_batch_id_key" ON "inventory"."spike_stock_balance"("warehouse_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "spike_stock_movement_source_document_id_key" ON "inventory"."spike_stock_movement"("source_document_id");
