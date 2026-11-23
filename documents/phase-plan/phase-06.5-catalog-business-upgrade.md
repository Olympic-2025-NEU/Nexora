<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Phase 06.5 — Catalog business upgrade (variant / UOM / price / category)

**Mục tiêu:** tối ưu lại nghiệp vụ catalog theo [`BRD-product-catalog.md`](../requirements/BRD-product-catalog.md) + [`SRS-product-catalog.md`](../requirements/SRS-product-catalog.md): product cơ bản, **product_variant** (SKU/barcode), category cây, UOM chuẩn hoá + ĐVT mặc định **CÁI**, `product_variant_uom`, `price_list` / `price_list_item`, search/soft-delete/`is_active`; neo tồn/lô sang **variant** trước P07.

**Phụ thuộc:** G06 CLOSED (P06), D07, D16, D17 requirements.  
**Unblock:** P07 trading (document lines phải tham chiếu variant + ĐVT gốc).  
**AC:** nền AC-03 vững hơn (master data bán hàng đúng); AC-03 confirm receipt vẫn kết thúc ở G07.

**Không làm trong phase này:** chứng từ trading đầy đủ (P07); WAC production (chỉ biên FIFO mặc định trong org config nếu cần); POS/promo; multi-category n–n.

**UI surfaces:** `/catalog/products` = **index bảng**; `/catalog/products/[id]`; `/catalog/categories`; `/catalog/uom`; `/catalog/pricing`. Copy doanh nghiệp (không Keycloak/P0x).

**Cổng schema:** Dev duyệt gói [`evidence/p065-schema-design.md`](./evidence/p065-schema-design.md) (tạo trong T01) **trước** migration phá vỡ P06 product.sku.

## P065-T01 — ADR + schema pack

- [x] ADR schema catalog upgrade: [`../adr/0017-catalog-variant-uom-price.md`](../adr/0017-catalog-variant-uom-price.md) — ERD SRS, data migration từ P06 (`product.sku` → primary variant; `base_unit` → stock UOM; batch/stock → `product_variant_id`).
- [x] Viết [`evidence/p065-schema-design.md`](./evidence/p065-schema-design.md) (fields, CHECK, unique partial, GRANT) — **Approved 2026-11-22**.
- [x] Cập nhật `database-schema-v1.md` § P065 / `api-payloads-v1.md` M02 target cùng ADR.
- **Đầu ra:** ADR + pack đã duyệt; mở T02+.

## P065-T02 — Migration catalog (DDL)

- [x] Prisma migration: `category`, `uom` (+ seed `CÁI` `is_system_default`), reshape `product`, `product_variant`, `product_variant_uom`, `product_image`, `price_list`, `price_list_item`, `variant_code`.
- [x] Backfill: mỗi product P06 → 1 primary variant; stock UOM từ base_unit; drop `product_identifier`.
- [x] Soft-delete / unique gồm soft-deleted via `variant_code`.
- **Đầu ra:** migrate deploy instance A 2026-11-22.

## P065-T03 — Inventory / batch neo variant

- [x] Migration: `batch.product_variant_id`; stock_balance/movement + FK composite.
- [x] `adjust-stock` + repos variant-aware (qty stock UOM kind).
- [x] `seed-catalog.mjs` cập nhật.
- **Đầu ra:** Inventory port variant-aware; unit tests adjust-stock pass.

## P065-T04 — Domain: UOM normalize, SKU/barcode, search

- [x] `normalize-uom.ts` (+ tests CÁI); `variant_code` sync; `search_text` on product write.
- [x] Variant ≥1 sku|barcode; PATCH mutable; same-variant sku=barcode OK.
- **Đầu ra:** domain + unit tests.

## P065-T05 — API category / UOM / product / variant

- [x] Categories / UOM / products (no sku SoT) / variants APIs; identifiers → 410.
- [x] Policy keys category/uom/price_list; OpenAPI schema delta.
- [ ] Images upload route (table ready; API deferred thin — metadata only later if needed).
- [ ] Live contract/policy smoke sau rebuild erp.
- **Đầu ra:** handlers + routes in tree.

## P065-T06 — API price_list + price_list_item

- [x] Price list + items APIs; uom ∈ variant_uoms check.
- [ ] Resolve helper unit test riêng (logic SRS §3 — optional follow-up).
- **Đầu ra:** pricing API code.

## P065-T07 — UI catalog theo surface

- [x] `/catalog/products` index bảng + CTA tạo; `/catalog/products/new` và `[id]` editor (sidebar ảnh/kích hoạt, tabs Thông tin chung / Kho / Bán, sticky footer); masters categories/uom/pricing/batches; i18n VI/EN.
- [x] Layout học theo form ERP tham chiếu (giữ token Nexora teal).

## P065-T08 — Seed, regression, gate G06.5

- [x] Seed idempotent variant + default retail item.
- [x] adjust-stock / normalize / quantity regression.
- [x] Live smoke `smoke-p065-local.mjs` 12/12; evidence [`evidence/G06.5.md`](./evidence/G06.5.md) **CLOSED (technical)**.
- **Đầu ra:** G06.5 CLOSED technical; AC-03 vẫn P07.

## Hồ sơ giao AI theo từng task

| Task | Tệp/đầu ra cụ thể | Điều kiện kiểm chứng trước khi đóng |
| --- | --- | --- |
| P065-T01 | ADR + `evidence/p065-schema-design.md`; cập nhật schema/API docs | Dev **Approved** trên pack |
| P065-T02 | Prisma migrations catalog reshape + backfill | `migrate deploy` empty + seeded P06 |
| P065-T03 | batch/stock → variant; `adjust-stock.ts` | Concurrent issue; opening harness |
| P065-T04 | normalize UOM; sku/barcode matrix; search_text | Unit tests SRS §8 |
| P065-T05 | Categories/UOM/product/variant/image APIs | Contract + policy tests |
| P065-T06 | price_list + items + resolve | Default unique; item UOM check |
| P065-T07 | UI index/detail/categories/uom/pricing | Manual/smoke; no fake CRUD |
| P065-T08 | seed + `evidence/G06.5.md` | Gate CLOSED; AC-03 still P07 |

## Quan hệ với P06 / P07

| | |
| --- | --- |
| P06 / G06 | **Giữ CLOSED** — baseline đã giao; P065 là upgrade có chủ đích, không mở lại G06 |
| P065 / G06.5 | Bắt buộc trên đường găng **trước P07** nếu trading cần variant+price |
| P07 | Document line dùng `product_variant_id` + qty ở stock UOM (convert từ packing ở app) |

## Nhánh Git gợi ý

- Integration: `phase-06.5` (base `phase-06` hoặc `develop` sau merge P06)
- Task: `phase-06.5/p065-t01-schema-adr`, …
