# Phase 06 — M02 Catalog & Inventory

**Mục tiêu:** master data lô/kho và sổ tồn chính xác, cung cấp Inventory port cho M03. **Phụ thuộc:** G03–G05, D07. **Unblock:** nhập/xuất ở P07, trace. **AC:** AC-03 kết thúc khi phiếu nhập P07 đã tăng tồn thật.

**Cổng schema:** Dev phải check & duyệt gói [`evidence/p06-schema-design.md`](./evidence/p06-schema-design.md) trước khi apply migration catalog/inventory / API ERP. T01 quantity (không DDL) được làm song song.

**Migration (Prisma, không legacy `0004`/`0005` SQL):**
- `prisma/migrations/…_catalog_product_batch/` — schema `catalog` + product/identifier/batch + GRANT `app_runtime`
- `prisma/migrations/…_inventory_warehouse_stock/` — schema `inventory` + warehouse/balance/movement + `system.membership_warehouse` + GRANT
- Seed: `deploy/scripts/seed-catalog.mjs` (không `UPDATE stock_balance` bằng SQL; opening qua `openStockBalance` harness → movement `receipt`)

## P06-T01 — Chốt quy tắc định lượng và định danh

- [x] ADR D07 có ví dụ hàng chiếc/hàng cân, đơn vị cơ sở, precision/scale; decimal string / Prisma.Decimal ở biên, `numeric` trong PG; không dùng JS float cho balance.
- [x] Uniqueness SKU/barcode trong instance; batch `(product_id,local_code)` và `(origin_issuer_instance_id,origin_lot_id)`.
- [x] Fixture kiểm 0, âm, quá precision, overflow, EA non-integer.
- **Đầu ra:** `contexts/catalog/domain/quantity.ts` + unit tests; **kiểm chứng:** input sai không ghi DB.

## P06-T02 — Product/SKU và identifiers

- [x] Migration `catalog.product`/`product_identifier`; active/archived, SKU unique, barcode uniqueness, `base_unit` EA|KG|L.
- [x] API create/update/list/search; archive không xóa; SKU/`baseUnit` bất biến.
- [x] UI product; quyền Admin/Staff theo matrix.
- **Đầu ra:** product module PG/API/UI.

## P06-T03 — Batch/lô với nguồn gốc

- [x] Migration `catalog.batch` (cùng catalog migration); quality `available|restricted|inspect`.
- [x] Tạo batch local (server gán origin); quality-actions + audit; partner batch = P09.
- [x] API/UI list/filter; restricted/inspect/expired chặn issue ở Inventory port.
- **Đầu ra:** batch module.

## P06-T04 — Warehouse và phạm vi quyền

- [x] Migration warehouse + `system.membership_warehouse`; balance gắn warehouse+batch.
- [x] Scope: Admin toàn instance; Staff/Approver/Viewer từ join; archived không nhận movement mới.
- [x] API/UI warehouses; archive chặn nếu còn balance > 0.
- **Đầu ra:** warehouse module + member `warehouseIds`.

## P06-T05 — Sổ movement và balance projection

- [x] Migration `stock_movement` append-only, `stock_balance`; `source_line_id` chưa FK (P07); UNIQUE `(source_line_id,kind)`.
- [x] Balance chỉ qua Inventory port + shared `TransactionClient`; lock `(warehouse_id,batch_id)`; không PATCH balance.
- [x] Harness double-call cùng source → một movement.
- **Đầu ra:** `contexts/inventory/application/adjust-stock.ts`.

## P06-T06 — Read model tồn theo lô

- [x] `GET /inventory/balances|movements` + cursor; authz theo kho.
- [x] UI tra tồn / lịch sử.
- **Đầu ra:** inventory read API/UI.

## P06-T07 — Test cạnh tranh và import master data

- [x] Concurrent issue > stock → một pass; idempotency không nhân movement.
- [x] `deploy/scripts/seed-catalog.mjs` idempotent; opening qua harness (không SQL balance).
- [x] Schema privilege asserts catalog/inventory.
- **Đầu ra:** integration suite + fixtures.

## P06-T08 — Gate G06

- [x] Product, batch, warehouse API/UI và Inventory port; uniqueness, quality, precision, concurrency.
- [x] AC-03 **chưa** hoàn thành (chờ receipt P07 / G07).
- **Bằng chứng:** [`evidence/G06.md`](./evidence/G06.md).

## Hồ sơ giao AI theo từng task

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P06-T01 | D07 baseline; `contexts/catalog/domain/quantity.ts` | Unit tests 0/âm/overflow/EA=1.5; JSON lượng là string |
| P06-T02 | Prisma migration catalog product/identifier; `contexts/catalog/`; `/products` API/UI | SKU/identifier unique, EAN13, archive, 409 |
| P06-T03 | `catalog.batch` + quality routes/UI | Origin pair unique; restricted chặn issue |
| P06-T04 | Prisma inventory warehouse + `membership_warehouse`; `/warehouses` | Scope 403; archive + balance guard |
| P06-T05 | `stock_*` + `adjust-stock.ts` | Sum delta=balance; concurrency; no PATCH balance |
| P06-T06 | `/inventory/balances|movements` | Pagination + scope |
| P06-T07 | `deploy/scripts/seed-catalog.mjs` + harness | Idempotent seed; opening via port |
| P06-T08 | `evidence/G06.md` | AC-03 chờ P07 |
