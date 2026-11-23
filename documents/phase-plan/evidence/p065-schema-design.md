<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# P065 Schema Design Pack — Catalog business upgrade (D17 / ADR 0017)

**Status:** Approved for implementation  
**Reviewer:** Owner (plan execute 2026-11-22)  
**Author:** Agent (P065-T01) — 2026-11-22  
**ADR:** [`0017-catalog-variant-uom-price.md`](../../adr/0017-catalog-variant-uom-price.md)  
**SoT:** [`SRS-product-catalog.md`](../../requirements/SRS-product-catalog.md); blueprint updates in [`database-schema-v1.md`](../database-schema-v1.md) § P065; [`api-payloads-v1.md`](../api-payloads-v1.md) § M02 delta  
**Phase:** [`phase-06.5-catalog-business-upgrade.md`](../phase-06.5-catalog-business-upgrade.md)

## 0. Review ask

Dev: duyệt shape bảng, CHECK/unique, backfill P06→variant, inventory FK, GRANT. Sau **Approved**, ghi ngày/reviewer bên dưới và mở P065-T02.

---

## 1. New / reshaped tables

### `catalog.category`

| Column | Type / rule |
| --- | --- |
| id | uuid PK |
| created_at / updated_at / version | platform norms |
| code | text ≤64 UNIQUE; immutable after create (app) |
| name | text ≤200 NOT NULL |
| name_normalized | text NOT NULL (backend) |
| parent_id | uuid? → category.id; CHECK ≠ id |
| sort_order | int NOT NULL DEFAULT 0 |
| is_active | boolean NOT NULL DEFAULT true |
| deleted_at | timestamptz? |
| created_by_sub | text NOT NULL |

Depth ≤ 8 + no cycles: application + optional BEFORE trigger. Block soft-delete/deactivate if active children or products reference.

### `catalog.uom`

| Column | Type / rule |
| --- | --- |
| id | uuid PK |
| code | text ≤32 UNIQUE (= name_key) |
| name | text ≤64 NOT NULL (display, e.g. `CÁI`) |
| name_key | text ≤32 UNIQUE (ASCII upper, no diacritics) |
| kind | text CHECK IN (`count`,`mass`,`volume`) |
| is_system_default | boolean NOT NULL DEFAULT false |
| is_active | boolean NOT NULL DEFAULT true |
| deleted_at | timestamptz? |
| created_at / updated_at / version | |

Partial UNIQUE: `(is_system_default) WHERE is_system_default` — exactly one true. Seed: `CÁI` / `CAI` / count / system. Also seed `KG`, `L` for P06 backfill. System row: no delete; no change `code`/`is_system_default`.

### `catalog.product` (reshape)

**Drop/stop using:** `sku`, `base_unit`, `description` (move into `attributes`), `status` enum → replace with `is_active` + `deleted_at`.

| Column | Type / rule |
| --- | --- |
| id | keep |
| name | ≤200 NOT NULL |
| search_text | text NOT NULL DEFAULT '' |
| attributes | jsonb NOT NULL DEFAULT `{}` |
| category_id | uuid NOT NULL → category (migration: create seed category `UNCATEGORIZED` / `KHONG_PHAN_LOAI` then backfill) |
| is_active | boolean NOT NULL DEFAULT true |
| deleted_at | timestamptz? |
| created_by_sub | keep |
| version / timestamps | keep |

Index: `(is_active, name)` where `deleted_at IS NULL`; GIN/trigram optional later — v1 `ILIKE` / normalized `search_text` + variant codes.

### `catalog.product_variant`

| Column | Type / rule |
| --- | --- |
| id | uuid PK |
| product_id | uuid NOT NULL → product |
| sku | text? ≤64 |
| barcode | text? ≤128 |
| is_primary | boolean NOT NULL DEFAULT false |
| is_active | boolean NOT NULL DEFAULT true |
| deleted_at | timestamptz? |
| version / timestamps / created_by_sub | |

CHECK `(sku IS NOT NULL OR barcode IS NOT NULL)`.  
Partial UNIQUE `(sku) WHERE sku IS NOT NULL`.  
Partial UNIQUE `(barcode) WHERE barcode IS NOT NULL`.  
Partial UNIQUE `(product_id) WHERE is_primary AND deleted_at IS NULL AND is_active`.

### `catalog.variant_code` (cross-field uniqueness)

| Column | Type / rule |
| --- | --- |
| code | text PK (normalized upper; same normalize as search key for codes) |
| variant_id | uuid NOT NULL → product_variant ON DELETE CASCADE |
| source | text CHECK IN (`sku`,`barcode`,`both`) |

Write path: on insert/update variant, upsert registry rows in same TX. When `sku = barcode`, one row `source=both`. Soft-delete variant **keeps** registry rows → codes not reused.

### `catalog.product_variant_uom`

| Column | Type / rule |
| --- | --- |
| id | uuid PK (or composite PK variant+uom) |
| product_variant_id | uuid → variant |
| uom_id | uuid → uom |
| is_stock_keeping | boolean NOT NULL |
| factor_to_stock_uom | numeric(20,3) NOT NULL CHECK > 0 |

UNIQUE `(product_variant_id, uom_id)`.  
Partial UNIQUE `(product_variant_id) WHERE is_stock_keeping`.  
CHECK: if `is_stock_keeping` then `factor_to_stock_uom = 1`.

### `catalog.product_image`

`id`, `product_id`, `attachment_id`→`platform.attachment`, `sort_order`, `is_primary`, `deleted_at`, timestamps. Partial unique primary per product. No BLOB.

### `catalog.price_list`

| Column | Type / rule |
| --- | --- |
| id | uuid PK |
| code | text? ≤64 — UNIQUE where NOT NULL |
| name | text ≤200 NOT NULL |
| is_default | boolean NOT NULL DEFAULT false |
| valid_from | timestamptz NOT NULL |
| valid_to | timestamptz? |
| is_active | boolean NOT NULL DEFAULT true |
| currency | char(3) NOT NULL (ISO) |
| deleted_at | timestamptz? |
| version / timestamps / created_by_sub | |

CHECK: `(code IS NULL) OR (is_default = false)`.  
CHECK: `valid_to IS NULL OR valid_to > valid_from`.  
Partial UNIQUE: one default among general lists — `(is_default) WHERE code IS NULL AND is_default AND deleted_at IS NULL AND is_active` (or equivalent).

### `catalog.price_list_item`

`id`, `price_list_id`, `product_variant_id`, `uom_id`, `price_type` CHECK IN (`purchase`,`retail`,`wholesale`), `amount numeric(20,3) NOT NULL CHECK >= 0`, `is_active` DEFAULT true, timestamps.  
UNIQUE `(price_list_id, product_variant_id, uom_id, price_type)`.  
App/FK: uom must exist in `product_variant_uom` for that variant (trigger or app 422).

### Drop

- `catalog.product_identifier` after barcode backfill (ADR 0017).

---

## 2. Batch / inventory delta

### `catalog.batch`

Add `product_variant_id uuid NOT NULL` → `product_variant`.  
Keep `product_id` (= variant.product_id; enforce app/trigger).  
UNIQUE `(product_variant_id, local_code)`; keep origin unique; UNIQUE `(id, product_variant_id)` for stock FK.  
Deprecate UNIQUE `(product_id, local_code)` after cutover (or keep as redundant if product_id still set).

### `inventory.stock_balance`

Add `product_variant_id uuid NOT NULL`.  
FK `(batch_id, product_variant_id)`→`batch(id, product_variant_id)`.  
Keep `product_id` denormalized. PK remains `(warehouse_id, batch_id)`.

### `inventory.stock_movement`

Same: add `product_variant_id`; FK composite; keep append-only GRANT.

---

## 3. Backfill algorithm (P06 → P065)

Order in one or chained Prisma migrations (T02/T03):

1. Create `category`, `uom` (+ seed CÁI, KG, L), empty variant/price tables.
2. Insert seed category `KHONG_PHAN_LOAI` (`UNCATEGORIZED`).
3. For each `product`:
   - Set `category_id` = seed; `attributes` = `{ description }` if description; `is_active` = (status=`active`); `search_text` from name; drop sku/base_unit columns **after** step 4–5.
4. Insert primary `product_variant`: `sku` = product.sku; `barcode` = primary identifier value if kind barcode/ean13 else null; if both null impossible (sku always existed).
5. Insert `variant_code` rows; insert stock `product_variant_uom` mapped from `base_unit` (EA→CÁI, KG→KG, L→L).
6. Set `batch.product_variant_id` = that product’s primary variant; update balances/movements.
7. Drop `product.sku`, `product.base_unit`, `product.description`, `product.status` (or map status→is_active already); drop `product_identifier`.

Empty DB: seed only (CÁI, uncategorized, optional demo product in seed script T08).

---

## 4. Constraints summary

| Rule | Enforcement |
| --- | --- |
| sku/barcode ≥1 | CHECK |
| sku unique / barcode unique | partial UNIQUE |
| cross-field code unique | `variant_code` PK |
| one primary / product | partial UNIQUE |
| one stock UOM / variant | partial UNIQUE + factor=1 CHECK |
| one system default UOM | partial UNIQUE |
| one default general price list | partial UNIQUE |
| coded list not default | CHECK |
| soft-deleted codes not reused | keep rows + registry |
| quantity D07 | numeric(20,3); port in stock UOM |

---

## 5. GRANT (`app_runtime`)

- `USAGE` on `catalog`, `inventory` (unchanged).
- New catalog tables: `SELECT, INSERT, UPDATE` (no DELETE preferred; soft-delete via UPDATE).
- `stock_movement`: still `SELECT, INSERT` only.
- No `core_data` grants.

---

## 6. API surface (contract)

See `api-payloads-v1.md` M02 delta: products without sku; variants; categories; uoms; variant uoms; price-lists/items; images via attachment id. Errors: `SKU_BARCODE_CONFLICT`, `UOM_NORMALIZE_CONFLICT`, `LAST_PRIMARY_VARIANT`, `CATEGORY_HAS_CHILDREN`, `PRICE_LIST_DEFAULT_EXISTS`.

---

## 7. Deviations / explicit non-goals in pack

- No closure table for category.
- No per-item price validity/currency.
- No WAC; FIFO org default noted for P07 (org column optional later).
- `product_identifier` removed rather than kept as parallel SoT.

---

## Dev checklist

- [x] Category tree + product FK + CTE filter accepted
- [x] Variant + `variant_code` uniqueness matrix accepted
- [x] UOM + CÁI system default + normalize accepted
- [x] `product_variant_uom` stock-keeping invariant accepted
- [x] price_list / item shape + default unique accepted
- [x] Batch/stock → `product_variant_id` + denormalized `product_id` accepted
- [x] P06 backfill (sku→variant, EA→CÁI, drop identifier) accepted
- [x] GRANT pattern accepted
- [x] No trading DDL in P065 (P07 lines contract-only)

**Approved:** 2026-11-22 — Owner — proceed T02–T08.
