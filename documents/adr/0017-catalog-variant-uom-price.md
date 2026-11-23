<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# ADR 0017 — Catalog variant / UOM / price (D17)

- **Status:** Accepted (design) — **2026-11-22**; DDL blocked until Dev **Approves** [`evidence/p065-schema-design.md`](../phase-plan/evidence/p065-schema-design.md)
- **Date:** 2026-11-22
- **Blocks:** P065-T02+ migrations, catalog/inventory API reshape, P07 document lines
- **Related:** D07 (quantity), D14 (movement), D16 (UI surfaces), D17 requirements ([`BRD-product-catalog.md`](../requirements/BRD-product-catalog.md), [`SRS-product-catalog.md`](../requirements/SRS-product-catalog.md)); plan [`phase-06.5-catalog-business-upgrade.md`](../phase-plan/phase-06.5-catalog-business-upgrade.md)
- **Supersedes (target model):** P06 assumption that SKU/`base_unit` live on `catalog.product`

## Context

G06 delivered a minimal product+SKU+`base_unit`∈{EA,KG,L} model sufficient for inventory demos. Business requirements (D17) need: product family without SKU, **product_variant** (mutable sku/barcode), category tree, UOM master with system default **CÁI**, packing factors, commercial **price_list** / items, and stock keyed by **variant**. P07 must not invent a second identity model.

## Decision

### 1. Product vs variant

- `catalog.product`: name, `search_text`, `attributes` JSONB, `category_id` NOT NULL, `is_active`, `deleted_at`, version/audit. **No** `sku`, `barcode`, `base_unit`.
- `catalog.product_variant`: `product_id`, nullable `sku`/`barcode` with CHECK ≥1 non-null, `is_primary`, `is_active`, `deleted_at`. PATCH may change sku/barcode (If-Match + audit).
- Uniqueness **instance-wide including soft-deleted rows**:
  - Partial UNIQUE on non-null `sku`; partial UNIQUE on non-null `barcode`.
  - Cross-field uniqueness via `catalog.variant_code` (`code` PK, `variant_id` FK): every non-null sku and barcode inserts a row; same variant may insert once when `sku = barcode`. Prevents sku(A) = barcode(B).
- At most one active non-deleted primary variant per product (partial unique).

### 2. Category

- `catalog.category` with `parent_id` self-FK, depth ≤ 8 (app + CHECK trigger), no cycles.
- Product filter by category + descendants: **recursive CTE** (no closure table in v1).

### 3. UOM

- `catalog.uom` master; seed system default name `CÁI`, `code`/`name_key`=`CAI`, `is_system_default=true` (exactly one).
- Normalize on write (NFC, VI upper display, accent-stripped `name_key`); conflict → 409.
- `catalog.product_variant_uom`: exactly one `is_stock_keeping`; `factor_to_stock_uom` > 0; stock row factor = 1.
- New variant defaults stock UOM = system `CÁI` unless caller sets another active UOM.
- P06 `base_unit` backfill map: `EA`→`CÁI`; `KG`/`L`→seed UOMs `KG`/`L` (kind mass/volume) and set as stock-keeping for that variant.

### 4. Price

- `catalog.price_list`: `code` NULL = general (`is_default` meaningful; at most one active default among `code IS NULL`); non-null `code` unique; coded lists force `is_default=false`.
- `catalog.price_list_item`: unique `(price_list_id, product_variant_id, uom_id, price_type)`; uom must ∈ variant_uoms; currency/validity inherit list.
- Resolve algorithm per SRS §3. Edits never rewrite movements/confirmed docs. COGS ≠ list `purchase` (P07+ FIFO snapshot).

### 5. Images & identifiers

- `catalog.product_image`: `attachment_id`→`platform.attachment`, sort, primary; no BLOB. `variant_id` deferred (NULL v1).
- `catalog.product_identifier`: **superseded** for SKU/barcode. Migration: primary barcode-ish identifier → `variant.barcode` if empty; then **drop** table (or leave empty deprecated — prefer **DROP** in P065 migrate after backfill).

### 6. Batch / inventory

- Add `catalog.batch.product_variant_id` NOT NULL (after backfill); keep `product_id` denormalized (= variant.product_id) for indexes/FK continuity.
- Unique `(product_variant_id, local_code)` replaces `(product_id, local_code)` as business uniqueness; keep origin pair unique.
- Composite unique `(id, product_variant_id)` for FK from stock.
- `inventory.stock_balance` / `stock_movement`: add `product_variant_id`; FK `(batch_id, product_variant_id)`→batch; retain `product_id` denormalized.
- Quantities always in variant stock-keeping UOM at Inventory port; packing conversion in application before port.

### 7. P07 forward contract

- `trading.document_line` will use `product_variant_id` (+ optional display unit converted server-side). Blueprint P07 updated in same doc set as this ADR; DDL remains P07.

### 8. Policy keys (extend M02)

Reuse `catalog:product:*`. Add: `catalog:category:read|manage`, `catalog:uom:read|manage`, `catalog:price_list:read|manage`. Staff create/manage per matrix; Viewer read.

## Consequences

- G06 remains **CLOSED**; this is intentional upgrade on path **P065 → G06.5 → P07**.
- Empty DB and seeded P06 DB must both migrate (backfill primary variant per product).
- UI/API stop accepting sku on product body; OpenAPI + `api-payloads-v1.md` ship with P065 code.
- Cross-code uniqueness depends on `variant_code` maintained in the same transaction as variant write.

## Compliance

Pack: [`evidence/p065-schema-design.md`](../phase-plan/evidence/p065-schema-design.md).  
Requirements: SRS/BRD product-catalog. Gate: G06.5.
