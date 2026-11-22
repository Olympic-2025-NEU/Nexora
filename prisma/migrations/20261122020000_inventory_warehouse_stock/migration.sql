-- SPDX-License-Identifier: AGPL-3.0-only
-- P06-T04/T05: inventory warehouse/balance/movement + membership_warehouse + grants.
-- stock_movement.source_line_id has no FK until P07 trading.document_line.
BEGIN;

CREATE SCHEMA IF NOT EXISTS "inventory";

CREATE TABLE "inventory"."warehouse" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "status" text NOT NULL,
    "created_by_sub" text NOT NULL,
    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "warehouse_code_key" UNIQUE ("code"),
    CONSTRAINT "warehouse_code_len" CHECK (length(trim(code)) BETWEEN 1 AND 40),
    CONSTRAINT "warehouse_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 160),
    CONSTRAINT "warehouse_status_check" CHECK (status IN ('active','archived')),
    CONSTRAINT "warehouse_version_check" CHECK (version > 0)
);

CREATE TABLE "system"."membership_warehouse" (
    "membership_id" uuid NOT NULL,
    "warehouse_id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_warehouse_pkey" PRIMARY KEY ("membership_id", "warehouse_id"),
    CONSTRAINT "membership_warehouse_membership_id_fkey"
        FOREIGN KEY ("membership_id") REFERENCES "system"."membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "membership_warehouse_warehouse_id_fkey"
        FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "membership_warehouse_warehouse_membership_idx"
    ON "system"."membership_warehouse" ("warehouse_id", "membership_id");

CREATE TABLE "inventory"."stock_balance" (
    "warehouse_id" uuid NOT NULL,
    "batch_id" uuid NOT NULL,
    "product_id" uuid NOT NULL,
    "quantity" numeric(20,3) NOT NULL DEFAULT 0,
    "version" integer NOT NULL DEFAULT 1,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("warehouse_id", "batch_id"),
    CONSTRAINT "stock_balance_warehouse_id_fkey"
        FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_balance_batch_product_fkey"
        FOREIGN KEY ("batch_id", "product_id") REFERENCES "catalog"."batch"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_balance_quantity_check" CHECK (quantity >= 0),
    CONSTRAINT "stock_balance_version_check" CHECK (version > 0)
);

CREATE INDEX "stock_balance_product_batch_idx" ON "inventory"."stock_balance" ("product_id", "batch_id");
CREATE INDEX "stock_balance_warehouse_product_idx" ON "inventory"."stock_balance" ("warehouse_id", "product_id");

CREATE TABLE "inventory"."stock_movement" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warehouse_id" uuid NOT NULL,
    "batch_id" uuid NOT NULL,
    "product_id" uuid NOT NULL,
    "source_line_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "delta" numeric(20,3) NOT NULL,
    "balance_after" numeric(20,3) NOT NULL,
    "actor_sub" text NOT NULL,
    "correlation_id" text NOT NULL,
    "reversal_of" uuid,
    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movement_warehouse_id_fkey"
        FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movement_batch_product_fkey"
        FOREIGN KEY ("batch_id", "product_id") REFERENCES "catalog"."batch"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movement_reversal_of_fkey"
        FOREIGN KEY ("reversal_of") REFERENCES "inventory"."stock_movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movement_kind_check" CHECK (kind IN ('receipt','issue','receiving','stocktake')),
    CONSTRAINT "stock_movement_delta_check" CHECK (delta <> 0),
    CONSTRAINT "stock_movement_balance_after_check" CHECK (balance_after >= 0),
    CONSTRAINT "stock_movement_source_kind_key" UNIQUE ("source_line_id", "kind")
);

CREATE INDEX "stock_movement_batch_created_idx"
    ON "inventory"."stock_movement" ("batch_id", "created_at" DESC);
CREATE INDEX "stock_movement_warehouse_batch_created_idx"
    ON "inventory"."stock_movement" ("warehouse_id", "batch_id", "created_at" DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT USAGE ON SCHEMA "inventory" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "inventory"."warehouse" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "inventory"."stock_balance" TO app_runtime;
        GRANT SELECT, INSERT ON "inventory"."stock_movement" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "system"."membership_warehouse" TO app_runtime;
    END IF;
END
$$;

COMMIT;
