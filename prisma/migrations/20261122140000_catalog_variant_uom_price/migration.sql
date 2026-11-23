-- SPDX-License-Identifier: AGPL-3.0-only
-- P065-T02/T03: catalog variant/UOM/price + inventory neo product_variant_id + backfill from P06.
BEGIN;

-- ---------------------------------------------------------------------------
-- Masters: category, uom
-- ---------------------------------------------------------------------------
CREATE TABLE "catalog"."category" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "name_normalized" text NOT NULL,
    "parent_id" uuid,
    "sort_order" integer NOT NULL DEFAULT 0,
    "is_active" boolean NOT NULL DEFAULT true,
    "deleted_at" timestamptz(6),
    "created_by_sub" text NOT NULL,
    CONSTRAINT "category_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "category_code_key" UNIQUE ("code"),
    CONSTRAINT "category_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "catalog"."category"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "category_code_len" CHECK (length(trim(code)) BETWEEN 1 AND 64),
    CONSTRAINT "category_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 200),
    CONSTRAINT "category_version_check" CHECK (version > 0),
    CONSTRAINT "category_no_self_parent" CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE "catalog"."uom" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "code" text NOT NULL,
    "name" text NOT NULL,
    "name_key" text NOT NULL,
    "kind" text NOT NULL,
    "is_system_default" boolean NOT NULL DEFAULT false,
    "is_active" boolean NOT NULL DEFAULT true,
    "deleted_at" timestamptz(6),
    CONSTRAINT "uom_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uom_code_key" UNIQUE ("code"),
    CONSTRAINT "uom_name_key_key" UNIQUE ("name_key"),
    CONSTRAINT "uom_kind_check" CHECK (kind IN ('count','mass','volume')),
    CONSTRAINT "uom_code_len" CHECK (length(trim(code)) BETWEEN 1 AND 32),
    CONSTRAINT "uom_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 64),
    CONSTRAINT "uom_version_check" CHECK (version > 0)
);

CREATE UNIQUE INDEX "uom_one_system_default"
    ON "catalog"."uom" ("is_system_default") WHERE "is_system_default";

-- Fixed seed ids (stable across envs)
INSERT INTO "catalog"."uom" ("id","code","name","name_key","kind","is_system_default")
VALUES
  ('aaaaaaaa-0001-4000-8000-000000000001','CAI','CÁI','CAI','count',true),
  ('aaaaaaaa-0001-4000-8000-000000000002','KG','KG','KG','mass',false),
  ('aaaaaaaa-0001-4000-8000-000000000003','L','L','L','volume',false);

INSERT INTO "catalog"."category" ("id","code","name","name_normalized","created_by_sub")
VALUES (
  'bbbbbbbb-0001-4000-8000-000000000001',
  'UNCATEGORIZED',
  'Không phân loại',
  'khong phan loai',
  'system:p065-migration'
);

-- ---------------------------------------------------------------------------
-- Reshape product (add target columns; keep P06 columns until backfill done)
-- ---------------------------------------------------------------------------
ALTER TABLE "catalog"."product"
  ADD COLUMN IF NOT EXISTS "search_text" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "category_id" uuid,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz(6);

UPDATE "catalog"."product" p
SET
  "category_id" = 'bbbbbbbb-0001-4000-8000-000000000001',
  "search_text" = lower(trim(p."name")),
  "attributes" = CASE
    WHEN p."description" IS NOT NULL AND length(trim(p."description")) > 0
      THEN jsonb_build_object('description', p."description")
    ELSE '{}'::jsonb
  END,
  "is_active" = (p."status" = 'active');

ALTER TABLE "catalog"."product"
  ALTER COLUMN "category_id" SET NOT NULL;

ALTER TABLE "catalog"."product"
  ADD CONSTRAINT "product_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "catalog"."category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- product_variant + variant_code + variant_uom + images + price
-- ---------------------------------------------------------------------------
CREATE TABLE "catalog"."product_variant" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "product_id" uuid NOT NULL,
    "sku" text,
    "barcode" text,
    "is_primary" boolean NOT NULL DEFAULT false,
    "is_active" boolean NOT NULL DEFAULT true,
    "deleted_at" timestamptz(6),
    "created_by_sub" text NOT NULL,
    CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variant_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_variant_sku_or_barcode" CHECK (sku IS NOT NULL OR barcode IS NOT NULL),
    CONSTRAINT "product_variant_sku_len" CHECK (sku IS NULL OR length(trim(sku)) BETWEEN 1 AND 64),
    CONSTRAINT "product_variant_barcode_len" CHECK (barcode IS NULL OR length(trim(barcode)) BETWEEN 1 AND 128),
    CONSTRAINT "product_variant_version_check" CHECK (version > 0)
);

CREATE UNIQUE INDEX "product_variant_sku_key"
    ON "catalog"."product_variant" ("sku") WHERE "sku" IS NOT NULL;
CREATE UNIQUE INDEX "product_variant_barcode_key"
    ON "catalog"."product_variant" ("barcode") WHERE "barcode" IS NOT NULL;
CREATE UNIQUE INDEX "product_variant_one_primary"
    ON "catalog"."product_variant" ("product_id")
    WHERE "is_primary" AND "deleted_at" IS NULL AND "is_active";

CREATE TABLE "catalog"."variant_code" (
    "code" text NOT NULL,
    "variant_id" uuid NOT NULL,
    "source" text NOT NULL,
    CONSTRAINT "variant_code_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "variant_code_variant_id_fkey"
        FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "variant_code_source_check" CHECK (source IN ('sku','barcode','both')),
    CONSTRAINT "variant_code_len" CHECK (length(trim(code)) BETWEEN 1 AND 128)
);

CREATE TABLE "catalog"."product_variant_uom" (
    "id" uuid NOT NULL,
    "product_variant_id" uuid NOT NULL,
    "uom_id" uuid NOT NULL,
    "is_stock_keeping" boolean NOT NULL DEFAULT false,
    "factor_to_stock_uom" numeric(20,3) NOT NULL,
    CONSTRAINT "product_variant_uom_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variant_uom_variant_fkey"
        FOREIGN KEY ("product_variant_id") REFERENCES "catalog"."product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_variant_uom_uom_fkey"
        FOREIGN KEY ("uom_id") REFERENCES "catalog"."uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_variant_uom_pair_key" UNIQUE ("product_variant_id", "uom_id"),
    CONSTRAINT "product_variant_uom_factor_check" CHECK (factor_to_stock_uom > 0),
    CONSTRAINT "product_variant_uom_stock_factor_check"
        CHECK ((NOT is_stock_keeping) OR factor_to_stock_uom = 1)
);

CREATE UNIQUE INDEX "product_variant_uom_one_stock"
    ON "catalog"."product_variant_uom" ("product_variant_id") WHERE "is_stock_keeping";

CREATE TABLE "catalog"."product_image" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product_id" uuid NOT NULL,
    "attachment_id" uuid NOT NULL,
    "sort_order" integer NOT NULL DEFAULT 0,
    "is_primary" boolean NOT NULL DEFAULT false,
    "deleted_at" timestamptz(6),
    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_image_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "catalog"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_image_attachment_id_fkey"
        FOREIGN KEY ("attachment_id") REFERENCES "platform"."attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_image_one_primary"
    ON "catalog"."product_image" ("product_id") WHERE "is_primary" AND "deleted_at" IS NULL;

CREATE TABLE "catalog"."price_list" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" integer NOT NULL DEFAULT 1,
    "code" text,
    "name" text NOT NULL,
    "is_default" boolean NOT NULL DEFAULT false,
    "valid_from" timestamptz(6) NOT NULL,
    "valid_to" timestamptz(6),
    "is_active" boolean NOT NULL DEFAULT true,
    "currency" char(3) NOT NULL,
    "deleted_at" timestamptz(6),
    "created_by_sub" text NOT NULL,
    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_list_name_len" CHECK (length(trim(name)) BETWEEN 1 AND 200),
    CONSTRAINT "price_list_code_len" CHECK (code IS NULL OR length(trim(code)) BETWEEN 1 AND 64),
    CONSTRAINT "price_list_default_only_general" CHECK (code IS NULL OR is_default = false),
    CONSTRAINT "price_list_valid_range" CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT "price_list_version_check" CHECK (version > 0)
);

CREATE UNIQUE INDEX "price_list_code_key"
    ON "catalog"."price_list" ("code") WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "price_list_one_default"
    ON "catalog"."price_list" ("is_default")
    WHERE "code" IS NULL AND "is_default" AND "deleted_at" IS NULL AND "is_active";

CREATE TABLE "catalog"."price_list_item" (
    "id" uuid NOT NULL,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price_list_id" uuid NOT NULL,
    "product_variant_id" uuid NOT NULL,
    "uom_id" uuid NOT NULL,
    "price_type" text NOT NULL,
    "amount" numeric(20,3) NOT NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    CONSTRAINT "price_list_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_list_item_list_fkey"
        FOREIGN KEY ("price_list_id") REFERENCES "catalog"."price_list"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "price_list_item_variant_fkey"
        FOREIGN KEY ("product_variant_id") REFERENCES "catalog"."product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "price_list_item_uom_fkey"
        FOREIGN KEY ("uom_id") REFERENCES "catalog"."uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "price_list_item_tuple_key"
        UNIQUE ("price_list_id", "product_variant_id", "uom_id", "price_type"),
    CONSTRAINT "price_list_item_type_check" CHECK (price_type IN ('purchase','retail','wholesale')),
    CONSTRAINT "price_list_item_amount_check" CHECK (amount >= 0)
);

-- ---------------------------------------------------------------------------
-- Backfill: one primary variant per P06 product
-- ---------------------------------------------------------------------------
INSERT INTO "catalog"."product_variant" (
  "id", "product_id", "sku", "barcode", "is_primary", "is_active", "created_by_sub"
)
SELECT
  md5('p065-variant:' || p.id::text)::uuid,
  p.id,
  p.sku,
  (
    SELECT pi.value
    FROM "catalog"."product_identifier" pi
    WHERE pi.product_id = p.id AND pi.is_primary
    ORDER BY pi.created_at ASC
    LIMIT 1
  ),
  true,
  (p.status = 'active'),
  p.created_by_sub
FROM "catalog"."product" p;

-- variant_code registry
INSERT INTO "catalog"."variant_code" ("code", "variant_id", "source")
SELECT upper(trim(v.sku)), v.id,
  CASE WHEN v.barcode IS NOT NULL AND upper(trim(v.barcode)) = upper(trim(v.sku)) THEN 'both' ELSE 'sku' END
FROM "catalog"."product_variant" v
WHERE v.sku IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "catalog"."variant_code" ("code", "variant_id", "source")
SELECT upper(trim(v.barcode)), v.id, 'barcode'
FROM "catalog"."product_variant" v
WHERE v.barcode IS NOT NULL
  AND (v.sku IS NULL OR upper(trim(v.barcode)) <> upper(trim(v.sku)))
ON CONFLICT DO NOTHING;

-- stock UOM from former base_unit
INSERT INTO "catalog"."product_variant_uom" (
  "id", "product_variant_id", "uom_id", "is_stock_keeping", "factor_to_stock_uom"
)
SELECT
  md5('p065-vuom:' || v.id::text)::uuid,
  v.id,
  CASE p.base_unit
    WHEN 'EA' THEN 'aaaaaaaa-0001-4000-8000-000000000001'::uuid
    WHEN 'KG' THEN 'aaaaaaaa-0001-4000-8000-000000000002'::uuid
    WHEN 'L'  THEN 'aaaaaaaa-0001-4000-8000-000000000003'::uuid
  END,
  true,
  1
FROM "catalog"."product_variant" v
JOIN "catalog"."product" p ON p.id = v.product_id;

-- ---------------------------------------------------------------------------
-- Batch + stock → product_variant_id
-- ---------------------------------------------------------------------------
ALTER TABLE "catalog"."batch"
  ADD COLUMN IF NOT EXISTS "product_variant_id" uuid;

UPDATE "catalog"."batch" b
SET "product_variant_id" = v.id
FROM "catalog"."product_variant" v
WHERE v.product_id = b.product_id AND v.is_primary;

ALTER TABLE "catalog"."batch"
  ALTER COLUMN "product_variant_id" SET NOT NULL;

ALTER TABLE "catalog"."batch"
  ADD CONSTRAINT "batch_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "catalog"."product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catalog"."batch"
  ADD CONSTRAINT "batch_variant_local_code_key" UNIQUE ("product_variant_id", "local_code");

ALTER TABLE "catalog"."batch"
  ADD CONSTRAINT "batch_id_variant_key" UNIQUE ("id", "product_variant_id");

-- Drop stock FKs to (batch, product); add variant columns; re-FK
ALTER TABLE "inventory"."stock_balance"
  DROP CONSTRAINT "stock_balance_batch_product_fkey";
ALTER TABLE "inventory"."stock_movement"
  DROP CONSTRAINT "stock_movement_batch_product_fkey";

ALTER TABLE "inventory"."stock_balance"
  ADD COLUMN IF NOT EXISTS "product_variant_id" uuid;
ALTER TABLE "inventory"."stock_movement"
  ADD COLUMN IF NOT EXISTS "product_variant_id" uuid;

UPDATE "inventory"."stock_balance" sb
SET "product_variant_id" = b.product_variant_id
FROM "catalog"."batch" b
WHERE b.id = sb.batch_id;

UPDATE "inventory"."stock_movement" sm
SET "product_variant_id" = b.product_variant_id
FROM "catalog"."batch" b
WHERE b.id = sm.batch_id;

ALTER TABLE "inventory"."stock_balance"
  ALTER COLUMN "product_variant_id" SET NOT NULL;
ALTER TABLE "inventory"."stock_movement"
  ALTER COLUMN "product_variant_id" SET NOT NULL;

ALTER TABLE "inventory"."stock_balance"
  ADD CONSTRAINT "stock_balance_batch_variant_fkey"
    FOREIGN KEY ("batch_id", "product_variant_id")
    REFERENCES "catalog"."batch"("id", "product_variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory"."stock_movement"
  ADD CONSTRAINT "stock_movement_batch_variant_fkey"
    FOREIGN KEY ("batch_id", "product_variant_id")
    REFERENCES "catalog"."batch"("id", "product_variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "stock_balance_variant_batch_idx"
  ON "inventory"."stock_balance" ("product_variant_id", "batch_id");
CREATE INDEX "stock_balance_warehouse_variant_idx"
  ON "inventory"."stock_balance" ("warehouse_id", "product_variant_id");

-- ---------------------------------------------------------------------------
-- Drop superseded P06 product columns / identifier table
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "catalog"."product_status_name_idx";
ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "product_sku_key";
ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "product_sku_len";
ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "product_base_unit_check";
ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "product_status_check";
ALTER TABLE "catalog"."product" DROP COLUMN IF EXISTS "sku";
ALTER TABLE "catalog"."product" DROP COLUMN IF EXISTS "description";
ALTER TABLE "catalog"."product" DROP COLUMN IF EXISTS "base_unit";
ALTER TABLE "catalog"."product" DROP COLUMN IF EXISTS "status";

CREATE INDEX "product_active_name_idx"
  ON "catalog"."product" ("is_active", "name") WHERE "deleted_at" IS NULL;

DROP TABLE IF EXISTS "catalog"."product_identifier";

-- Default price list (empty items; seed script may add)
INSERT INTO "catalog"."price_list" (
  "id","code","name","is_default","valid_from","currency","created_by_sub"
) VALUES (
  'cccccccc-0001-4000-8000-000000000001',
  NULL,
  'Bảng giá chung',
  true,
  CURRENT_TIMESTAMP,
  'VND',
  'system:p065-migration'
);

-- ---------------------------------------------------------------------------
-- GRANTs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT USAGE ON SCHEMA "catalog" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."category" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."uom" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."product" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."product_variant" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog"."variant_code" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."product_variant_uom" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."product_image" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."price_list" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."price_list_item" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "catalog"."batch" TO app_runtime;
        GRANT SELECT, INSERT, UPDATE ON "inventory"."stock_balance" TO app_runtime;
        GRANT SELECT, INSERT ON "inventory"."stock_movement" TO app_runtime;
    END IF;
END
$$;

COMMIT;
