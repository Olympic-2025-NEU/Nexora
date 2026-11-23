<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# BRD — Product catalog (upgrade)

**Status:** Requirements accepted (documentation) — **2026-11-22**  
**Audience:** Product / engineering / Dev reviewing schema ADR  
**Companion SRS:** [`SRS-product-catalog.md`](./SRS-product-catalog.md)  
**Implements after:** schema ADR + migration pack (not this document)  
**Supersedes (target model):** P06 assumptions that SKU/`base_unit` live on `product`; MVP non-goals that deferred UOM master, category tree, and commercial price lists ([`BRD.md`](./BRD.md) §5)

## 1. Business problem

Doanh nghiệp cần quản lý **họ sản phẩm** và **biến thể bán hàng** (SKU/barcode), phân loại theo cây danh mục, đơn vị tính đóng gói đa cấp, và bảng giá thương mại (chung / riêng) — trong khi **giá vốn / COGS / lợi nhuận** phải tách khỏi giá niêm yết để không làm sai báo cáo khi sửa đơn nhập hoặc đơn đã bán (P07+).

## 2. Actors

| Actor | Intent (catalog) |
| --- | --- |
| Administrator / Staff | CRUD product, variant, category, UOM, price list/items theo policy |
| Approver / Viewer | Đọc catalog / giá hiện hành trong phạm vi quyền |
| Trading (P07+) | Resolve giá niêm yết; confirm nhập-xuất neo **variant** + ĐVT gốc; snapshot COGS |

## 3. Epics

| ID | Epic | Tóm tắt |
| --- | --- | --- |
| NX-PROD-10 | Product master | Thông tin chung: tên, search, attributes JSON, category, soft-delete / `is_active` |
| NX-PROD-11 | Product variant | SKU/barcode mutable; primary; tồn & chứng từ neo variant |
| NX-PROD-12 | Category tree | Phân loại cây `parent_id` (vd. Bàn → Bàn Gỗ → Gỗ Mít) |
| NX-PROD-13 | UOM master | ĐVT độc lập; mặc định hệ thống **CÁI**; chuẩn hoá lưu cuối |
| NX-PROD-14 | Variant UOM factors | Quy đổi đóng gói theo variant → ĐVT gốc tồn |
| NX-PROD-15 | Price lists | Header chung/riêng + items (variant×UOM×price_type) |
| NX-PROD-16 | Search | Tìm không phụ thuộc dấu/ký hiệu; gồm tên product + SKU/barcode variant |
| NX-PROD-17 | Costing boundary | FIFO (mặc định) / WAC; COGS ≠ giá mua niêm yết |

## 4. Business rules

### 4.1 Product vs variant

- **Product** không lưu SKU/barcode. Chỉ: name, `search_text`, `attributes` (JSONB: mô tả, xuất xứ, thương hiệu, …), `category_id`, `is_active`, soft-delete.
- **Variant** mang định danh bán hàng: `sku` và/hoặc `barcode` (≥1 bắt buộc); `is_primary` (đúng một primary active / product); `is_active`; soft-delete.
- SKU và barcode **được sửa** sau tạo (có audit).
- Unique toàn instance: không trùng giữa các variant; cùng một variant **cho phép `sku = barcode`**; mã đã soft-delete **không tái cấp**.

### 4.2 Category

- Cây quan hệ `parent_id` (root = null). Ví dụ: `Bàn` / `Bàn Gỗ` / `Gỗ Mít` hoặc `Bàn` / `Bàn Gỗ Ép`.
- Product gắn **một** category. Lọc danh sách theo node gồm **hậu duệ**.
- `is_active` + chặn xoá khi còn con / còn product.

### 4.3 UOM

- Master độc lập khỏi product; có **ĐVT hệ thống mặc định `CÁI`** (không xoá / không đổi mã hệ thống).
- Mọi tạo/sửa UOM: backend chuẩn hoá (`cái` / `Cái` / `CÁI` → lưu **`CÁI`**); unique theo khoá đã chuẩn hoá.
- Variant mới mặc định ĐVT gốc = `CÁI` trừ khi chọn UOM active khác.
- Hệ số đóng gói trên **`product_variant_uom`** (không trên product). Tồn/movement chỉ ghi ĐVT gốc variant.

### 4.4 Price list & items

- **`price_list`**: `code` null = bảng giá **chung** (có `is_default`, đúng một default); có `code` = bảng giá **riêng**. Có `valid_from`/`valid_to`, `is_active`, `currency`.
- **`price_list_item`**: dòng giá theo `product_variant` + `uom` + `price_type` ∈ {purchase, retail, wholesale}. Currency/hiệu lực inherit từ list.
- Sửa giá **không** rewrite chứng từ / movement đã chốt.
- `purchase` trên bảng giá = **giá tham chiếu mua**, không phải COGS thực tế.

### 4.5 Soft delete & `is_active`

| | `is_active = false` | Soft-delete |
| --- | --- | --- |
| Product | Ngừng dùng họ SP; không tạo phiếu mới | Ẩn mạnh; chặn nếu còn tồn trên mọi variant |
| Variant | Ngừng bán biến thể | Giữ unique SKU/barcode |
| UOM / Category | Không chọn/gán mới | Chặn khi còn tham chiếu |

### 4.6 UI (business)

- Vào **Sản phẩm** mặc định là **index bảng dòng** cấp product (không form trống).
- Detail/form tách route; quản lý variant / UOM / giá từ detail.
- Surfaces: `/catalog/categories`, `/catalog/uom`, `/catalog/pricing` (price lists).

### 4.7 Costing / lợi nhuận (ràng buộc P07+)

- Phương pháp giá vốn cấp tổ chức: **FIFO theo lô (mặc định v1)**; WAC chỉ qua ADR.
- COGS tính và **snapshot** lúc confirm xuất/bán; neo **variant** (+ batch).
- Sửa đơn nhập đã confirm: **không sửa âm thầm lịch sử** — chỉ reversal + chứng từ bù (append-only movement).

## 5. Non-goals (còn lại)

- POS checkout, khuyến mãi phức tạp, đa tiền tệ đầy đủ trên một list.
- Multi-category n–n cho một product.
- BOM / sản xuất.
- Override hiệu lực từng `price_list_item` (inherit list trong v1).
- Triển khai migration trong tài liệu này.

## 6. Success criteria

- Staff tạo product + variant (SKU/barcode) + category cây + UOM (CÁI mặc định) + bảng giá chung default mà không dán Keycloak/`sub` hay hiểu P0x.
- Index `/catalog/products` hiển thị dạng dòng; tìm được khi gõ không dấu.
- Dev có SRS đủ để viết ADR schema trước khi đụng inventory/batch FK.

## 7. Mapping

| Hiện trạng P06 | Mô hình đích |
| --- | --- |
| `product.sku`, `base_unit` | `product_variant.sku/barcode`; `product_variant_uom` + `uom` |
| `product_identifier` là chỗ SKU mặc định | Supersede cho SKU/barcode; identifier phụ chỉ nếu ADR sau |
| Không category / price list | `category`, `price_list`, `price_list_item` |
| Stock theo product+batch | Stock/COGS theo **variant**+batch (ADR migration) |
