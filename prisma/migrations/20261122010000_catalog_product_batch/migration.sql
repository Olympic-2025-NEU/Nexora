-- SPDX-License-Identifier: AGPL-3.0-only
-- P06-T02/T03: catalog.product, product_identifier, batch + app_runtime grants.
BEGIN;

CREATE SCHEMA IF NOT EXISTS "catalog";

CREATE TABLE "catalog"."product" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "sku" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "base_unit" text NOT NULL,
    "status" text NOT NULL DEFAULT 'active',
    "created_by_sub" text NOT NULL,
    CONSTRAINT "product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_sku_key" UNIQUE ("sku"),
    CONSTRAINT "product_sku_len" CHECK (length(trim(sku)) BETWEEN 1 AND 64),
    CONSTRAINT "product_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 200),
    CONSTRAINT "product_base_unit_check" CHECK (base_unit IN ('EA','KG','L')),
    CONSTRAINT "product_status_check" CHECK (status IN ('active','archived')),
    CONSTRAINT "product_version_check" CHECK (version > 0)
);

CREATE INDEX "product_status_name_idx" ON "catalog"."product" ("status", "name");

CREATE TABLE "catalog"."product_identifier" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "value" text NOT NULL,
    "is_primary" boolean NOT NULL DEFAULT false,
    CONSTRAINT "product_identifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_identifier_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_identifier_kind_check" CHECK (kind IN ('ean13','internal_barcode')),
    CONSTRAINT "product_identifier_value_len" CHECK (length(trim(value)) BETWEEN 1 AND 128),
    CONSTRAINT "product_identifier_kind_value_key" UNIQUE ("kind", "value")
);

CREATE UNIQUE INDEX "product_identifier_primary_per_kind"
    ON "catalog"."product_identifier" ("product_id", "kind") WHERE "is_primary";

CREATE TABLE "catalog"."batch" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "product_id" uuid NOT NULL,
    "local_code" text NOT NULL,
    "origin_issuer_instance_id" text NOT NULL,
    "origin_lot_id" text NOT NULL,
    "manufactured_on" date,
    "expires_on" date,
    "quality_status" text NOT NULL DEFAULT 'inspect',
    "source_partner_id" uuid,
    "created_by_sub" text,
    "created_by_client_id" text,
    CONSTRAINT "batch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "batch_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "batch_source_partner_id_fkey"
        FOREIGN KEY ("source_partner_id") REFERENCES "system"."partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "batch_local_code_len" CHECK (length(trim(local_code)) BETWEEN 1 AND 80),
    CONSTRAINT "batch_quality_status_check" CHECK (quality_status IN ('available','restricted','inspect')),
    CONSTRAINT "batch_version_check" CHECK (version > 0),
    CONSTRAINT "batch_actor_xor_check" CHECK (
        (created_by_sub IS NOT NULL) <> (created_by_client_id IS NOT NULL)
    ),
    CONSTRAINT "batch_dates_check" CHECK (
        manufactured_on IS NULL OR expires_on IS NULL OR manufactured_on <= expires_on
    ),
    CONSTRAINT "batch_product_local_code_key" UNIQUE ("product_id", "local_code"),
    CONSTRAINT "batch_origin_key" UNIQUE ("origin_issuer_instance_id", "origin_lot_id"),
    CONSTRAINT "batch_id_product_key" UNIQUE ("id", "product_id")
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT USAGE ON SCHEMA "catalog" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."product" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."product_identifier" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."batch" TO app_runtime;
    END IF;
END
$$;

COMMIT;
