# P06 Schema Design Pack — Catalog & Inventory (M02)

**Status:** Approved for implementation  
**Reviewer:** Owner (plan execute 2026-11-22)  
**SoT:** [`database-schema-v1.md`](../database-schema-v1.md) § P06; D07; [`api-payloads-v1.md`](../api-payloads-v1.md) § M02

## 1. Tables & columns

### `catalog.product`
`id`, `created_at`, `updated_at`, `version`, `sku` UNIQUE ≤64, `name` ≤200, `description?`, `base_unit` CHECK `('EA','KG','L')`, `status` CHECK `('active','archived')` DEFAULT `active`, `created_by_sub`. Index `(status,name)`. SKU + `base_unit` immutable after create.

### `catalog.product_identifier`
`id`, `created_at`, `product_id`→product, `kind` CHECK `('ean13','internal_barcode')`, `value` ≤128, `is_primary` DEFAULT false. UNIQUE `(kind,value)`; partial UNIQUE `(product_id,kind) WHERE is_primary`. No kind=`sku`.

### `catalog.batch`
`id`, timestamps, `version`, `product_id`, `local_code` ≤80, `origin_issuer_instance_id`, `origin_lot_id`, `manufactured_on?`, `expires_on?`, `quality_status` CHECK `('available','restricted','inspect')` DEFAULT `inspect`, `source_partner_id?`→partner, `created_by_sub?`, `created_by_client_id?` with XOR CHECK. UNIQUE `(product_id,local_code)`, `(origin_issuer_instance_id,origin_lot_id)`, `(id,product_id)`. Date CHECK manufactured≤expires when both set.

### `inventory.warehouse`
`id`, timestamps, `version`, `code` UNIQUE ≤40, `name` ≤160, `status` CHECK `('active','archived')`, `created_by_sub`. Archive blocked if any balance quantity > 0 (app rule).

### `system.membership_warehouse`
Composite PK `(membership_id,warehouse_id)`; FKs to membership + warehouse; `created_at`. Index `(warehouse_id,membership_id)`.

### `inventory.stock_balance`
PK `(warehouse_id,batch_id)`; `product_id`; `quantity numeric(20,3) >= 0`; `version`; `updated_at`; composite FK `(batch_id,product_id)`→batch.

### `inventory.stock_movement`
`id`, `created_at`, warehouse/batch/product, `source_line_id uuid NOT NULL` (**no FK until P07**), `kind` CHECK receipt|issue|receiving|stocktake, `delta <> 0`, `balance_after >= 0`, `actor_sub`, `correlation_id`, `reversal_of?`. UNIQUE `(source_line_id,kind)`. Append-only at runtime.

## 2. UOM

v1: **only** `product.base_unit` ∈ {EA, KG, L}. No UOM master table. No unit conversion. EA integral; KG/L ≤3 fraction digits (D07). Reject over-precision before PG round.

## 3. Constraints summary

| Rule | Enforcement |
| --- | --- |
| SKU unique | PG UNIQUE |
| Identifier (kind,value) unique | PG UNIQUE |
| Origin lot pair unique | PG UNIQUE |
| created_by XOR | PG CHECK |
| quantity ≥ 0, delta ≠ 0 | PG CHECK |
| No negative stock | App conditional update + CHECK |
| Idempotent adjust | UNIQUE (source_line_id, kind) |

## 4. GRANT (`app_runtime`)

- `USAGE` on schemas `catalog`, `inventory`
- product, product_identifier, batch, warehouse, membership_warehouse, stock_balance: `SELECT, INSERT, UPDATE`
- stock_movement: `SELECT, INSERT` (no UPDATE/DELETE)
- No `core_data` grants on these tables

## 5. API surface (contract only)

Products, identifiers, batches, quality-actions, warehouses, inventory balances/movements — as `api-payloads-v1.md` M02. No public PATCH balance. Opening: internal `openStockBalance` → movement `kind=receipt` + audit.

## 6. Deviations from blueprint

None for v1 shape. Migration names use Prisma timestamps instead of legend `0004_catalog.sql` / `0005_inventory.sql`.

## Dev checklist

- [x] Product + identifier + base_unit/UOM đủ MVP
- [x] Batch origin identity đúng D07
- [x] Warehouse + membership_warehouse scope
- [x] Stock balance/movement + lock/idempotency
- [x] Opening harness (`receipt` synthetic) accepted
- [x] No trading tables in P06
- [x] Prisma migration names + GRANT pattern accepted

**Approved:** 2026-11-22 — proceed T02–T08.
