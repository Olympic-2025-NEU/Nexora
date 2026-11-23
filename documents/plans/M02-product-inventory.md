# Plan: M02 — Product & Inventory Management

> Chi tiết thi công theo `documents/phase-plan/phase-06-catalog-inventory.md` (P06). Schema ERP phải Dev duyệt (`evidence/p06-schema-design.md`) trước migration/API.

## 1. Mục tiêu / phạm vi MVP

| Mã | Chức năng |
| --- | --- |
| NX-PROD-01 | Product Management |
| NX-PROD-02 | Product Identifier (SKU ở Product; EAN-13/internal barcode ở bảng identifier) |
| NX-PROD-03 | Batch/Lot Management |
| NX-PROD-04 | Batch Information (NSX, HSD, nguồn lô) |
| NX-INV-01 | Warehouse |
| NX-INV-02 | Inventory Balance |
| NX-INV-03 | Inventory History |
| NX-INV-04 | Batch Status (available / restricted / inspect) |

Folders: `contexts/catalog/`, `contexts/inventory/`.

## 2. Ngoài phạm vi

- Module QC chuyên sâu nhiều bước
- BOM / lệnh sản xuất
- Định giá, công nợ
- Bảng UOM master / quy đổi đơn vị (v1: `product.base_unit` EA|KG|L bất biến)
- Trading receipt HTTP (P07); partner batch từ inbox (P09)

## 3. Phụ thuộc / cung cấp

| Hướng | Nội dung |
| --- | --- |
| Phụ thuộc | Platform, M01 (G03–G05), D07 |
| Cung cấp M03 | ProductId, BatchId, WarehouseId; port `adjustStock` |
| Cung cấp M04 | Định danh lô / origin issuer+lot |
| Cung cấp AI01 | Tra cứu product/lot/tồn |

Nguyên tắc: số lượng tồn chỉ đổi qua Inventory port (M03 confirm hoặc harness `openStockBalance`); không SQL UPDATE balance; không PATCH balance API.

## 4. Aggregate / sự kiện chính

- `Product`, `ProductIdentifier`, `Batch`
- `Warehouse`, `StockBalance`, `StockMovement`
- Sự kiện nội bộ / audit: thay đổi product/batch/warehouse/quality; movement append-only

## 5. API bề mặt

- `GET/POST/PATCH /api/v1/products`, `POST /api/v1/products/{id}/identifiers`
- `GET/POST /api/v1/batches`, `POST /api/v1/batches/{id}/quality-actions`
- `GET/POST /api/v1/warehouses`
- `GET /api/v1/inventory/balances`, `GET /api/v1/inventory/movements`
- Port nội bộ: `adjustStock`, `openStockBalance` (harness/seed)

## 6. UI bề mặt

- Canonical UI (ADR 0016): `/catalog/products`, `/catalog/batches`, `/inventory/warehouses`, `/inventory/balances` — **not** under `/admin` (system-only). Legacy `/admin/products|batches|warehouses|inventory` redirect to these prefixes.
- Member warehouse scope qua membership PATCH (`membership_warehouse`)

## 7. Kiểm thử tối thiểu

- Unit: quantity D07; cấm tồn âm; restricted/inspect/expired chặn xuất
- Integration: concurrency issue; idempotent movement; GRANT privileges
- API: SKU/lot uniqueness; warehouse scope 403

## 8. Tiêu chí Done

- [ ] Port Inventory sẵn cho M03
- [ ] Lô lưu origin issuer+lot (phục vụ M04)
- [ ] G06 evidence; **AC-03 chờ P07**

## 9. Ghi chú DevOps

Prisma Migrate multi-schema `catalog`/`inventory`; GRANT trong cùng migration; rebuild `db-migrate` trước deploy; lock order `(warehouse_id,batch_id)`.
